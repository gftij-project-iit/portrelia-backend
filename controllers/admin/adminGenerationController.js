const {
  db,
} = require("../../config/db");

const {
  startGenerationForParticipant,
} = require(
  "../../services/generation/generationService"
);

const MIN_ACCEPTED_PHOTOS = 6;

/*
 * =========================================================
 * START GENERATION
 * =========================================================
 *
 * POST
 * /api/v1/admin/participants/:participantId/generation/start
 *
 * Vérifie :
 *
 * - participant existant
 * - statut GENERATION_PENDING
 * - minimum 6 photos ACCEPTED
 *
 * Puis :
 *
 * GENERATION_PENDING
 *        ↓
 * GENERATION_IN_PROGRESS
 *        ↓
 * generationService
 */
const startParticipantGeneration =
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

      console.log(
        "\n=========================================="
      );

      console.log(
        "[GENERATION][CONTROLLER] Requête reçue"
      );

      console.log(
        "[GENERATION][CONTROLLER] Participant ID :",
        participantId
      );

      console.log(
        "==========================================\n"
      );

      if (
        !Number.isInteger(
          participantId
        ) ||
        participantId <= 0
      ) {
        console.warn(
          "[GENERATION][CONTROLLER] Participant ID invalide :",
          participantId
        );

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
      console.log(
        "[GENERATION][CONTROLLER] Ouverture transaction..."
      );

      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      console.log(
        "[GENERATION][CONTROLLER] Transaction ouverte"
      );

      /*
       * =====================================================
       * 3. PARTICIPANT
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Recherche du participant..."
      );

      const participantResult =
        await client.query(
          `
          SELECT
            p.id,

            p.campaign_id
              AS "campaignId",

            p.first_name
              AS "firstName",

            p.last_name
              AS "lastName",

            p.email,

            p.status,

            c.company_id
              AS "companyId"

          FROM participants p

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          WHERE
            p.id = $1

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
        console.warn(
          "[GENERATION][CONTROLLER] Participant introuvable :",
          participantId
        );

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
        participantResult
          .rows[0];

      console.log(
        "[GENERATION][CONTROLLER] Participant trouvé :",
        {
          id:
            participant.id,

          firstName:
            participant.firstName,

          lastName:
            participant.lastName,

          email:
            participant.email,

          status:
            participant.status,

          campaignId:
            participant.campaignId,

          companyId:
            participant.companyId,
        }
      );

      /*
       * =====================================================
       * 4. STATUS
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Vérification statut..."
      );

      if (
        participant.status !==
        "GENERATION_PENDING"
      ) {
        console.warn(
          "[GENERATION][CONTROLLER] Statut invalide pour génération :",
          participant.status
        );

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
              `La génération ne peut pas être lancée avec le statut ${participant.status}.`,
          });
      }

      console.log(
        "[GENERATION][CONTROLLER] Statut valide : GENERATION_PENDING"
      );

      /*
       * =====================================================
       * 5. ACCEPTED PHOTOS
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Comptage des photos ACCEPTED..."
      );

      const photosResult =
        await client.query(
          `
          SELECT
            COUNT(*)::int
              AS accepted

          FROM input_photos

          WHERE
            participant_id = $1

            AND status =
              'ACCEPTED'
          `,
          [
            participantId,
          ]
        );

      const accepted =
        Number(
          photosResult
            .rows[0]
            ?.accepted ||
            0
        );

      console.log(
        "[GENERATION][CONTROLLER] Photos acceptées :",
        {
          participantId,
          accepted,
          minimum:
            MIN_ACCEPTED_PHOTOS,
        }
      );

      /*
       * =====================================================
       * 6. MINIMUM
       * =====================================================
       */
      if (
        accepted <
        MIN_ACCEPTED_PHOTOS
      ) {
        console.warn(
          "[GENERATION][CONTROLLER] Photos insuffisantes :",
          {
            accepted,

            minimum:
              MIN_ACCEPTED_PHOTOS,
          }
        );

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
              `Il faut au moins ${MIN_ACCEPTED_PHOTOS} photos acceptées pour lancer la génération.`,

            data: {
              accepted,

              minimumAccepted:
                MIN_ACCEPTED_PHOTOS,
            },
          });
      }

      console.log(
        "[GENERATION][CONTROLLER] Nombre de photos suffisant"
      );

      /*
       * =====================================================
       * 7. UPDATE STATUS
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Passage en GENERATION_IN_PROGRESS..."
      );

      const updateResult =
        await client.query(
          `
          UPDATE participants

          SET
            status =
              'GENERATION_IN_PROGRESS'

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

      console.log(
        "[GENERATION][CONTROLLER] Statut mis à jour :",
        {
          participantId,

          previousStatus:
            "GENERATION_PENDING",

          newStatus:
            updatedParticipant.status,
        }
      );

      /*
       * =====================================================
       * 8. AUDIT LOG
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Création audit log..."
      );

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
          'GENERATION_STARTED',
          $3::jsonb
        )
        `,
        [
          participant.companyId,

          participantId,

          JSON.stringify({
            campaignId:
              participant.campaignId,

            acceptedPhotos:
              accepted,
          }),
        ]
      );

      console.log(
        "[GENERATION][CONTROLLER] Audit log créé"
      );

      /*
       * =====================================================
       * 9. COMMIT
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Commit transaction..."
      );

      await client.query(
        "COMMIT"
      );

      transactionStarted =
        false;

      console.log(
        "[GENERATION][CONTROLLER] Transaction commitée"
      );

      /*
       * =====================================================
       * 10. RESPONSE FRONTEND
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Réponse 202 envoyée au frontend"
      );

      res
        .status(202)
        .json({
          success: true,

          message:
            "Génération démarrée.",

          data: {
            participant:
              updatedParticipant,

            generation: {
              acceptedPhotos:
                accepted,

              status:
                "GENERATION_IN_PROGRESS",
            },
          },
        });

      /*
       * =====================================================
       * 11. START GENERATION SERVICE
       * =====================================================
       */
      console.log(
        "[GENERATION][CONTROLLER] Préparation du service de génération..."
      );

      setImmediate(() => {
        console.log(
          "\n------------------------------------------"
        );

        console.log(
          "[GENERATION][CONTROLLER] Background generation démarré"
        );

        console.log(
          "[GENERATION][CONTROLLER] Appel startGenerationForParticipant()"
        );

        console.log(
          "[GENERATION][CONTROLLER] Participant :",
          participantId
        );

        console.log(
          "------------------------------------------\n"
        );

        startGenerationForParticipant(
          participantId
        )
          .then(
            (result) => {
              console.log(
                "\n=========================================="
              );

              console.log(
                "[GENERATION][CONTROLLER] Service génération terminé"
              );

              console.log(
                "[GENERATION][CONTROLLER] Résultat :",
                result
              );

              console.log(
                "==========================================\n"
              );
            }
          )
          .catch(
            (
              generationError
            ) => {
              console.error(
                "\n=========================================="
              );

              console.error(
                "[GENERATION][CONTROLLER] ERREUR BACKGROUND GENERATION"
              );

              console.error(
                generationError
              );

              console.error(
                "==========================================\n"
              );
            }
          );
      });

      return;
    } catch (error) {
      /*
       * =====================================================
       * ROLLBACK
       * =====================================================
       */
      console.error(
        "[GENERATION][CONTROLLER] ERREUR :",
        error
      );

      if (
        transactionStarted
      ) {
        try {
          console.log(
            "[GENERATION][CONTROLLER] Rollback..."
          );

          await client.query(
            "ROLLBACK"
          );

          console.log(
            "[GENERATION][CONTROLLER] Rollback terminé"
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "[GENERATION][CONTROLLER] ROLLBACK ERROR :",
            rollbackError
          );
        }
      }

      /*
       * Si une réponse est déjà partie,
       * on ne tente pas d'en envoyer une
       * deuxième.
       */
      if (
        res.headersSent
      ) {
        console.error(
          "[GENERATION][CONTROLLER] Réponse déjà envoyée, impossible de renvoyer une erreur HTTP."
        );

        return;
      }

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Impossible de lancer la génération.",
        });
    } finally {
      client.release();

      console.log(
        "[GENERATION][CONTROLLER] Connexion DB libérée"
      );
    }
  };

module.exports = {
  startParticipantGeneration,
};