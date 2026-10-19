const {
  db,
} = require("../../config/db");

const {
  supabase,
} = require(
  "../../config/supabase"
);

const {
  generatePortraitsWithGemini,
} = require(
  "./geminiGenerationService"
);

const MIN_ACCEPTED_PHOTOS = 6;

const GENERATED_BUCKET =
  process.env
    .SUPABASE_GENERATED_BUCKET ||
  process.env
    .SUPABASE_STORAGE_BUCKET;

/*
 * =========================================================
 * START GENERATION FOR PARTICIPANT
 * =========================================================
 */
const startGenerationForParticipant =
  async (participantId) => {
    let generationJobId =
      null;

    let uploadedPortraits =
      [];

    try {
      console.log(
        "\n=========================================="
      );

      console.log(
        "[GENERATION][SERVICE] START REAL GENERATION"
      );

      console.log(
        "[GENERATION][SERVICE] Participant ID :",
        participantId
      );

      console.log(
        "==========================================\n"
      );

      /*
       * =====================================================
       * 1. PARTICIPANT + CAMPAIGN + STYLE
       * =====================================================
       */
      const participantResult =
        await db.query(
          `
          SELECT
            p.id,

            p.first_name
              AS "firstName",

            p.last_name
              AS "lastName",

            p.email,

            p.status,

            p.campaign_id
              AS "campaignId",

            c.name
              AS "campaignName",

            c.company_id
              AS "companyId",

            c.style_id
              AS "styleId",

            ps.name
              AS "styleName",

            ps.slug
              AS "styleSlug",

            ps.description
              AS "styleDescription",

            ps.prompt_template
              AS "promptTemplate"

          FROM participants p

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          LEFT JOIN portrait_styles ps
            ON ps.id =
              c.style_id

          WHERE
            p.id = $1
          `,
          [
            participantId,
          ]
        );

      if (
        participantResult
          .rows.length === 0
      ) {
        throw new Error(
          "Participant introuvable pour la génération."
        );
      }

      const participant =
        participantResult
          .rows[0];

      console.log(
        "[GENERATION][SERVICE] Participant :",
        {
          id:
            participant.id,

          status:
            participant.status,

          campaign:
            participant.campaignName,

          style:
            participant.styleName,
        }
      );

      /*
       * =====================================================
       * 2. STATUS
       * =====================================================
       */
      if (
        participant.status !==
        "GENERATION_IN_PROGRESS"
      ) {
        throw new Error(
          `Statut génération invalide : ${participant.status}`
        );
      }

      /*
       * =====================================================
       * 3. STYLE
       * =====================================================
       */
      if (
        !participant.styleId
      ) {
        throw new Error(
          "Aucun style de portrait associé à cette campagne."
        );
      }

      /*
       * =====================================================
       * 4. ACCEPTED PHOTOS
       * =====================================================
       */
      const photosResult =
        await db.query(
          `
          SELECT
            id,

            participant_id
              AS "participantId",

            storage_provider
              AS "storageProvider",

            storage_key
              AS "storageKey",

            original_filename
              AS "originalFilename",

            mime_type
              AS "mimeType",

            size_bytes
              AS "sizeBytes",

            width,

            height,

            status,

            quality_score
              AS "qualityScore",

            face_detected
              AS "faceDetected",

            created_at
              AS "createdAt"

          FROM input_photos

          WHERE
            participant_id = $1

            AND status =
              'ACCEPTED'

          ORDER BY
            created_at ASC
          `,
          [
            participantId,
          ]
        );

      const acceptedPhotos =
        photosResult.rows;

      console.log(
        "[GENERATION][SERVICE] Photos ACCEPTED :",
        acceptedPhotos.length
      );

      if (
        acceptedPhotos.length <
        MIN_ACCEPTED_PHOTOS
      ) {
        throw new Error(
          `Minimum ${MIN_ACCEPTED_PHOTOS} photos acceptées requis.`
        );
      }

      /*
       * =====================================================
       * 5. PAYLOAD
       * =====================================================
       */
      const generationPayload = {
        participant: {
          id:
            participant.id,

          firstName:
            participant.firstName,

          lastName:
            participant.lastName,
        },

        company: {
          id:
            participant.companyId,
        },

        campaign: {
          id:
            participant.campaignId,

          name:
            participant.campaignName,
        },

        style: {
          id:
            participant.styleId,

          name:
            participant.styleName,

          slug:
            participant.styleSlug,

          description:
            participant.styleDescription,

          promptTemplate:
            participant.promptTemplate,
        },

        photos:
          acceptedPhotos.map(
            (photo) => ({
              id:
                photo.id,

              storageProvider:
                photo.storageProvider,

              storageKey:
                photo.storageKey,

              originalFilename:
                photo.originalFilename,

              mimeType:
                photo.mimeType,
            })
          ),
      };

      /*
       * =====================================================
       * 6. CREATE GENERATION JOB
       * =====================================================
       */
      console.log(
        "[GENERATION][SERVICE] Création generation_job..."
      );

      const jobResult =
        await db.query(
          `
          INSERT INTO generation_jobs (
            campaign_id,
            participant_id,
            style_id,
            provider,
            status,
            started_at,
            request_payload
          )

          VALUES (
            $1,
            $2,
            $3,
            'GEMINI',
            'PROCESSING',
            NOW(),
            $4::jsonb
          )

          RETURNING
            id,
            status,
            created_at
              AS "createdAt"
          `,
          [
            participant.campaignId,

            participantId,

            participant.styleId,

            JSON.stringify({
              participantId,

              style:
                participant.styleName,

              sourcePhotoIds:
                acceptedPhotos.map(
                  (photo) =>
                    photo.id
                ),

              requestedPortraits:
                Number(
                  process.env
                    .GEMINI_PORTRAIT_COUNT ||
                    4
                ),
            }),
          ]
        );

      generationJobId =
        jobResult
          .rows[0]
          .id;

      console.log(
        "[GENERATION][SERVICE] Generation job créé :",
        generationJobId
      );

      /*
       * =====================================================
       * 7. GEMINI REAL CALL
       * =====================================================
       */
      console.log(
        "[GENERATION][SERVICE] APPEL GEMINI..."
      );

      uploadedPortraits =
        await generatePortraitsWithGemini(
          generationPayload
        );

      if (
        !Array.isArray(
          uploadedPortraits
        ) ||
        uploadedPortraits.length ===
          0
      ) {
        throw new Error(
          "Gemini n'a généré aucun portrait."
        );
      }

      console.log(
        "[GENERATION][SERVICE] Portraits Gemini :",
        uploadedPortraits.length
      );

      /*
       * =====================================================
       * 8. INSERT GENERATED PORTRAITS
       * =====================================================
       */
      const insertedPortraits =
        [];

      for (
        const portrait of
        uploadedPortraits
      ) {
        const result =
          await db.query(
            `
            INSERT INTO generated_portraits (
              participant_id,
              generation_job_id,
              storage_provider,
              storage_key,
              status,
              is_gallery_visible,
              is_selected_by_participant
            )

            VALUES (
              $1,
              $2,
              'SUPABASE',
              $3,
              'QA_PENDING',
              FALSE,
              FALSE
            )

            RETURNING
              id,

              participant_id
                AS "participantId",

              generation_job_id
                AS "generationJobId",

              storage_provider
                AS "storageProvider",

              storage_key
                AS "storageKey",

              status,

              created_at
                AS "createdAt"
            `,
            [
              participantId,

              generationJobId,

              portrait.storageKey,
            ]
          );

        insertedPortraits.push(
          result.rows[0]
        );
      }

      console.log(
        "[GENERATION][SERVICE] generated_portraits insérés :",
        insertedPortraits.length
      );

      /*
       * =====================================================
       * 9. JOB SUCCEEDED
       * =====================================================
       */
      await db.query(
        `
        UPDATE generation_jobs

        SET
          status =
            'SUCCEEDED',

          completed_at =
            NOW(),

          response_payload =
            $2::jsonb

        WHERE
          id = $1
        `,
        [
          generationJobId,

          JSON.stringify({
            generatedPortraits:
              insertedPortraits.map(
                (portrait) => ({
                  id:
                    portrait.id,

                  storageKey:
                    portrait.storageKey,
                })
              ),
          }),
        ]
      );

      console.log(
        "[GENERATION][SERVICE] Job SUCCEEDED"
      );

      /*
       * =====================================================
       * 10. PARTICIPANT → QA_PENDING
       * =====================================================
       */
      await db.query(
        `
        UPDATE participants

        SET
          status =
            'QA_PENDING'

        WHERE
          id = $1
        `,
        [
          participantId,
        ]
      );

      console.log(
        "[GENERATION][SERVICE] Participant → QA_PENDING"
      );

      /*
       * =====================================================
       * 11. AUDIT
       * =====================================================
       */
      await db.query(
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
          'GENERATION_COMPLETED',
          $3::jsonb
        )
        `,
        [
          participant.companyId,

          participantId,

          JSON.stringify({
            generationJobId,

            provider:
              "GEMINI",

            portraitCount:
              insertedPortraits.length,
          }),
        ]
      );

      /*
       * =====================================================
       * END
       * =====================================================
       */
      console.log(
        "\n=========================================="
      );

      console.log(
        "[GENERATION][SERVICE] GÉNÉRATION TERMINÉE"
      );

      console.log(
        "[GENERATION][SERVICE] Job :",
        generationJobId
      );

      console.log(
        "[GENERATION][SERVICE] Portraits :",
        insertedPortraits.length
      );

      console.log(
        "[GENERATION][SERVICE] Nouveau statut : QA_PENDING"
      );

      console.log(
        "==========================================\n"
      );

      return {
        success: true,

        participantId,

        generationJobId,

        status:
          "QA_PENDING",

        provider:
          "GEMINI",

        generatedPortraits:
          insertedPortraits.length,
      };
    } catch (error) {
      console.error(
        "\n=========================================="
      );

      console.error(
        "[GENERATION][SERVICE] GENERATION FAILED"
      );

      console.error(
        "[GENERATION][SERVICE] Participant :",
        participantId
      );

      console.error(
        "[GENERATION][SERVICE] Job :",
        generationJobId
      );

      console.error(
        "[GENERATION][SERVICE] Message :",
        error.message
      );

      console.error(
        "==========================================\n"
      );

      /*
       * =====================================================
       * JOB FAILED
       * =====================================================
       */
      if (
        generationJobId
      ) {
        try {
          await db.query(
            `
            UPDATE generation_jobs

            SET
              status =
                'FAILED',

              completed_at =
                NOW(),

              error_code =
                'GENERATION_ERROR',

              error_message =
                $2

            WHERE
              id = $1
            `,
            [
              generationJobId,

              String(
                error.message
              ).slice(
                0,
                2000
              ),
            ]
          );
        } catch (
          jobError
        ) {
          console.error(
            "[GENERATION][SERVICE] Impossible de marquer le job FAILED :",
            jobError
          );
        }
      }

      /*
       * =====================================================
       * CLEAN GENERATED FILES
       * =====================================================
       */
      if (
        uploadedPortraits.length >
        0 &&
        GENERATED_BUCKET
      ) {
        try {
          await supabase.storage
            .from(
              GENERATED_BUCKET
            )
            .remove(
              uploadedPortraits.map(
                (portrait) =>
                  portrait.storageKey
              )
            );

          console.log(
            "[GENERATION][SERVICE] Portraits orphelins supprimés"
          );
        } catch (
          storageError
        ) {
          console.error(
            "[GENERATION][SERVICE] Nettoyage Storage échoué :",
            storageError
          );
        }
      }

      /*
       * =====================================================
       * RETRY STATUS
       * =====================================================
       *
       * On remet le participant en
       * GENERATION_PENDING afin que
       * l'admin puisse relancer.
       */
      try {
        await db.query(
          `
          UPDATE participants

          SET
            status =
              'GENERATION_PENDING'

          WHERE
            id = $1

            AND status =
              'GENERATION_IN_PROGRESS'
          `,
          [
            participantId,
          ]
        );

        console.log(
          "[GENERATION][SERVICE] Participant remis en GENERATION_PENDING"
        );
      } catch (
        participantError
      ) {
        console.error(
          "[GENERATION][SERVICE] Impossible de restaurer le statut :",
          participantError
        );
      }

      throw error;
    }
  };

module.exports = {
  startGenerationForParticipant,
};