
const crypto = require("crypto");

const { db } = require("../../config/db");

const {
  createClient,
} = require("@supabase/supabase-js");

/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 *
 * On utilise exactement les variables Supabase
 * de ton backend ADMIN.
 *
 * Aucun secret n'est envoyé au frontend.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GENERATED_BUCKET =
  process.env.SUPABASE_GENERATED_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET;

const SIGNED_URL_DURATION = 60 * 60;

const PAGE_SIZE = 24;

const MAX_PAGES = 100000;

const SHARE_DURATION_DAYS = 7;

/*
 * =========================================================
 * CLIENT SUPABASE
 * =========================================================
 */

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      )
    : null;

/*
 * =========================================================
 * CACHE
 * =========================================================
 *
 * Les URL signées ont une durée limitée.
 *
 * On empêche le navigateur et les intermédiaires
 * de réutiliser une ancienne réponse JSON.
 */

const disableGalleryCache = (res) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Referrer-Policy", "no-referrer");
};

/*
 * =========================================================
 * ERREURS
 * =========================================================
 *
 * Si Supabase ne fournit pas l'image,
 * on renvoie une erreur identifiable au lieu
 * de faire croire que le portrait est disponible.
 */

class GalleryStorageError extends Error {
  constructor(message) {
    super(message);

    this.name = "GalleryStorageError";
    this.statusCode = 502;
  }
}

const sendGalleryError = (res, error, fallbackMessage) => {
  console.error("[COMPANY GALLERY]", {
    name: error.name,
    message: error.message,
  });

  if (error instanceof GalleryStorageError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: fallbackMessage,
  });
};

/*
 * =========================================================
 * NORMALISATION STORAGE KEY
 * =========================================================
 *
 * Dans generated_portraits.storage_key,
 * on attend normalement le chemin interne du fichier.
 *
 * Exemples :
 *
 * portrait/123/final.png
 * company/2/portrait-10.webp
 *
 * Si une ancienne ligne contient une URL Supabase
 * complète, on récupère son chemin de stockage.
 *
 * On ne récupère jamais des images provenant
 * d'un autre serveur.
 */

const normalizeStorageKey = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  let key = value.trim();

  if (!key) {
    return null;
  }

  /*
   * Cas 1 : storage_key contient une URL complète.
   */

  if (/^https?:\/\//i.test(key)) {
    let url;

    try {
      url = new URL(key);
    } catch {
      throw new GalleryStorageError(
        "Le chemin du portrait est invalide."
      );
    }

    if (!SUPABASE_URL) {
      throw new GalleryStorageError(
        "Configuration Supabase manquante."
      );
    }

    const configuredUrl = new URL(SUPABASE_URL);

    if (url.origin !== configuredUrl.origin) {
      throw new GalleryStorageError(
        "Le portrait référence un stockage non autorisé."
      );
    }

    const markers = [
      `/storage/v1/object/public/${GENERATED_BUCKET}/`,
      `/storage/v1/object/sign/${GENERATED_BUCKET}/`,
      `/storage/v1/object/authenticated/${GENERATED_BUCKET}/`,
    ];

    const marker = markers.find((item) =>
      url.pathname.includes(item)
    );

    if (!marker) {
      throw new GalleryStorageError(
        "Le chemin Supabase du portrait est invalide."
      );
    }

    key = url.pathname.split(marker)[1] || "";
  }

  /*
   * Cas 2 : chemin déjà précédé du nom du bucket.
   *
   * Exemple :
   * participant-photos/portraits/final.png
   */

  key = key.replace(/^\/+/, "");

  const bucketPrefix = `${GENERATED_BUCKET}/`;

  if (key.startsWith(bucketPrefix)) {
    key = key.slice(bucketPrefix.length);
  }

  /*
   * Supabase signe le chemin relatif au bucket.
   */

  try {
    key = decodeURIComponent(key);
  } catch {
    throw new GalleryStorageError(
      "Le chemin du portrait contient un encodage invalide."
    );
  }

  if (
    !key ||
    key.includes("\\") ||
    key.split("/").some(
      (segment) => segment === ".." || segment === "."
    )
  ) {
    throw new GalleryStorageError(
      "Le chemin de stockage du portrait est invalide."
    );
  }

  return key;
};

/*
 * =========================================================
 * SIGNED URL — MÊME MÉTHODE QUE L'ADMIN
 * =========================================================
 *
 * Même bucket.
 * Même client Supabase.
 * Même méthode createSignedUrl().
 * Même durée de 1 heure.
 *
 * En cas d'échec, on ne retourne plus silencieusement null.
 */

