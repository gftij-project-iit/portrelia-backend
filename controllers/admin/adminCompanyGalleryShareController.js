
const crypto = require("crypto");

const { db } = require("../../config/db");

/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

const getEncryptionKey = () => {
  const value = process.env.GALLERY_TOKEN_ENCRYPTION_KEY;

  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value)
  ) {
    throw new Error(
      "GALLERY_TOKEN_ENCRYPTION_KEY invalide."
    );
  }

  return Buffer.from(value, "hex");
};

const getFrontendUrl = () => {
  const value = process.env.FRONTEND_URL?.trim();

  if (!value) {
    throw new Error("FRONTEND_URL manquante.");
  }

  const url = new URL(value);

  const isHttps = url.protocol === "https:";

  const isLocal =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(
      url.hostname
    );

  if (
    (!isHttps && !isLocal) ||
    (process.env.NODE_ENV === "production" && !isHttps) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("FRONTEND_URL invalide.");
  }

  return url.origin;
};

const hashToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};

const parsePositiveId = (value) => {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value)
  ) {
    return null;
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    return null;
  }

  return id;
};

/*
 * =========================================================
 * DECHIFFREMENT AES-256-GCM
 * =========================================================
 *
 * Même format que le backend Entreprise :
 *
 * iv:tag:encrypted
 *
 * Le token n'est jamais enregistré en clair.
 */

const decryptGalleryToken = (encryptedToken) => {
  if (
    typeof encryptedToken !== "string" ||
    !encryptedToken
  ) {
    return null;
  }

  const parts = encryptedToken.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "Format du token chiffré invalide."
    );
  }

  const [ivHex, tagHex, encryptedHex] = parts;

  if (
    !/^[a-f0-9]{24}$/i.test(ivHex) ||
    !/^[a-f0-9]{32}$/i.test(tagHex) ||
    !/^[a-f0-9]+$/i.test(encryptedHex) ||
    encryptedHex.length % 2 !== 0
  ) {
    throw new Error(
      "Contenu du token chiffré invalide."
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(
    Buffer.from(tagHex, "hex")
  );

  const token = Buffer.concat([
    decipher.update(
      Buffer.from(encryptedHex, "hex")
    ),
    decipher.final(),
  ]).toString("utf8");

  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(
      "Token de partage invalide."
    );
  }

  return token;
};

/*
 * =========================================================
 * GET /api/v1/admin/companies/:companyId/
 *     campaigns/:campaignId/gallery-share
 * =========================================================
 *
 * ADMIN uniquement.
 *
 * 1. Vérifier que l'entreprise existe.
 * 2. Vérifier que la campagne appartient à l'entreprise.
 * 3. Récupérer uniquement le lien actif de cette campagne.
 * 4. Déchiffrer le token.
 * 5. Retourner l'URL au frontend Admin.
 *
 * Aucun INSERT, UPDATE ou DELETE.
 */

const getAdminCompanyGalleryShare = async (req, res) => {
  res.set(
    "Cache-Control",
    "private, no-store, max-age=0"
  );

  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Referrer-Policy", "no-referrer");

  const companyId = parsePositiveId(
    req.params.companyId
  );

  const campaignId = parsePositiveId(
    req.params.campaignId
  );

  if (!companyId || !campaignId) {
    return res.status(400).json({
      success: false,
      message:
        "Identifiant d'entreprise ou de campagne invalide.",
    });
  }

  try {
    /*
     * =====================================================
     * VERIFICATION ENTREPRISE + CAMPAGNE
     * =====================================================
     */

    const campaignResult = await db.query(
      `
      SELECT
        co.id AS "companyId",
        co.name AS "companyName",

        c.id AS "campaignId",
        c.name AS "campaignName"

      FROM campaigns c

      INNER JOIN companies co
        ON co.id = c.company_id

      WHERE
        co.id = $1
        AND c.id = $2

      LIMIT 1
      `,
      [companyId, campaignId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Campagne introuvable pour cette entreprise.",
      });
    }

    const campaign = campaignResult.rows[0];

    /*
     * =====================================================
     * RECHERCHE DU LIEN PUBLIC DE CETTE CAMPAGNE
     * =====================================================
     *
     * IMPORTANT :
     *
     * company_id ET campaign_id sont obligatoires.
     *
     * Une entreprise peut avoir plusieurs campagnes
     * avec un lien actif différent pour chacune.
     */

    const result = await db.query(
      `
      SELECT
        s.id AS "shareId",

        s.company_id AS "companyId",
        s.campaign_id AS "campaignId",

        s.token_hash AS "tokenHash",
        s.encrypted_token AS "encryptedToken",

        s.created_at AS "createdAt",
        s.expires_at AS "expiresAt"

      FROM company_gallery_shares s

      WHERE
        s.company_id = $1
        AND s.campaign_id = $2
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()

      ORDER BY
        s.created_at DESC,
        s.id DESC

      LIMIT 1
      `,
      [companyId, campaignId]
    );

    /*
     * =====================================================
     * AUCUN PARTAGE ACTIF POUR CETTE CAMPAGNE
     * =====================================================
     */

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,

        active: false,

        companyId: campaign.companyId,
        companyName: campaign.companyName,

        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,

        share: null,
        shareUrl: null,
      });
    }

    const row = result.rows[0];

    let shareUrl = null;

    /*
     * =====================================================
     * DECHIFFREMENT DU LIEN
     * =====================================================
     */

    if (row.encryptedToken) {
      const token = decryptGalleryToken(
        row.encryptedToken
      );

      const actualHash = hashToken(token);

      const expectedHash = row.tokenHash;

      if (
        typeof expectedHash !== "string" ||
        !/^[a-f0-9]{64}$/i.test(expectedHash) ||
        !crypto.timingSafeEqual(
          Buffer.from(actualHash, "hex"),
          Buffer.from(expectedHash, "hex")
        )
      ) {
        throw new Error(
          "Le token ne correspond pas au partage enregistré."
        );
      }

      shareUrl =
        `${getFrontendUrl()}/galerie-partagee/${token}`;
    }

    /*
     * =====================================================
     * REPONSE FRONTEND ADMIN
     * =====================================================
     *
     * Ne jamais retourner :
     * - token_hash
     * - encrypted_token
     * - clé de chiffrement
     */

    return res.status(200).json({
      success: true,

      active: true,

      companyId: campaign.companyId,
      companyName: campaign.companyName,

      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,

      share: {
        id: row.shareId,

        companyId: campaign.companyId,
        campaignId: campaign.campaignId,

        createdAt: row.createdAt,
        expiresAt: row.expiresAt,

        shareUrl,
      },

      shareUrl,
    });
  } catch (error) {
    console.error(
      "[ADMIN CAMPAIGN GALLERY SHARE]",
      {
        message: error.message,
        companyId,
        campaignId,
      }
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer le lien public de cette campagne.",
    });
  }
};

module.exports = {
  getAdminCompanyGalleryShare,
};
