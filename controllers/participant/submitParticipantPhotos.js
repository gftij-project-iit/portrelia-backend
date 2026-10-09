const {
  db,
} = require("../../config/db");

const submitParticipantPhotos =
  async (req, res) => {
    const client =
      await db.connect();

    try {
      const access =
        req.participantAccess;

      /*
       * Déjà soumis.
       */
      if (
        ![
          "INVITED",
          "CONSENT_PENDING",
          "PHOTOS_PENDING",
        ].includes(
          access.participant_status
        )
      ) {
        return res
          .status(409)
          .json({
            success: false,
            message:
              "Vos photos ont déjà été soumises",
          });
      }

      await client.query(
        "BEGIN"
      );

      const countResult =
        await client.query(
          `
          SELECT
            COUNT(*)::INTEGER
              AS count

          FROM input_photos

          WHERE
            participant_id = $1
          `,
          [
            access.participant_id,
          ]
        );

      const photoCount =
        countResult.rows[0]
          .count;

      if (
        photoCount < 6 ||
        photoCount > 12
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Vous devez avoir entre 6 et 12 photos avant de confirmer",
          });
      }

      const participantResult =
        await client.query(
          `
          UPDATE participants

          SET
            status =
              'PHOTOS_RECEIVED',

            photos_received_at =
              NOW()

          WHERE
            id = $1

          RETURNING
            id,
            status,

            photos_received_at
              AS "photosReceivedAt"
          `,
          [
            access.participant_id,
          ]
        );

      /*
       * Audit.
       */
      await client.query(
        `
        INSERT INTO audit_logs (
          company_id,
          entity_type,
          entity_id,
          action,
          metadata
        )

        VALUES (
          $1,
          'participant',
          $2,
          'PARTICIPANT_PHOTOS_SUBMITTED',
          $3::jsonb
        )
        `,
        [
          access.company_id,

          access.participant_id,

          JSON.stringify({
            campaignId:
              access.campaign_id,

            photoCount,
          }),
        ]
      );

      await client.query(
        "COMMIT"
      );

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Vos photos ont été envoyées avec succès",

          data: {
            participant:
              participantResult
                .rows[0],

            photoCount,
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
        "Erreur submitParticipantPhotos :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible de confirmer vos photos",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  submitParticipantPhotos,
};