const { db } = require("../../config/db");

/*
 * =========================================================
 * GET /api/v1/admin/dashboard
 * =========================================================
 * Chaque bloc est indépendant : si une requête échoue,
 * le reste du dashboard s'affiche quand même.
 */

const noCache = (res) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

const safeQuery = async (label, sql, params = []) => {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (error) {
    console.error(`[ADMIN DASHBOARD] ${label}:`, error.message);
    return null;
  }
};

const getAdminDashboard = async (req, res) => {
  noCache(res);

  try {
    const [
      companiesRows,
      countsRows,
      galleriesRows,
      finalRows,
      portraitStatusRows,
      topCampaignsRows,
    ] = await Promise.all([
      /* ENTREPRISES */
      safeQuery(
        "COMPANIES",
        `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE co.status = 'ACTIVE')::int AS active,
          BOOL_OR(to_jsonb(co) ? 'created_at') AS "hasCreatedAt",
          COUNT(*) FILTER (
            WHERE NULLIF(to_jsonb(co)->>'created_at', '')::timestamptz
              >= date_trunc('month', NOW())
          )::int AS "newThisMonth"
        FROM companies co
        `
      ),

      /* CAMPAGNES + PARTICIPANTS */
      safeQuery(
        "COUNTS",
        `
        SELECT
          (SELECT COUNT(*)::int FROM campaigns)    AS "campaignsTotal",
          (SELECT COUNT(*)::int FROM participants) AS "participantsTotal"
        `
      ),

      /* GALERIES */
      safeQuery(
        "GALLERIES",
        `
        SELECT
          COUNT(*) FILTER (
            WHERE g.published_at IS NOT NULL
          )::int AS published,

          COUNT(*) FILTER (
            WHERE g.published_at IS NOT NULL
              AND (g.expires_at IS NULL OR g.expires_at > NOW())
              AND NOT EXISTS (
                SELECT 1
                FROM participant_selections ps
                WHERE ps.participant_id = g.participant_id
                  AND ps.is_final_selection = TRUE
              )
          )::int AS "waitingChoice",

          COUNT(*) FILTER (
            WHERE g.expires_at IS NOT NULL
              AND g.expires_at <= NOW()
          )::int AS expired
        FROM galleries g
        `
      ),

      /* PORTRAITS FINAUX CHOISIS */
      safeQuery(
        "FINAL SELECTIONS",
        `
        SELECT COUNT(DISTINCT ps.participant_id)::int AS "finalSelected"
        FROM participant_selections ps
        WHERE ps.is_final_selection = TRUE
        `
      ),

      /* PORTRAITS GÉNÉRÉS PAR STATUT (valeurs réelles de la base) */
      safeQuery(
        "PORTRAIT STATUS",
        `
        SELECT
          COALESCE(NULLIF(gp.status::text, ''), 'UNKNOWN') AS status,
          COUNT(*)::int AS count
        FROM generated_portraits gp
        GROUP BY 1
        ORDER BY 2 DESC
        `
      ),

      /* CAMPAGNES LES PLUS ACTIVES */
      safeQuery(
        "TOP CAMPAIGNS",
        `
        SELECT
          c.id,
          c.name,
          co.name AS "companyName",
          COUNT(DISTINCT p.id)::int AS participants,
          COUNT(DISTINCT ps.participant_id)::int AS "finalSelected"
        FROM campaigns c
        JOIN companies co
          ON co.id = c.company_id
        LEFT JOIN participants p
          ON p.campaign_id = c.id
        LEFT JOIN participant_selections ps
          ON ps.participant_id = p.id
          AND ps.is_final_selection = TRUE
        WHERE co.status = 'ACTIVE'
        GROUP BY c.id, c.name, co.name
        ORDER BY COUNT(DISTINCT p.id) DESC, c.id DESC
        LIMIT 6
        `
      ),
    ]);

    const companies = companiesRows?.[0] || null;
    const counts = countsRows?.[0] || null;
    const galleries = galleriesRows?.[0] || null;
    const finals = finalRows?.[0] || null;

    const generatedTotal = Array.isArray(portraitStatusRows)
      ? portraitStatusRows.reduce((sum, row) => sum + row.count, 0)
      : null;

    return res.status(200).json({
      success: true,
      data: {
        companies: companies
          ? {
              total: companies.total,
              active: companies.active,
              newThisMonth: companies.hasCreatedAt
                ? companies.newThisMonth
                : null,
            }
          : null,

        campaigns: counts
          ? { total: counts.campaignsTotal }
          : null,

        participants: counts
          ? { total: counts.participantsTotal }
          : null,

        galleries: galleries
          ? {
              published: galleries.published,
              waitingChoice: galleries.waitingChoice,
              expired: galleries.expired,
            }
          : null,

        portraits: {
          finalSelected: finals ? finals.finalSelected : null,
          generatedTotal,
          byStatus: portraitStatusRows || [],
        },

        topCampaigns: (topCampaignsRows || []).map((row) => ({
          id: row.id,
          name: row.name,
          companyName: row.companyName,
          participants: row.participants,
          finalSelected: row.finalSelected,
          progress:
            row.participants > 0
              ? Math.round((row.finalSelected / row.participants) * 100)
              : 0,
        })),

        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[ADMIN DASHBOARD] ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de charger le tableau de bord.",
    });
  }
};

module.exports = {
  getAdminDashboard,
};