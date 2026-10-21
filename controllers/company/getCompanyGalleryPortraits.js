
const crypto = require("crypto");
const { db } = require("../../config/db");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET =
  process.env.SUPABASE_GENERATED_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET;

const PAGE_SIZE = 24;
const MAX_PAGES = 100000;
const SHARE_DAYS = 7;
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

const noCache = (res) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Referrer-Policy", "no-referrer");
};

const fail = (res, error, message) => {
  console.error("[COMPANY GALLERY]", error);
  return res.status(500).json({
    success: false,
    message,
  });
};

const positiveId = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
};

const getOffset = (cursor) => {
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
    offset > MAX_PAGES * PAGE_SIZE ||
    offset % PAGE_SIZE !== 0
  ) {
    return null;
  }

  return offset;
};

const hashToken = (value) =>
  crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");

const encryptionKey = () => {
  const raw = process.env.GALLERY_TOKEN_ENCRYPTION_KEY;

  if (!/^[a-f0-9]{64}$/i.test(raw || "")) {
    throw new Error(
      "GALLERY_TOKEN_ENCRYPTION_KEY invalide."
    );
  }

  return Buffer.from(raw, "hex");
};

const encryptToken = (token) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
};

const decryptToken = (value) => {
  if (!value) return null;

  const parts = value.split(":");

  if (
    parts.length !== 3 ||
    !/^[a-f0-9]{24}$/i.test(parts[0]) ||
    !/^[a-f0-9]{32}$/i.test(parts[1]) ||
    !/^[a-f0-9]+$/i.test(parts[2]) ||
    parts[2].length % 2 !== 0
  ) {
    throw new Error("Token chiffré invalide.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(parts[0], "hex")
  );

  decipher.setAuthTag(Buffer.from(parts[1], "hex"));

  const token = Buffer.concat([
    decipher.update(Buffer.from(parts[2], "hex")),
    decipher.final(),
  ]).toString("utf8");

  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("Token déchiffré invalide.");
  }

  return token;
};

const frontendOrigin = () => {
  const value = process.env.FRONTEND_URL?.trim();

  if (!value) {
    throw new Error("FRONTEND_URL manquante.");
  }

  const url = new URL(value);
  const localhost =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);

  if (
    (url.protocol !== "https:" && !localhost) ||
    (process.env.NODE_ENV === "production" &&
      url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("FRONTEND_URL invalide.");
  }

  return url.origin;
};

/*
 * NORMALISATION SUPABASE
 * Même fonctionnement que la version entreprise validée.
 */

const normalizeStorageKey = (storageKey) => {
  if (
    typeof storageKey !== "string" ||
    !storageKey.trim()
  ) {
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
    key.split("/").some(
      (part) => part === "." || part === ".."
    )
  ) {
    throw new Error("Clé de stockage invalide.");
  }

  return key;
};

const signedPortraitUrl = async (storageKey, portraitId) => {
  if (!supabase || !BUCKET) {
    throw new Error("Supabase non configuré.");
  }

  const key = normalizeStorageKey(storageKey);

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(key, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error("[GALLERY] SUPABASE SIGN", {
      portraitId,
      message: error?.message,
      bucket: BUCKET,
    });

    throw new Error(
      "Impossible de signer le portrait final."
    );
  }

  const url = new URL(data.signedUrl);

  if (
    url.protocol !== "https:" ||
    url.origin !== new URL(SUPABASE_URL).origin
  ) {
    throw new Error("URL du portrait non autorisée.");
  }

  return data.signedUrl;
};

const verifyCompanyCampaign = async (
  executor,
  companyId,
  campaignId,
  lock = false
) => {
  const result = await executor.query(
    `
    SELECT c.id, c.name
    FROM campaigns c
    JOIN companies co ON co.id = c.company_id
    WHERE c.id = $1
      AND c.company_id = $2
      AND co.status = 'ACTIVE'
    ${lock ? "FOR UPDATE OF c" : ""}
    `,
    [campaignId, companyId]
  );

  return result.rows[0] || null;
};

/*
 * LISTE DES PORTRAITS FINAUX
 *
 * campaignId = null : galerie privée globale de l'entreprise
 * campaignId fourni : uniquement la campagne du lien public
 */

