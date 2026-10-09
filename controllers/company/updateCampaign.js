const { db } = require("../../config/db");

const {
  updateCampaignSchema,
} = require(
  "../../dto/company/updateCampaign.dto"
);

const updateCampaign =
  async (req, res) => {
    const client =
      await db.connect();

    try {
      const companyId =
        req.user.companyId;

      const userId =
        req.user.id;

      const campaignId =
        Number(req.params.id);

      if (
        !Number.isInteger(
          campaignId
        ) ||
        campaignId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Identifiant de campagne invalide",
        });
      }

      const {
        error,
        value,
      } =
        updateCampaignSchema
          .validate(
            req.body,
            {
              abortEarly: false,
              stripUnknown: true,
            }
          );

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            "Données invalides",

          errors:
            error.details.map(
              (detail) => ({
                field:
                  detail.path.join(
                    "."
                  ),

                message:
                  detail.message,
              })
            ),
        });
      }

      await client.query(
        "BEGIN"
      );

      const currentResult =
        await client.query(
          `
          SELECT
            id,
            name,
            description,
            status,
            deadline_at,
            target_delay_hours,
            style_id

          FROM campaigns

          WHERE
            id = $1
            AND company_id = $2

          LIMIT 1
          FOR UPDATE
          `,
          [
            campaignId,
            companyId,
          ]
        );

      if (
        currentResult.rows
          .length === 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "Campagne introuvable",
        });
      }

      const current =
        currentResult.rows[0];

      if (
        current.status ===
          "COMPLETED" ||
        current.status ===
          "CANCELLED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          success: false,
          message:
            "Cette campagne ne peut plus être modifiée",
        });
      }

      let styleId =
        current.style_id;

      if (
        value.portraitStyle
      ) {
        const styleSlugMap = {
          MODERN_OFFICE:
            "moderne",

          LIGHT_STUDIO:
            "studio-neutre",

          EXECUTIVE:
            "executive",

          LINKEDIN:
            "corporate-clair",
        };

        const styleSlug =
          styleSlugMap[
            value.portraitStyle
          ];

        const styleResult =
          await client.query(
            `
            SELECT
              id
            FROM portrait_styles
            WHERE
              slug = $1
              AND is_active = TRUE
            LIMIT 1
            `,
            [
              styleSlug,
            ]
          );

        if (
          styleResult.rows
            .length === 0
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res
            .status(400)
            .json({
              success: false,
              message:
                "Style de portrait indisponible",
            });
        }

        styleId =
          styleResult.rows[0]
            .id;
      }

      const name =
        value.name !==
        undefined
          ? value.name.trim()
          : current.name;

      const description =
        value.description !==
        undefined
          ? value.description ||
            null
          : current.description;

      const deadline =
        value.deadline !==
        undefined
          ? value.deadline
          : current.deadline_at;

      const targetDelay =
        value.targetDelay !==
        undefined
          ? value.targetDelay
          : current
              .target_delay_hours;

      const result =
        await client.query(
          `
          UPDATE campaigns
          SET
            name = $1,
            description = $2,
            deadline_at = $3,
            target_delay_hours = $4,
            style_id = $5

          WHERE
            id = $6
            AND company_id = $7

          RETURNING
            id,
            name,
            description,
            status,

            deadline_at
              AS "deadlineAt",

            target_delay_hours
              AS "targetDelayHours",

            style_id
              AS "styleId",

            target_participant_count
              AS "targetParticipantCount",

            updated_at
              AS "updatedAt"
          `,
          [
            name,
            description,
            deadline,
            targetDelay,
            styleId,
            campaignId,
            companyId,
          ]
        );

      /*
       * Si deadline change :
       * mise à jour uniquement
       * des invitations encore actives.
       */
      if (
        value.deadline !==
        undefined
      ) {
        await client.query(
          `
          UPDATE invitations i
          SET
            expires_at = $1

          FROM participants p

          WHERE
            i.participant_id =
              p.id
            AND p.campaign_id =
              $2
            AND i.status IN (
              'PENDING',
              'SENT',
              'OPENED'
            )
          `,
          [
            deadline,
            campaignId,
          ]
        );
      }

      await client.query(
        `
        INSERT INTO audit_logs (
          actor_user_id,
          company_id,
          entity_type,
          entity_id,
          action,
          metadata
        )
        VALUES (
          $1,
          $2,
          'campaign',
          $3,
          'CAMPAIGN_UPDATED',
          $4::jsonb
        )
        `,
        [
          userId,
          companyId,
          campaignId,

          JSON.stringify({
            fields:
              Object.keys(value),
          }),
        ]
      );

      await client.query(
        "COMMIT"
      );

      return res.status(200).json({
        success: true,

        message:
          "Campagne modifiée avec succès",

        data: {
          campaign:
            result.rows[0],
        },
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {
        // transaction terminée
      }

      console.error(
        "Erreur updateCampaign :",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Impossible de modifier la campagne",
      });
    } finally {
      client.release();
    }
  };

module.exports = {
  updateCampaign,
};