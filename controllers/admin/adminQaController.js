const {
  db,
} = require("../../config/db");

const MIN_ACCEPTED_PHOTOS = 6;

/*
 * =========================================================
 * COMPLETE PARTICIPANT QA
 * =========================================================
 *
 * POST
 * /api/v1/admin/participants/:participantId/qa/complete
 *
 * Vérifie :
 *
 * - participant existant
 * - statut PHOTOS_RECEIVED
 * - minimum 6 photos ACCEPTED
 * - aucune photo UPLOADED restante
 *
 * Puis :
 *
 * PHOTOS_RECEIVED
 *        ↓
 * GENERATION_PENDING
 */
const completeParticipantQa =
  async (req, res) => {
    const client =
      await db.connect();

    let transactionStarted =
      false;

    try {
      /*
       * =====================================================
       * 1. PARTICIPANT ID
       * =====================================================
       */
      const participantId =
        Number(
          req.params.participantId
        );

      if (
        !Number.isInteger(
          participantId
        ) ||
        participantId <= 0
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Participant invalide.",
          });
      }

      /*
       * =====================================================
       * 2. TRANSACTION
       * =====================================================
       */
      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      /*
       * =====================================================
       * 3. LOCK PARTICIPANT
       * =====================================================
       */
      const participantResult =
        await client.query(
          `
          SELECT
            id,
            campaign_id
              AS "campaignId",
            first_name
              AS "firstName",
            last_name
              AS "lastName",
            email,
            status

          FROM participants

          WHERE
            id = $1

          FOR UPDATE
          `,
          [
            participantId,
          ]
        );

      if (
        participantResult
          .rows.length === 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(404)
          .json({
            success: false,

            message:
              "Participant introuvable.",
          });
      }

      const participant =
        participantResult.rows[0];

      /*
       * =====================================================
       * 4. STATUS PARTICIPANT
       * =====================================================
       */
      if (
        participant.status !==
        "PHOTOS_RECEIVED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              `Le contrôle QA ne peut pas être validé avec le statut ${participant.status}.`,
          });
      }

      /*
       * =====================================================
       * 5. COUNT PHOTOS
       * =====================================================
       */
      const photosResult =
        await client.query(
          `
          SELECT

            COUNT(*)::int
              AS total,

            COUNT(*) FILTER (
              WHERE
                status = 'ACCEPTED'
            )::int
              AS accepted,

            COUNT(*) FILTER (
              WHERE
                status = 'REJECTED'
            )::int
              AS rejected,

            COUNT(*) FILTER (
              WHERE
                status = 'UPLOADED'
            )::int
              AS pending

          FROM input_photos

          WHERE
            participant_id = $1
          `,
          [
            participantId,
          ]
        );

      const photoStats =
        photosResult.rows[0];

      const total =
        Number(
          photoStats.total ||
            0
        );

      const accepted =
        Number(
          photoStats.accepted ||
            0
        );

      const rejected =
        Number(
          photoStats.rejected ||
            0
        );

      const pending =
        Number(
          photoStats.pending ||
            0
        );

      /*
       * =====================================================
       * 6. MINIMUM ACCEPTED
       * =====================================================
       */
      if (
        accepted <
        MIN_ACCEPTED_PHOTOS
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              `Il faut au moins ${MIN_ACCEPTED_PHOTOS} photos acceptées pour terminer le contrôle qualité.`,

            data: {
              total,
              accepted,
              rejected,
              pending,

              minimumAccepted:
                MIN_ACCEPTED_PHOTOS,
            },
          });
      }

      /*
       * =====================================================
       * 7. PHOTOS ENCORE À CONTRÔLER
       * =====================================================
       */
      if (
        pending > 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              `${pending} photo(s) restent encore à contrôler.`,

            data: {
              total,
              accepted,
              rejected,
              pending,
            },
          });
      }

      /*
       * =====================================================
       * 8. UPDATE PARTICIPANT
       * =====================================================
       */
      const updateResult =
        await client.query(
          `
          UPDATE participants

          SET
            status =
              'GENERATION_PENDING'

          WHERE
            id = $1

          RETURNING
            id,
            campaign_id
              AS "campaignId",
            first_name
              AS "firstName",
            last_name
              AS "lastName",
            email,
            status
          `,
          [
            participantId,
          ]
        );

      const updatedParticipant =
        updateResult.rows[0];

      /*
       * =====================================================
       * 9. COMMIT
       * =====================================================
       */
      await client.query(
        "COMMIT"
      );

      transactionStarted =
        false;

      /*
       * =====================================================
       * 10. RESPONSE
       * =====================================================
       */
      return res
        .status(200)
        .json({
          success: true,

          message:
            "Contrôle qualité validé. Le participant est prêt pour la génération.",

          data: {
            participant:
              updatedParticipant,

            qa: {
              total,
              accepted,
              rejected,
              pending,

              minimumAccepted:
                MIN_ACCEPTED_PHOTOS,
            },
          },
        });
    } catch (error) {
      /*
       * =====================================================
       * ROLLBACK
       * =====================================================
       */
      if (
        transactionStarted
      ) {
        try {
          await client.query(
            "ROLLBACK"
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "QA COMPLETE ROLLBACK ERROR :",
            rollbackError
          );
        }
      }

      console.error(
        "completeParticipantQa :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Impossible de terminer le contrôle qualité.",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  completeParticipantQa,
};