const fetchFinalPortraits = async (
  companyId,
  campaignId,
  offset
) => {
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
      COALESCE(ps.updated_at, ps.created_at)
        AS "selectedAt"
    FROM galleries g
    JOIN participants p
      ON p.id = g.participant_id
    JOIN campaigns c
      ON c.id = p.campaign_id
    JOIN participant_selections ps
      ON ps.participant_id = p.id
      AND ps.is_final_selection = TRUE
    JOIN generated_portraits gp
      ON gp.id = ps.portrait_id
    LEFT JOIN portrait_styles pst
      ON pst.id = c.style_id
    WHERE c.company_id = $1
      AND ($2::BIGINT IS NULL OR c.id = $2)
      AND g.published_at IS NOT NULL
      AND (g.expires_at IS NULL OR g.expires_at > NOW())
      AND gp.storage_key IS NOT NULL
      AND TRIM(gp.storage_key) <> ''
    ORDER BY
      COALESCE(ps.updated_at, ps.created_at) DESC,
      gp.id DESC
    LIMIT $3
    OFFSET $4
    `,
    [companyId, campaignId, PAGE_SIZE + 1, offset]
  );

  const hasMore = result.rows.length > PAGE_SIZE;

  const portraits = await Promise.all(
    result.rows.slice(0, PAGE_SIZE).map(async (row) => {
      const imageUrl = await signedPortraitUrl(
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
        downloadUrl: null,
        canDownload: false,
        createdAt: row.selectedAt,
      };
    })
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
 * GET /company/gallery/portraits
 *
 * Conserve la galerie privée regroupant
 * tous les portraits de l'entreprise.
 */

const getCompanyGalleryPortraits = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.user?.companyId);
  const offset = getOffset(req.query.cursor);

  if (!companyId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  if (offset === null) {
    return res.status(400).json({
      success: false,
      message: "Pagination invalide.",
    });
  }

  try {
    const data = await fetchFinalPortraits(
      companyId,
      null,
      offset
    );

    return res.json({ success: true, data });
  } catch (error) {
    return fail(
      res,
      error,
      "Impossible de charger les portraits."
    );
  }
};

/*
 * GET /company/gallery/campaigns
 *
 * Liste les campagnes de l'entreprise.
 * Sert au menu de sélection du partage.
 */

const getCompanyGalleryCampaigns = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.user?.companyId);

  if (!companyId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  try {
    const result = await db.query(
      `
      SELECT c.id, c.name
      FROM campaigns c
      JOIN companies co ON co.id = c.company_id
      WHERE c.company_id = $1
        AND co.status = 'ACTIVE'
      ORDER BY c.name ASC, c.id ASC
      `,
      [companyId]
    );

    return res.json({
      success: true,
      campaigns: result.rows,
    });
  } catch (error) {
    return fail(
      res,
      error,
      "Impossible de charger les campagnes."
    );
  }
};

/*
 * POST /company/gallery/share
 *
 * Body : { campaignId }
 *
 * Remplace seulement le lien de cette campagne.
 * Ne touche jamais aux liens des autres campagnes.
 */

const createCompanyGalleryShare = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.user?.companyId);
  const userId = positiveId(req.user?.id);
  const campaignId = positiveId(req.body?.campaignId);

  if (!companyId || !userId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  if (!campaignId) {
    return res.status(400).json({
      success: false,
      message: "Veuillez sélectionner une campagne.",
    });
  }

  let token;
  let tokenHash;
  let encryptedToken;
  let origin;

  try {
    origin = frontendOrigin();
    token = crypto.randomBytes(32).toString("hex");
    tokenHash = hashToken(token);
    encryptedToken = encryptToken(token);
  } catch (error) {
    return fail(
      res,
      error,
      "Configuration du partage indisponible."
    );
  }

  let client;

  try {
    client = await db.connect();
    await client.query("BEGIN");

    const campaign = await verifyCompanyCampaign(
      client,
      companyId,
      campaignId,
      true
    );

    if (!campaign) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Campagne introuvable.",
      });
    }

    await client.query(
      `
      UPDATE company_gallery_shares
      SET revoked_at = NOW()
      WHERE company_id = $1
        AND campaign_id = $2
        AND revoked_at IS NULL
      `,
      [companyId, campaignId]
    );

    const result = await client.query(
      `
      INSERT INTO company_gallery_shares (
        company_id,
        campaign_id,
        token_hash,
        encrypted_token,
        created_by_user_id,
        expires_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        NOW() + ($6::INTEGER * INTERVAL '1 day')
      )
      RETURNING
        id,
        expires_at AS "expiresAt"
      `,
      [
        companyId,
        campaignId,
        tokenHash,
        encryptedToken,
        userId,
        SHARE_DAYS,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Lien de campagne créé.",
      campaignId,
      campaignName: campaign.name,
      shareUrl: `${origin}/galerie-partagee/${token}`,
      expiresAt: result.rows[0].expiresAt,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    return fail(
      res,
      error,
      "Impossible de créer le partage."
    );
  } finally {
    client?.release();
  }
};

/*
 * GET /company/gallery/share?campaignId=...
 */

const getCompanyGalleryShare = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.user?.companyId);
  const campaignId = positiveId(req.query.campaignId);

  if (!companyId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  if (!campaignId) {
    return res.status(400).json({
      success: false,
      message: "Sélectionnez une campagne.",
    });
  }

  try {
    const campaign = await verifyCompanyCampaign(
      db,
      companyId,
      campaignId
    );

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campagne introuvable.",
      });
    }

    const result = await db.query(
      `
      SELECT
        id,
        token_hash AS "tokenHash",
        encrypted_token AS "encryptedToken",
        created_at AS "createdAt",
        expires_at AS "expiresAt"
      FROM company_gallery_shares
      WHERE company_id = $1
        AND campaign_id = $2
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [companyId, campaignId]
    );

    if (!result.rows.length) {
      return res.json({
        success: true,
        active: false,
        campaignId,
        campaignName: campaign.name,
        share: null,
        shareUrl: null,
      });
    }

    const share = result.rows[0];
    let shareUrl = null;

    if (share.encryptedToken) {
      const token = decryptToken(share.encryptedToken);

      if (
        !/^[a-f0-9]{64}$/i.test(share.tokenHash || "") ||
        !crypto.timingSafeEqual(
          Buffer.from(hashToken(token), "hex"),
          Buffer.from(share.tokenHash, "hex")
        )
      ) {
        throw new Error("Hash de partage incohérent.");
      }

      shareUrl =
        `${frontendOrigin()}/galerie-partagee/${token}`;
    }

    return res.json({
      success: true,
      active: true,
      campaignId,
      campaignName: campaign.name,
      share: {
        id: share.id,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
      },
      shareUrl,
    });
  } catch (error) {
    return fail(
      res,
      error,
      "Impossible de récupérer le partage."
    );
  }
};

