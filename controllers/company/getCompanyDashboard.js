const { db } = require("../../config/db");

/*
 * =========================================================
 * GET /api/v1/company/dashboard
 * =========================================================
 * Statistiques réelles de l'entreprise connectée,
 * par campagne (la plus récente en premier).
 */

const noCache = (res) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

const positiveId = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELED", "ARCHIVED"]);

const getCompanyDashboard = async (req, res) => {
  noCache(res);

  const companyId = positiveId(req.user?.companyId);

  if (!companyId) {
    return res.status(403).json({
      success: false,
      message: "Entreprise introuvable.",
    });
  }

  try {
    const [companyResult, campaignsResult] = await Promise.all([
      db.query(
        `SELECT id, name FROM companies WHERE id = $1 LIMIT 1`,
        [companyId]
      ),

      db.query(
        `
        WITH stats AS (
          SELECT
            p.campaign_id,

            COUNT(DISTINCT p.id)::int AS participants,

            COUNT(DISTINCT g.participant_id) FILTER (
              WHERE g.published_at IS NOT NULL
                AND (g.expires_at IS NULL OR g.expires_at > NOW())
            )::int AS "galleriesReady",

            COUNT(DISTINCT ps.participant_id)::int AS "finalSelected",

            COUNT(DISTINCT g.participant_id) FILTER (
              WHERE g.published_at IS NOT NULL
                AND (g.expires_at IS NULL OR g.expires_at > NOW())
                AND ps.participant_id IS NULL
            )::int AS "waitingChoice",

            COUNT(DISTINCT g.participant_id) FILTER (
              WHERE g.expires_at IS NOT NULL
                AND g.expires_at <= NOW()
                AND ps.participant_id IS NULL
            )::int AS "expiredWithoutChoice",

            COUNT(DISTINCT p.id) FILTER (
              WHERE g.participant_id IS NULL
                OR g.published_at IS NULL
            )::int AS "inProgress"

          FROM participants p
          JOIN campaigns c2
            ON c2.id = p.campaign_id
            AND c2.company_id = $1
          LEFT JOIN galleries g
            ON g.participant_id = p.id
          LEFT JOIN participant_selections ps
            ON ps.participant_id = p.id
            AND ps.is_final_selection = TRUE
          GROUP BY p.campaign_id
        )

        SELECT
          c.id,
          c.name,
          NULLIF(to_jsonb(c)->>'status', '')     AS status,
          NULLIF(to_jsonb(c)->>'created_at', '') AS "createdAt",
          pst.name                               AS "styleName",

          COALESCE(s.participants, 0)           AS participants,
          COALESCE(s."galleriesReady", 0)       AS "galleriesReady",
          COALESCE(s."finalSelected", 0)        AS "finalSelected",
          COALESCE(s."waitingChoice", 0)        AS "waitingChoice",
          COALESCE(s."expiredWithoutChoice", 0) AS "expiredWithoutChoice",
          COALESCE(s."inProgress", 0)           AS "inProgress"

        FROM campaigns c
        LEFT JOIN portrait_styles pst
          ON pst.id = c.style_id
        LEFT JOIN stats s
          ON s.campaign_id = c.id
        WHERE c.company_id = $1
        ORDER BY
          NULLIF(to_jsonb(c)->>'created_at', '')::timestamptz DESC NULLS LAST,
          c.id DESC
        `,
        [companyId]
      ),
    ]);

    const campaigns = campaignsResult.rows.map((row) => {
      const status = row.status ? String(row.status).toUpperCase() : null;

      return {
        id: row.id,
        name: row.name,
        status,
        isCancelled: status ? CANCELLED_STATUSES.has(status) : false,
        createdAt: row.createdAt,
        styleName: row.styleName || null,
        participants: row.participants,
        galleriesReady: row.galleriesReady,
        finalSelected: row.finalSelected,
        waitingChoice: row.waitingChoice,
        expiredWithoutChoice: row.expiredWithoutChoice,
        inProgress: row.inProgress,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        companyName: companyResult.rows[0]?.name || null,
        campaigns,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[COMPANY DASHBOARD] ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de charger le tableau de bord.",
    });
  }
};

module.exports = {
  getCompanyDashboard,
};