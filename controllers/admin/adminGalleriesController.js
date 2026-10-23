const { createClient } = require("@supabase/supabase-js");
const { db } = require("../../config/db");

/*
 * =========================================================
 * CONFIGURATION SUPABASE
 * =========================================================
 * Même logique que la galerie entreprise (qui fonctionne
 * en production) : bucket des portraits générés, avec
 * repli sur le bucket de stockage général.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET =
  process.env.SUPABASE_GENERATED_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET;

const SIGNED_URL_SECONDS = 3600;

const supabase =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

if (!supabase || !BUCKET) {
  console.error("[ADMIN GALLERIES] Configuration Supabase incomplète", {
    hasSupabaseUrl: Boolean(SUPABASE_URL),
    hasServiceKey: Boolean(SERVICE_KEY),
    bucket: BUCKET || null,
  });
}

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

const noCache = (res) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Referrer-Policy", "no-referrer");
};

const positiveId = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
};

/*
 * Accepte :
 * - une clé simple : "campagne/portrait.jpg"
 * - une clé préfixée par le bucket : "bucket/campagne/portrait.jpg"
 * - une URL Supabase complète (public / sign / authenticated)
 */

const normalizeStorageKey = (storageKey) => {
  if (typeof storageKey !== "string" || !storageKey.trim()) {
    throw new Error("Chemin du portrait manquant.");
  }

  if (!SUPABASE_URL || !BUCKET) {
    throw new Error("Configuration Supabase incomplète.");
  }

  let key = storageKey.trim();

  if (/^https?:\/\//i.test(key)) {
    const url = new URL(key);

    if (url.origin !== new URL(SUPABASE_URL).origin) {
      throw new Error("Stockage non autorisé.");
    }

    const markers = [
      `/storage/v1/object/public/${BUCKET}/`,
      `/storage/v1/object/sign/${BUCKET}/`,
      `/storage/v1/object/authenticated/${BUCKET}/`,
    ];

    const marker = markers.find((item) =>
      url.pathname.includes(item)
    );

    if (!marker) {
      throw new Error("URL Supabase invalide.");
    }

    key = url.pathname.split(marker)[1] || "";
  }

  key = key.replace(/^\/+/, "");

  if (key.startsWith(`${BUCKET}/`)) {
    key = key.slice(BUCKET.length + 1);
  }

  try {
    key = decodeURIComponent(key);
  } catch {
    throw new Error("Encodage du portrait invalide.");
  }

  if (
    !key ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Clé de stockage invalide.");
  }

  return key;
};

/*
 * Retourne une URL signée HTTPS, ou null si le fichier
 * est introuvable. L'erreur est toujours loggée avec
 * le détail pour pouvoir diagnostiquer en production.
 */

const createSignedImageUrl = async (storageKey, portraitId) => {
  if (!storageKey) return null;

  if (!supabase || !BUCKET) {
    console.error("[ADMIN GALLERIES] SIGN SKIPPED: Supabase non configuré", {
      portraitId,
    });
    return null;
  }

  try {
    const key = normalizeStorageKey(storageKey);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(key, SIGNED_URL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error("[ADMIN GALLERIES] SIGN ERROR", {
        portraitId,
        bucket: BUCKET,
        key,
        message: error?.message,
      });
      return null;
    }

    const url = new URL(data.signedUrl);

    if (
      url.protocol !== "https:" ||
      url.origin !== new URL(SUPABASE_URL).origin
    ) {
      console.error("[ADMIN GALLERIES] SIGN REJECTED: URL non autorisée", {
        portraitId,
        origin: url.origin,
      });
      return null;
    }

    return data.signedUrl;
  } catch (error) {
    console.error("[ADMIN GALLERIES] SIGN EXCEPTION", {
      portraitId,
      bucket: BUCKET,
      message: error?.message,
    });
    return null;
  }
};

/*
 * =========================================================
 * GET /api/v1/admin/galleries
 * =========================================================
 *
 * Query (optionnels) :
 * - companyId
 * - campaignId
 *
 * Retourne galeries + participant + campagne + entreprise
 * + statut + dates + portrait final signé.
 */