const createSignedImageUrl = async (
  storageKey,
  portraitId
) => {
  if (!supabase) {
    throw new GalleryStorageError(
      "Le stockage des portraits n'est pas configuré."
    );
  }

  if (!GENERATED_BUCKET) {
    throw new GalleryStorageError(
      "Le bucket des portraits n'est pas configuré."
    );
  }

  const normalizedKey = normalizeStorageKey(storageKey);

  if (!normalizedKey) {
    throw new GalleryStorageError(
      "Le fichier du portrait final est introuvable."
    );
  }

  try {
    const { data, error } = await supabase
      .storage
      .from(GENERATED_BUCKET)
      .createSignedUrl(
        normalizedKey,
        SIGNED_URL_DURATION
      );

    if (error) {
      /*
       * Les logs permettent d'identifier le portrait
       * concerné sans exposer la clé service role
       * ni l'URL signée.
       */

      console.error(
        "[COMPANY GALLERY] Supabase signing failed",
        {
          portraitId,
          bucket: GENERATED_BUCKET,
          error: error.message,
        }
      );

      throw new GalleryStorageError(
        "Impossible de charger l'image du portrait depuis Supabase."
      );
    }

    const signedUrl = data?.signedUrl;

    if (!signedUrl) {
      throw new GalleryStorageError(
        "Supabase n'a pas retourné d'URL pour le portrait."
      );
    }

    /*
     * Validation de l'URL renvoyée par Supabase.
     */

    let parsedUrl;

    try {
      parsedUrl = new URL(signedUrl);
    } catch {
      throw new GalleryStorageError(
        "Supabase a retourné une URL d'image invalide."
      );
    }

    /*
     * Les images doivent venir de Supabase en HTTPS.
     */

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.origin !== new URL(SUPABASE_URL).origin
    ) {
      throw new GalleryStorageError(
        "L'URL du portrait n'est pas une URL Supabase HTTPS valide."
      );
    }

    return signedUrl;
  } catch (error) {
    if (error instanceof GalleryStorageError) {
      throw error;
    }

    console.error(
      "[COMPANY GALLERY] Supabase exception",
      {
        portraitId,
        message: error.message,
      }
    );

    throw new GalleryStorageError(
      "Erreur de communication avec le stockage Supabase."
    );
  }
};

/*
 * =========================================================
 * UTILITAIRES
 * =========================================================
 */

const hashToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};

/*
 * Pagination par offset.
 *
 * Le frontend envoie :
 * ?cursor=24
 * ?cursor=48
 */

const getPagination = (cursor) => {
  if (cursor === undefined) {
    return 0;
  }

  if (
    typeof cursor !== "string" ||
    !/^\d+$/.test(cursor)
  ) {
    return null;
  }

  const offset = Number(cursor);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_PAGES * PAGE_SIZE ||
    offset % PAGE_SIZE !== 0
  ) {
    return null;
  }

  return offset;
};

/*
 * =========================================================
 * FORMAT D'UN PORTRAIT
 * =========================================================
 *
 * Ce format est celui attendu par :
 *
 * GalleryPage.jsx
 * PublicGalleryPage.jsx
 *
 * Aucun changement frontend nécessaire.
 */

const formatPortrait = async (row) => {
  const imageUrl = await createSignedImageUrl(
    row.storageKey,
    row.id
  );

  return {
    id: row.id,

    participantId: row.participantId,

    firstName: row.firstName,
    lastName: row.lastName,

    campaignId: row.campaignId,
    campaignName: row.campaignName,

    styleName:
      row.styleName || "Portrait professionnel",

    imageUrl,

    /*
     * Le téléchargement reste désactivé.
     *
     * Il sera ajouté via une route dédiée
     * contrôlant les droits de téléchargement.
     */

    downloadUrl: null,
    canDownload: false,

    createdAt: row.selectedAt,
  };
};

/*
 * =========================================================
 * RÉCUPÉRATION DES PORTRAITS FINAUX
 * =========================================================
 *
 * Même structure de tables que dans ton ADMIN :
 *
 * galleries
 * participants
 * campaigns
 * participant_selections
 * generated_portraits
 *
 * On conserve le filtrage par company_id.
 *
 * IMPORTANT :
 * La sélection finale est utilisée pour la galerie
 * entreprise. Elle ne prouve pas, à elle seule,
 * le consentement au partage public.
 */

