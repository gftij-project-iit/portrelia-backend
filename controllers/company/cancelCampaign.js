const { db } = require("../../config/db");

const cancelCampaign =
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

      await client.query(
        "BEGIN"
      );

      const currentResult =
        await client.query(
          `
          SELECT
            id,
            name,
            status

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

      const campaign =
        currentResult.rows[0];

      if (
        campaign.status ===
        "CANCELLED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          success: false,
          message:
            "Cette campagne est déjà annulée",
        });
      }

      if (
        campaign.status ===
        "COMPLETED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          success: false,
          message:
            "Une campagne terminée ne peut pas être annulée",
        });
      }

      const result =
        await client.query(
          `
          UPDATE campaigns
          SET
            status = 'CANCELLED'

          WHERE
            id = $1
            AND company_id = $2

          RETURNING
            id,
            name,
            status,
            updated_at
              AS "updatedAt"
          `,
          [
            campaignId,
            companyId,
          ]
        );

      /*
       * Toutes les invitations encore
       * utilisables sont révoquées.
       */
      await client.query(
        `
        UPDATE invitations i

        SET
          status = 'REVOKED'

        FROM participants p

        WHERE
          i.participant_id = p.id

          AND p.campaign_id = $1

          AND i.status IN (
            'PENDING',
            'SENT',
            'OPENED'
          )
        `,
        [
          campaignId,
        ]
      );

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
          'CAMPAIGN_CANCELLED',
          $4::jsonb
        )
        `,
        [
          userId,
          companyId,
          campaignId,

          JSON.stringify({
            previousStatus:
              campaign.status,
          }),
        ]
      );

      await client.query(
        "COMMIT"
      );

      return res.status(200).json({
        success: true,

        message:
          "Campagne annulée avec succès",

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
        "Erreur cancelCampaign :",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Impossible d'annuler la campagne",
      });
    } finally {
      client.release();
    }
  };

module.exports = {
  cancelCampaign,
};