/*
 * DELETE /company/gallery/share?campaignId=...
 *
 * Révoque uniquement le partage sélectionné.
 */

const revokeCompanyGalleryShare = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.user?.companyId);
  const campaignId = positiveId(req.query.campaignId);

  if (!companyId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  if (!campaignId) {
    return res.status(400).json({
      success: false,
      message: "Sélectionnez une campagne.",
    });
  }

  try {
    const campaign = await verifyCompanyCampaign(
      db,
      companyId,
      campaignId
    );

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campagne introuvable.",
      });
    }

    await db.query(
      `
      UPDATE company_gallery_shares
      SET revoked_at = NOW()
      WHERE company_id = $1
        AND campaign_id = $2
        AND revoked_at IS NULL
      `,
      [companyId, campaignId]
    );

    return res.json({
      success: true,
      campaignId,
      message: "Lien de la campagne désactivé.",
    });
  } catch (error) {
    return fail(
      res,
      error,
      "Impossible de désactiver le partage."
    );
  }
};

/*
 * GET /public/gallery/:token
 *
 * Le token identifie une campagne précise.
 * Aucun portrait d'une autre campagne ne sort.
 */

const getPublicCompanyGallery = async (req, res) => {
  noCache(res);

  const token = req.params.token;
  const offset = getOffset(req.query.cursor);

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return res.status(404).json({
      success: false,
      message: "Lien de partage introuvable.",
    });
  }

  if (offset === null) {
    return res.status(400).json({
      success: false,
      message: "Pagination invalide.",
    });
  }

  try {
    const result = await db.query(
      `
      SELECT
        s.company_id AS "companyId",
        s.campaign_id AS "campaignId",
        s.expires_at AS "expiresAt",
        co.name AS "companyName",
        c.name AS "campaignName"
      FROM company_gallery_shares s
      JOIN companies co
        ON co.id = s.company_id
      JOIN campaigns c
        ON c.id = s.campaign_id
        AND c.company_id = co.id
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
        message:
          "Ce lien est expiré ou a été désactivé.",
      });
    }

    const share = result.rows[0];

    const data = await fetchFinalPortraits(
      share.companyId,
      share.campaignId,
      offset
    );

    return res.json({
      success: true,
      companyName: share.companyName,
      campaignId: share.campaignId,
      campaignName: share.campaignName,
      expiresAt: share.expiresAt,
      data,
    });
  } catch (error) {
    return fail(
      res,
      error,
      "Impossible de consulter la galerie."
    );
  }
};

module.exports = {
  getCompanyGalleryPortraits,
  getCompanyGalleryCampaigns,
  createCompanyGalleryShare,
  getCompanyGalleryShare,
  revokeCompanyGalleryShare,
  getPublicCompanyGallery,
};