const fetchFinalPortraits = async (
  companyId,
  offset
) => {
  const result = await db.query(
    `
    SELECT
      gp.id,

      gp.storage_key
        AS "storageKey",

      p.id
        AS "participantId",

      p.first_name
        AS "firstName",

      p.last_name
        AS "lastName",

      c.id
        AS "campaignId",

      c.name
        AS "campaignName",

      pst.name
        AS "styleName",

      COALESCE(
        ps.updated_at,
        ps.created_at
      ) AS "selectedAt"

    FROM galleries g

    INNER JOIN participants p
      ON p.id = g.participant_id

    INNER JOIN campaigns c
      ON c.id = p.campaign_id

    INNER JOIN participant_selections ps
      ON ps.participant_id = p.id
      AND ps.is_final_selection = TRUE

    INNER JOIN generated_portraits gp
      ON gp.id = ps.portrait_id

    LEFT JOIN portrait_styles pst
      ON pst.id = c.style_id

    WHERE
      c.company_id = $1

      AND g.published_at IS NOT NULL

      AND (
        g.expires_at IS NULL
        OR g.expires_at > NOW()
      )

      AND gp.storage_key IS NOT NULL

      AND TRIM(gp.storage_key) <> ''

    ORDER BY
      COALESCE(
        ps.updated_at,
        ps.created_at
      ) DESC,
      gp.id DESC

    LIMIT $2
    OFFSET $3
    `,
    [
      companyId,
      PAGE_SIZE + 1,
      offset,
    ]
  );

  const hasMore = result.rows.length > PAGE_SIZE;

  const page = result.rows.slice(0, PAGE_SIZE);

  /*
   * Signatures Supabase générées en parallèle.
   *
   * Une URL invalide déclenche une erreur explicite
   * plutôt que d'afficher une carte vide.
   */

  const portraits = await Promise.all(
    page.map(formatPortrait)
  );

  return {
    portraits,

    hasMore,

    nextCursor: hasMore
      ? String(offset + PAGE_SIZE)
      : null,
  };
};

/*
 * =========================================================
 * GET /company/gallery/portraits
 * =========================================================
 *
 * Galerie privée de l'entreprise connectée.
 */

const getCompanyGalleryPortraits = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: "Entreprise introuvable.",
      });
    }

    const offset = getPagination(req.query.cursor);

    if (offset === null) {
      return res.status(400).json({
        success: false,
        message: "Pagination invalide.",
      });
    }

    const data = await fetchFinalPortraits(
      companyId,
      offset
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return sendGalleryError(
      res,
      error,
      "Impossible de charger les portraits."
    );
  }
};

/*
 * =========================================================
 * URL DU FRONTEND
 * =========================================================
 *
 * On conserve les variables d'environnement.
 *
 * En développement :
 * FRONTEND_URL=http://localhost:5173
 *
 * En production :
 * FRONTEND_URL=https://... 
 *
 * Jamais d'adresse écrite en dur.
 */

const getFrontendUrl = () => {
  const configuredUrl =
    process.env.FRONTEND_URL?.trim();

  if (!configuredUrl) {
    throw new Error(
      "FRONTEND_URL invalide ou manquante."
    );
  }

  let parsed;

  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error(
      "FRONTEND_URL invalide ou manquante."
    );
  }

  const production =
    process.env.NODE_ENV === "production";

  const isHttps = parsed.protocol === "https:";

  const isLocalHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(
      parsed.hostname
    );

  if (
    (production && !isHttps) ||
    (!production && !isHttps && !isLocalHttp)
  ) {
    throw new Error(
      "FRONTEND_URL doit utiliser HTTPS en production."
    );
  }

  /*
   * Ne pas accepter des chemins ou paramètres
   * dans l'adresse du frontend.
   */

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error(
      "FRONTEND_URL doit contenir uniquement l'origine du site."
    );
  }

  return parsed.origin;
};

/*
 * =========================================================
 * POST /company/gallery/share
 * =========================================================
 *
 * Création d'un lien public valable 7 jours.
 *
 * Chaque nouveau lien remplace les anciens.
 * Seul le hash du token est enregistré en BDD.
 */

const createCompanyGalleryShare = async (
  req,
  res
) => {
  disableGalleryCache(res);

  const companyId = req.user?.companyId;
  const userId = req.user?.id;

  if (!companyId || !userId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  let frontendUrl;

  try {
    frontendUrl = getFrontendUrl();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }

  const client = await db.connect();

  try {
    const token = crypto
      .randomBytes(32)
      .toString("hex");

    const tokenHash = hashToken(token);

    await client.query("BEGIN");

    /*
     * On verrouille l'entreprise pendant
     * la création du partage.
     *
     * Cela empêche deux créations concurrentes
     * de produire deux liens actifs.
     */

    const company = await client.query(
      `
      SELECT id
      FROM companies
      WHERE id = $1
        AND status = 'ACTIVE'
      FOR UPDATE
      `,
      [companyId]
    );

    if (company.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message:
          "Entreprise inactive ou introuvable.",
      });
    }

    /*
     * Révocation des anciens partages.
     */

    await client.query(
      `
      UPDATE company_gallery_shares
      SET revoked_at = NOW()
      WHERE company_id = $1
        AND revoked_at IS NULL
      `,
      [companyId]
    );

    /*
     * Création du nouveau partage.
     */

    const result = await client.query(
      `
      INSERT INTO company_gallery_shares (
        company_id,
        token_hash,
        created_by_user_id,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        NOW() + ($4::INTEGER * INTERVAL '1 day')
      )
      RETURNING
        expires_at AS "expiresAt"
      `,
      [
        companyId,
        tokenHash,
        userId,
        SHARE_DURATION_DAYS,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,

      message: "Lien de partage créé.",

      shareUrl:
        `${frontendUrl}/galerie-partagee/${token}`,

      expiresAt: result.rows[0].expiresAt,
    });
  } catch (error) {
    await client
      .query("ROLLBACK")
      .catch(() => {});

    console.error(
      "[COMPANY GALLERY] CREATE SHARE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de créer le lien de partage.",
    });
  } finally {
    client.release();
  }
};

