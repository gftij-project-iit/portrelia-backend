
const crypto = require("crypto");
const { db } = require("../../config/db");
const { getStripe } = require("../../config/stripe");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET;
const SIGNED_URL_DURATION = 600;
const PAGE_SIZE = 24;
const MAX_PAGES = 100000;
const SHARE_DURATION_DAYS = 7;

/* =========================================================
   SIGNED URLS SUPABASE
========================================================= */

const createSignedImageUrl = async (storageKey) => {
  if (!storageKey || !GENERATED_BUCKET) return null;

  try {
    const { data, error } = await supabase.storage
      .from(GENERATED_BUCKET)
      .createSignedUrl(storageKey, SIGNED_URL_DURATION);

    if (error) {
      console.error("Erreur signed URL galerie :", error);
      return null;
    }

    return data?.signedUrl || null;
  } catch (error) {
    console.error("Erreur Supabase galerie :", error);
    return null;
  }
};

/* =========================================================
   UTILITAIRES
========================================================= */

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const getPagination = (cursor) => {
  if (cursor === undefined) return 0;

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

const toPublicPortrait = async (row) => {
  const imageUrl = await createSignedImageUrl(row.storageKey);

  return {
    id: row.id,
    participantId: row.participantId,
    firstName: row.firstName,
    lastName: row.lastName,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    styleName: row.styleName || "Portrait professionnel",
    imageUrl,
    downloadUrl: null,
    canDownload: false,
    createdAt: row.selectedAt,
  };
};

/* =========================================================
   RÉCUPÉRATION DES PORTRAITS FINAUX

   On ne renvoie que :
   - les campagnes de l'entreprise concernée ;
   - les galeries publiées et non expirées ;
   - les participants ayant validé leur portrait ;
   - les portraits désignés comme sélection finale.

   Les photos sources et les portraits non validés
   ne sont pas envoyés au client.
========================================================= */

const fetchFinalPortraits = async (companyId, offset) => {
  const result = await db.query(
    `
    SELECT
      gp.id,
      gp.storage_key AS "storageKey",

      p.id AS "participantId",
      p.first_name AS "firstName",
      p.last_name AS "lastName",

      c.id AS "campaignId",
      c.name AS "campaignName",

      pst.name AS "styleName",

      COALESCE(
        ps.updated_at,
        ps.created_at
      ) AS "selectedAt"

    FROM participant_selections ps

    JOIN participants p
      ON p.id = ps.participant_id

    JOIN campaigns c
      ON c.id = p.campaign_id

    JOIN galleries g
      ON g.participant_id = p.id

    JOIN generated_portraits gp
      ON gp.id = ps.portrait_id

    LEFT JOIN portrait_styles pst
      ON pst.id = c.style_id

    WHERE
        c.company_id = $1
        AND ps.is_final_selection = TRUE
        AND g.published_at IS NOT NULL
        AND (
            g.expires_at IS NULL
            OR g.expires_at > NOW()
        )
        AND gp.storage_key IS NOT NULL

    ORDER BY
      COALESCE(ps.updated_at, ps.created_at) DESC,
      gp.id DESC

    LIMIT $2
    OFFSET $3
    `,
    [companyId, PAGE_SIZE + 1, offset]
  );

  const hasMore = result.rows.length > PAGE_SIZE;
  const page = result.rows.slice(0, PAGE_SIZE);

  const portraits = await Promise.all(
    page.map(toPublicPortrait)
  );

  return {
    portraits,
    hasMore,
    nextCursor: hasMore
      ? String(offset + PAGE_SIZE)
      : null,
  };
};

/* =========================================================
   GET /company/gallery/portraits

   Galerie privée de l'entreprise connectée.
========================================================= */

const getCompanyGalleryPortraits = async (req, res) => {
  try {
    const companyId = req.user.companyId;

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
    console.error("Erreur galerie entreprise :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de charger les portraits.",
    });
  }
};

/* =========================================================
   POST /company/gallery/share

   L'entreprise crée volontairement un lien public.

   Chaque nouveau lien remplace les précédents.
   Le token est généré aléatoirement et stocké haché.
========================================================= */