const getAdminGalleries = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.query.companyId);
  const campaignId = positiveId(req.query.campaignId);

  if (
    (req.query.companyId && !companyId) ||
    (req.query.campaignId && !campaignId)
  ) {
    return res.status(400).json({
      success: false,
      message: "Filtre entreprise ou campagne invalide.",
    });
  }

  try {
    /*
     * GALERIES (filtrées côté serveur)
     */

    const galleriesResult = await db.query(
      `
      SELECT
        g.id,
        g.public_token        AS "publicToken",
        g.published_at        AS "publishedAt",
        g.expires_at          AS "expiresAt",
        g.created_at          AS "createdAt",

        p.id                  AS "participantId",
        p.first_name          AS "participantFirstName",
        p.last_name           AS "participantLastName",
        p.email               AS "participantEmail",
        p.status              AS "participantStatus",

        c.id                  AS "campaignId",
        c.name                AS "campaignName",

        co.id                 AS "companyId",
        co.name               AS "companyName",

        ps.id                 AS "selectionId",
        ps.portrait_id        AS "selectedPortraitId",
        ps.created_at         AS "selectionCreatedAt",
        ps.updated_at         AS "selectionUpdatedAt",

        gp.storage_key        AS "selectedPortraitStorageKey",
        gp.status             AS "selectedPortraitStatus",
        gp.is_selected_by_participant AS "isSelectedByParticipant"

      FROM galleries g
      JOIN participants p
        ON p.id = g.participant_id
      JOIN campaigns c
        ON c.id = p.campaign_id
      JOIN companies co
        ON co.id = c.company_id
      LEFT JOIN participant_selections ps
        ON ps.participant_id = p.id
        AND ps.is_final_selection = TRUE
      LEFT JOIN generated_portraits gp
        ON gp.id = ps.portrait_id

      WHERE ($1::BIGINT IS NULL OR co.id = $1)
        AND ($2::BIGINT IS NULL OR c.id = $2)

      ORDER BY
        g.published_at DESC NULLS LAST,
        g.created_at DESC
      `,
      [companyId, campaignId]
    );

    /*
     * URLS SIGNÉES
     */

    const galleries = await Promise.all(
      galleriesResult.rows.map(async (row) => {
        let selectedPortrait = null;

        if (row.selectedPortraitId) {
          const imageUrl = await createSignedImageUrl(
            row.selectedPortraitStorageKey,
            row.selectedPortraitId
          );

          selectedPortrait = {
            id: row.selectedPortraitId,
            status: row.selectedPortraitStatus,
            isSelectedByParticipant: Boolean(
              row.isSelectedByParticipant
            ),
            imageUrl,
            fileAvailable: Boolean(imageUrl),
            selectedAt:
              row.selectionUpdatedAt ||
              row.selectionCreatedAt ||
              null,
          };
        }

        return {
          id: row.id,
          publicToken: row.publicToken,
          publishedAt: row.publishedAt,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,

          participantId: row.participantId,
          participantFirstName: row.participantFirstName,
          participantLastName: row.participantLastName,
          participantEmail: row.participantEmail,
          participantStatus: row.participantStatus,

          campaignId: row.campaignId,
          campaignName: row.campaignName,

          companyId: row.companyId,
          companyName: row.companyName,

          participant: {
            id: row.participantId,
            firstName: row.participantFirstName,
            lastName: row.participantLastName,
            email: row.participantEmail,
            status: row.participantStatus,
          },

          campaign: {
            id: row.campaignId,
            name: row.campaignName,
          },

          company: {
            id: row.companyId,
            name: row.companyName,
          },

          selectedPortrait,
        };
      })
    );

    /*
     * CAMPAGNES (pour les filtres)
     */

    const campaignsResult = await db.query(
      `
      SELECT DISTINCT
        c.id,
        c.name,
        co.id   AS "companyId",
        co.name AS "companyName"
      FROM galleries g
      JOIN participants p
        ON p.id = g.participant_id
      JOIN campaigns c
        ON c.id = p.campaign_id
      JOIN companies co
        ON co.id = c.company_id
      WHERE ($1::BIGINT IS NULL OR co.id = $1)
      ORDER BY c.name ASC
      `,
      [companyId]
    );

    return res.status(200).json({
      success: true,
      data: {
        galleries,
        campaigns: campaignsResult.rows,
      },
    });
  } catch (error) {
    console.error("[ADMIN GALLERIES] ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de charger les galeries.",
    });
  }
};

module.exports = {
  getAdminGalleries,
};