/*
 * =========================================================
 * GET /company/gallery/share
 * =========================================================
 *
 * Vérification d'un partage actif.
 *
 * On ne retourne pas le token secret,
 * car il n'est pas stocké en clair.
 */

const getCompanyGalleryShare = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: "Entreprise introuvable.",
      });
    }

    const result = await db.query(
      `
      SELECT
        id,

        created_at AS "createdAt",

        expires_at AS "expiresAt"

      FROM company_gallery_shares

      WHERE
        company_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()

      ORDER BY
        created_at DESC,
        id DESC

      LIMIT 1
      `,
      [companyId]
    );

    return res.status(200).json({
      success: true,

      active: result.rows.length > 0,

      share: result.rows[0] || null,
    });
  } catch (error) {
    console.error(
      "[COMPANY GALLERY] GET SHARE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de vérifier le partage.",
    });
  }
};

/*
 * =========================================================
 * DELETE /company/gallery/share
 * =========================================================
 *
 * Révocation immédiate du lien public.
 *
 * Les URL signées déjà émises peuvent rester
 * utilisables jusqu'à leur expiration Supabase.
 */

const revokeCompanyGalleryShare = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: "Entreprise introuvable.",
      });
    }

    await db.query(
      `
      UPDATE company_gallery_shares
      SET revoked_at = NOW()

      WHERE company_id = $1
        AND revoked_at IS NULL
      `,
      [companyId]
    );

    return res.status(200).json({
      success: true,
      message:
        "Le lien public a été désactivé.",
    });
  } catch (error) {
    console.error(
      "[COMPANY GALLERY] REVOKE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de désactiver le lien.",
    });
  }
};

/*
 * =========================================================
 * GET /public/gallery/:token
 * =========================================================
 *
 * Galerie publique accessible sans connexion.
 *
 * Le token doit correspondre à un partage actif.
 *
 * Les portraits proviennent exclusivement
 * de l'entreprise propriétaire de ce partage.
 */

const getPublicCompanyGallery = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const token = req.params.token;

    /*
     * Token hexadécimal de 64 caractères.
     */

    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token)
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Lien de partage introuvable.",
      });
    }

    const offset = getPagination(
      req.query.cursor
    );

    if (offset === null) {
      return res.status(400).json({
        success: false,
        message: "Pagination invalide.",
      });
    }

    /*
     * Vérification du partage.
     */

    const result = await db.query(
      `
      SELECT
        s.company_id AS "companyId",

        s.expires_at AS "expiresAt",

        co.name AS "companyName"

      FROM company_gallery_shares s

      INNER JOIN companies co
        ON co.id = s.company_id

      WHERE
        s.token_hash = $1

        AND s.revoked_at IS NULL

        AND s.expires_at > NOW()

        AND co.status = 'ACTIVE'

      LIMIT 1
      `,
      [hashToken(token)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Ce lien est expiré ou a été désactivé.",
      });
    }

    const share = result.rows[0];

    /*
     * On réutilise exactement la même récupération
     * de portraits que dans la galerie privée.
     *
     * Seule l'entreprise liée au token est utilisée.
     */

    const data = await fetchFinalPortraits(
      share.companyId,
      offset
    );

    return res.status(200).json({
      success: true,

      companyName: share.companyName,

      expiresAt: share.expiresAt,

      data,
    });
  } catch (error) {
    return sendGalleryError(
      res,
      error,
      "Impossible de consulter la galerie."
    );
  }
};

/*
 * =========================================================
 * EXPORTS
 * =========================================================
 *
 * On conserve exactement les noms attendus
 * par les routes existantes.
 */

module.exports = {
  getCompanyGalleryPortraits,

  createCompanyGalleryShare,

  getCompanyGalleryShare,

  revokeCompanyGalleryShare,

  getPublicCompanyGallery,
};