const createCompanyGalleryShare = async (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.id;

  if (!companyId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  /*
 * Récupère l'adresse du frontend depuis .env.
 *
 * En développement :
 * http://localhost:5173
 *
 * En production :
 * https://... (domaine configuré sur Render)
 *
 * Aucune adresse n'est écrite en dur.
 */
const frontendUrl = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");

let parsedFrontendUrl;

try {
  parsedFrontendUrl = new URL(frontendUrl);
} catch {
  return res.status(500).json({
    success: false,
    message: "FRONTEND_URL invalide ou manquante.",
  });
}

const isProduction = process.env.NODE_ENV === "production";

const validUrl = isProduction
  ? parsedFrontendUrl.protocol === "https:"
  : (
      parsedFrontendUrl.protocol === "https:" ||
      (
        parsedFrontendUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(
          parsedFrontendUrl.hostname
        )
      )
    );

if (!validUrl) {
  return res.status(500).json({
    success: false,
    message: "FRONTEND_URL doit utiliser HTTPS en production.",
  });
}
  const client = await db.connect();

  try {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);

    await client.query("BEGIN");

    // Empêche deux créations simultanées pour l'entreprise.
    const company = await client.query(
      `
      SELECT id
      FROM companies
      WHERE id = $1 AND status = 'ACTIVE'
      FOR UPDATE
      `,
      [companyId]
    );

    if (!company.rows.length) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message: "Entreprise inactive ou introuvable.",
      });
    }

    // Révoquer les anciens liens encore actifs.
    await client.query(
      `
      UPDATE company_gallery_shares
      SET revoked_at = NOW()
      WHERE company_id = $1
        AND revoked_at IS NULL
      `,
      [companyId]
    );

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
        NOW() + INTERVAL '7 days'
      )
      RETURNING expires_at AS "expiresAt"
      `,
      [companyId, tokenHash, userId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Lien de partage créé.",
      shareUrl: `${frontendUrl}/galerie-partagee/${token}`,
      expiresAt: result.rows[0].expiresAt,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Erreur création partage :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de créer le lien.",
    });
  } finally {
    client.release();
  }
};

/* =========================================================
   GET /company/gallery/share

   Renvoie l'état du lien sans révéler son token secret.
========================================================= */

const getCompanyGalleryShare = async (req, res) => {
  try {
    const companyId = req.user.companyId;

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
      WHERE company_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC, id DESC
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
    console.error("Erreur état partage :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de vérifier le partage.",
    });
  }
};

/* =========================================================
   DELETE /company/gallery/share

   Révoque les liens publics de l'entreprise.
========================================================= */

const revokeCompanyGalleryShare = async (req, res) => {
  try {
    const companyId = req.user.companyId;

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
      message: "Le lien public a été désactivé.",
    });
  } catch (error) {
    console.error("Erreur révocation partage :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de désactiver le lien.",
    });
  }
};

/* =========================================================
   GET /public/gallery/:token

   Accès public par un lien secret.

   Aucun JWT nécessaire :
   le token du lien autorise la lecture des portraits
   finaux tant que le partage n'est pas expiré ou révoqué.

   Les noms, campagnes et images finales deviennent
   accessibles aux détenteurs du lien.
========================================================= */

const getPublicCompanyGallery = async (req, res) => {
  try {
    const token = req.params.token;

    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token)
    ) {
      return res.status(404).json({
        success: false,
        message: "Lien de partage introuvable.",
      });
    }

    const offset = getPagination(req.query.cursor);

    if (offset === null) {
      return res.status(400).json({
        success: false,
        message: "Pagination invalide.",
      });
    }

    const result = await db.query(
      `
      SELECT
        s.company_id AS "companyId",
        s.expires_at AS "expiresAt",
        co.name AS "companyName"
      FROM company_gallery_shares s
      JOIN companies co ON co.id = s.company_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND co.status = 'ACTIVE'
      LIMIT 1
      `,
      [hashToken(token)]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Ce lien est expiré ou a été désactivé.",
      });
    }

    const share = result.rows[0];

    const data = await fetchFinalPortraits(
      share.companyId,
      offset
    );

    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");

    return res.status(200).json({
      success: true,
      companyName: share.companyName,
      expiresAt: share.expiresAt,
      data,
    });
  } catch (error) {
    console.error("Erreur galerie publique :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de consulter la galerie.",
    });
  }
};

module.exports = {
  getCompanyGalleryPortraits,
  createCompanyGalleryShare,
  getCompanyGalleryShare,
  revokeCompanyGalleryShare,
  getPublicCompanyGallery,
};
