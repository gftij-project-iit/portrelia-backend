const { db } = require("../../config/db");

const getCampaigns = async (req, res) => {
  try {
    const companyId =
      req.user.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message:
          "Aucune entreprise associée à ce compte",
      });
    }

    const result =
      await db.query(
        `
        SELECT
          c.id,
          c.name,
          c.description,
          c.status,

          c.deadline_at
            AS "deadlineAt",

          c.created_at
            AS "createdAt",

          c.updated_at
            AS "updatedAt",

          ps.id
            AS "styleId",

          ps.name
            AS "styleName",

          ps.slug
            AS "styleSlug",

          COUNT(
            DISTINCT p.id
          )::INTEGER
            AS participants,

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE
              ip.id IS NOT NULL
          )::INTEGER
            AS "photosReceived",

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE
              p.validated_at
              IS NOT NULL
          )::INTEGER
            AS validated,

          CASE
            WHEN
              COUNT(
                DISTINCT p.id
              ) = 0
            THEN 0

            ELSE
              ROUND(
                (
                  COUNT(
                    DISTINCT p.id
                  ) FILTER (
                    WHERE
                      p.validated_at
                      IS NOT NULL
                  )::NUMERIC
                  /
                  COUNT(
                    DISTINCT p.id
                  )::NUMERIC
                ) * 100
              )::INTEGER
          END
            AS progress

        FROM campaigns c

        LEFT JOIN portrait_styles ps
          ON ps.id = c.style_id

        LEFT JOIN participants p
          ON p.campaign_id = c.id

        LEFT JOIN input_photos ip
          ON ip.participant_id = p.id

        WHERE
          c.company_id = $1

        GROUP BY
          c.id,
          c.name,
          c.description,
          c.status,
          c.deadline_at,
          c.created_at,
          c.updated_at,
          ps.id,
          ps.name,
          ps.slug

        ORDER BY
          c.created_at DESC
        `,
        [
          companyId,
        ]
      );

    return res.status(200).json({
      success: true,

      data: {
        campaigns:
          result.rows,
      },
    });
  } catch (error) {
    console.error(
      "Erreur getCampaigns :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer les campagnes",
    });
  }
};

module.exports = {
  getCampaigns,
};