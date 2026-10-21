
const crypto = require("crypto");

const { db } = require("../../config/db");

const {
  createClient,
} = require("@supabase/supabase-js");

/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

const SUPABASE_URL = process.env.SUPABASE_URL;

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
 *
 * On conserve la même configuration que l'ADMIN.
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
 * Les URL des portraits sont signées et temporaires.
 * Les réponses API ne doivent pas être mises en cache.
 */

const disableGalleryCache = (res) => {
  res.set(
    "Cache-Control",
    "private, no-store, max-age=0"
  );

  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Referrer-Policy", "no-referrer");
};

/*
 * =========================================================
 * ERREUR DE STOCKAGE
 * =========================================================
 */

class GalleryStorageError extends Error {
  constructor(message) {
    super(message);

    this.name = "GalleryStorageError";
    this.statusCode = 502;
  }
}

const sendGalleryError = (
  res,
  error,
  fallbackMessage
) => {
  console.error("[COMPANY GALLERY]", {
    name: error.name,
    message: error.message,
  });

  if (error instanceof GalleryStorageError) {
    return res.status(502).json({
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
 * NORMALISATION DU CHEMIN SUPABASE
 * =========================================================
 *
 * On accepte :
 * - un chemin relatif au bucket ;
 * - un chemin préfixé par le bucket ;
 * - une URL Supabase du même projet.
 */

const normalizeStorageKey = (value) => {
  if (
    !value ||
    typeof value !== "string"
  ) {
    return null;
  }

  let key = value.trim();

  if (!key) {
    return null;
  }

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

  key = key.replace(/^\/+/, "");

  const bucketPrefix = `${GENERATED_BUCKET}/`;

  if (key.startsWith(bucketPrefix)) {
    key = key.slice(bucketPrefix.length);
  }

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
      (segment) =>
        segment === ".." ||
        segment === "."
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
 * SIGNED URL SUPABASE
 * =========================================================
 *
 * On garde le fonctionnement qui affiche déjà
 * les images dans tes deux galeries.
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

  const normalizedKey =
    normalizeStorageKey(storageKey);

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

    let parsedUrl;

    try {
      parsedUrl = new URL(signedUrl);
    } catch {
      throw new GalleryStorageError(
        "Supabase a retourné une URL d'image invalide."
      );
    }

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.origin !==
        new URL(SUPABASE_URL).origin
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
 * HASH DU TOKEN
 * =========================================================
 *
 * Le hash reste utilisé pour vérifier les liens publics.
 *
 * Il n'est pas possible de retrouver le token
 * original à partir de ce hash.
 */

const hashToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};

/*
 * =========================================================
 * NOUVEAU — CLÉ DE CHIFFREMENT
 * =========================================================
 *
 * Variable backend :
 *
 * GALLERY_TOKEN_ENCRYPTION_KEY
 *
 * Clé AES-256 de 32 octets,
 * représentée par 64 caractères hexadécimaux.
 *
 * La même clé doit être configurée sur Render
 * et dans l'environnement local.
 */

const getGalleryEncryptionKey = () => {
  const value =
    process.env.GALLERY_TOKEN_ENCRYPTION_KEY;

  if (
    !value ||
    !/^[a-f0-9]{64}$/i.test(value)
  ) {
    throw new Error(
      "GALLERY_TOKEN_ENCRYPTION_KEY doit contenir exactement 64 caractères hexadécimaux."
    );
  }

  return Buffer.from(value, "hex");
};

/*
 * =========================================================
 * NOUVEAU — CHIFFRER UN TOKEN
 * =========================================================
 *
 * AES-256-GCM.
 *
 * Chaque chiffrement utilise un IV différent.
 *
 * Format enregistré en BDD :
 *
 * iv:tag:contenu_chiffre
 *
 * Le token original n'est pas stocké en clair.
 */

const encryptGalleryToken = (token) => {
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error(
      "Token de partage invalide."
    );
  }

  const key = getGalleryEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
};

/*
 * =========================================================
 * NOUVEAU — DÉCHIFFRER UN TOKEN
 * =========================================================
 *
 * Utilisé seulement par le propriétaire
 * connecté pour retrouver son lien actif.
 */

const decryptGalleryToken = (encryptedToken) => {
  if (!encryptedToken) {
    return null;
  }

  if (typeof encryptedToken !== "string") {
    throw new Error(
      "Token chiffré invalide."
    );
  }

  const parts = encryptedToken.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "Format du token chiffré invalide."
    );
  }

  const [ivHex, tagHex, dataHex] = parts;

  if (
    !/^[a-f0-9]{24}$/i.test(ivHex) ||
    !/^[a-f0-9]{32}$/i.test(tagHex) ||
    !/^[a-f0-9]+$/i.test(dataHex) ||
    dataHex.length % 2 !== 0
  ) {
    throw new Error(
      "Données de chiffrement invalides."
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getGalleryEncryptionKey(),
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(
    Buffer.from(tagHex, "hex")
  );

  const decrypted = Buffer.concat([
    decipher.update(
      Buffer.from(dataHex, "hex")
    ),
    decipher.final(),
  ]);

  const token = decrypted.toString("utf8");

  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(
      "Token déchiffré invalide."
    );
  }

  return token;
};

/*
 * =========================================================
 * PAGINATION
 * =========================================================
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
 * FORMAT PORTRAIT
 * =========================================================
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
      row.styleName ||
      "Portrait professionnel",

    imageUrl,

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
 * Structure BDD identique à ton ADMIN.
 *
 * On limite toujours aux campagnes
 * appartenant à l'entreprise concernée.
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

  const hasMore =
    result.rows.length > PAGE_SIZE;

  const page =
    result.rows.slice(0, PAGE_SIZE);

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
 */

const getCompanyGalleryPortraits = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const companyId =
      req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: "Entreprise introuvable.",
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
 * ADRESSE DU FRONTEND
 * =========================================================
 *
 * Aucune URL codée en dur.
 *
 * FRONTEND_URL est fournie par .env ou Render.
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

  const isHttps =
    parsed.protocol === "https:";

  const isLocalHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(
      parsed.hostname
    );

  if (
    (production && !isHttps) ||
    (!production &&
      !isHttps &&
      !isLocalHttp)
  ) {
    throw new Error(
      "FRONTEND_URL doit utiliser HTTPS en production."
    );
  }

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
 * NOUVEAU :
 * on enregistre token_hash ET encrypted_token.
 *
 * Les nouveaux liens remplacent les anciens.
 */

const createCompanyGalleryShare = async (
  req,
  res
) => {
  disableGalleryCache(res);

  const companyId =
    req.user?.companyId;

  const userId =
    req.user?.id;

  if (!companyId || !userId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  let frontendUrl;
  let token;
  let tokenHash;
  let encryptedToken;

  /*
   * Préparation du lien AVANT la transaction.
   *
   * Si la clé de chiffrement est incorrecte,
   * aucun lien existant ne sera révoqué.
   */

  try {
    frontendUrl = getFrontendUrl();

    token = crypto
      .randomBytes(32)
      .toString("hex");

    tokenHash =
      hashToken(token);

    encryptedToken =
      encryptGalleryToken(token);
  } catch (error) {
    console.error(
      "[COMPANY GALLERY] SHARE CONFIG:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Configuration du partage indisponible.",
    });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /*
     * Verrouillage de l'entreprise.
     */

    const companyResult = await client.query(
      `
      SELECT id
      FROM companies
      WHERE id = $1
        AND status = 'ACTIVE'
      FOR UPDATE
      `,
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message:
          "Entreprise inactive ou introuvable.",
      });
    }

    /*
     * Désactivation des anciens liens.
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
     * Création du nouveau lien avec :
     *
     * token_hash : vérification publique
     * encrypted_token : récupération privée
     */

    const result = await client.query(
      `
      INSERT INTO company_gallery_shares (
        company_id,
        token_hash,
        encrypted_token,
        created_by_user_id,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        NOW() + (
          $5::INTEGER * INTERVAL '1 day'
        )
      )
      RETURNING
        id,
        created_at AS "createdAt",
        expires_at AS "expiresAt"
      `,
      [
        companyId,
        tokenHash,
        encryptedToken,
        userId,
        SHARE_DURATION_DAYS,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,

      message:
        "Lien de partage créé.",

      shareUrl:
        `${frontendUrl}/galerie-partagee/${token}`,

      expiresAt:
        result.rows[0].expiresAt,
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
 * CORRECTION PRINCIPALE :
 *
 * Le lien existant est maintenant retrouvé
 * depuis PostgreSQL.
 *
 * On déchiffre le token uniquement pour
 * le compte entreprise authentifié.
 */

const getCompanyGalleryShare = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const companyId =
      req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message:
          "Entreprise introuvable.",
      });
    }

    const result = await db.query(
      `
      SELECT
        id,

        token_hash
          AS "tokenHash",

        encrypted_token
          AS "encryptedToken",

        created_at
          AS "createdAt",

        expires_at
          AS "expiresAt"

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

    /*
     * Aucun partage actif.
     */

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,

        active: false,

        share: null,

        shareUrl: null,
      });
    }

    const share =
      result.rows[0];

    let shareUrl = null;

    /*
     * Les anciens liens, créés avant
     * l'ajout du chiffrement, ont encrypted_token NULL.
     *
     * Ils restent actifs mais leur URL
     * n'est pas récupérable depuis le hash.
     */

    if (share.encryptedToken) {
      const token = decryptGalleryToken(
        share.encryptedToken
      );

      /*
       * On vérifie que la version chiffrée
       * correspond bien au hash enregistré.
       */

      const calculatedHash =
        hashToken(token);

      const expectedHash =
        share.tokenHash;

      if (
        !/^[a-f0-9]{64}$/.test(expectedHash) ||
        !crypto.timingSafeEqual(
          Buffer.from(calculatedHash, "hex"),
          Buffer.from(expectedHash, "hex")
        )
      ) {
        throw new Error(
          "Le token ne correspond pas au partage enregistré."
        );
      }

      const frontendUrl =
        getFrontendUrl();

      shareUrl =
        `${frontendUrl}/galerie-partagee/${token}`;
    }

    /*
     * On ne renvoie jamais :
     *
     * - token_hash
     * - encrypted_token
     * - clé de chiffrement
     *
     * Uniquement l'URL pour l'entreprise connectée.
     */

    return res.status(200).json({
      success: true,

      active: true,

      share: {
        id: share.id,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
      },

      shareUrl,
    });
  } catch (error) {
    console.error(
      "[COMPANY GALLERY] GET SHARE ERROR:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer le lien de partage.",
    });
  }
};

/*
 * =========================================================
 * DELETE /company/gallery/share
 * =========================================================
 *
 * Le bouton Désactiver fonctionne comme avant.
 */

const revokeCompanyGalleryShare = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const companyId =
      req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message:
          "Entreprise introuvable.",
      });
    }

    await db.query(
      `
      UPDATE company_gallery_shares
      SET revoked_at = NOW()

      WHERE
        company_id = $1
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
 * Aucun changement du fonctionnement public.
 *
 * Le visiteur utilise le token dans son URL.
 * Le backend vérifie son hash en BDD.
 */

const getPublicCompanyGallery = async (
  req,
  res
) => {
  disableGalleryCache(res);

  try {
    const token =
      req.params.token;

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
        message:
          "Pagination invalide.",
      });
    }

    /*
     * Vérification du lien public.
     *
     * On utilise toujours token_hash,
     * et NON encrypted_token.
     */

    const result = await db.query(
      `
      SELECT
        s.company_id
          AS "companyId",

        s.expires_at
          AS "expiresAt",

        co.name
          AS "companyName"

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

    const share =
      result.rows[0];

    /*
     * Les portraits proviennent uniquement
     * de l'entreprise associée au lien.
     */

    const data = await fetchFinalPortraits(
      share.companyId,
      offset
    );

    return res.status(200).json({
      success: true,

      companyName:
        share.companyName,

      expiresAt:
        share.expiresAt,

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
 * Les routes existantes continuent de fonctionner.
 */

module.exports = {
  getCompanyGalleryPortraits,

  createCompanyGalleryShare,

  getCompanyGalleryShare,

  revokeCompanyGalleryShare,

  getPublicCompanyGallery,
};
