const {
  db,
} = require("../../config/db");

const {
  supabase,
} = require("../../config/supabase");

/*
 * =========================================================
 * STORAGE
 * =========================================================
 */

const GENERATED_BUCKET =
  process.env
    .SUPABASE_GENERATED_BUCKET ||
  process.env
    .SUPABASE_STORAGE_BUCKET;

/*
 * =========================================================
 * GET GENERATED PORTRAITS FOR PARTICIPANT
 * =========================================================
 *
 * GET
 * /api/v1/admin/participants/:participantId/generated-portraits
 *
 * Retourne :
 *
 * - participant
 * - campagne
 * - entreprise
 * - style
 * - portraits générés actifs
 * - signed URLs Supabase
 *
 * IMPORTANT :
 *
 * Un ancien portrait ayant fait l'objet
 * d'une décision REGENERATE reste en BDD
 * pour l'historique mais n'est plus
 * retourné dans le QA courant.
 */
const getGeneratedPortraitsForParticipant =
  async (req, res) => {
    try {
      /*
       * =====================================================
       * 1. PARTICIPANT ID
       * =====================================================
       */

      const participantId =
        Number(
          req.params
            .participantId
        );

      console.log(
        "\n=========================================="
      );

      console.log(
        "[QA PORTRAITS][GET] Requête reçue"
      );

      console.log(
        "[QA PORTRAITS][GET] Participant :",
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
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Participant invalide.",
          });
      }

      /*
       * =====================================================
       * 2. STORAGE CONFIG
       * =====================================================
       */

      if (
        !GENERATED_BUCKET
      ) {
        console.error(
          "[QA PORTRAITS][GET] Bucket généré absent"
        );

        return res
          .status(500)
          .json({
            success:
              false,

            message:
              "Configuration du stockage des portraits absente.",
          });
      }

      /*
       * =====================================================
       * 3. PARTICIPANT
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

            p.job_title
              AS "jobTitle",

            p.status,

            p.campaign_id
              AS "campaignId",

            c.name
              AS "campaignName",

            c.company_id
              AS "companyId",

            co.name
              AS "companyName",

            c.style_id
              AS "styleId",

            ps.name
              AS "styleName",

            ps.slug
              AS "styleSlug"

          FROM participants p

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          JOIN companies co
            ON co.id =
              c.company_id

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
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Participant introuvable.",
          });
      }

      const participant =
        participantResult
          .rows[0];

      console.log(
        "[QA PORTRAITS][GET] Participant trouvé :",
        {
          id:
            participant.id,

          name:
            `${participant.firstName} ${participant.lastName}`,

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
       * 4. GENERATED PORTRAITS ACTIFS
       * =====================================================
       *
       * On exclut uniquement les portraits ayant
       * au moins une qa_review REGENERATE.
       *
       * Ainsi :
       *
       * REJECT
       *   => reste visible
       *
       * APPROVE
       *   => reste visible
       *
       * REGENERATE
       *   => ancien portrait caché
       *
       * Nouveau portrait issu de la régénération
       *   => QA_PENDING => visible
       */

      const portraitsResult =
        await db.query(
          `
          SELECT
            gp.id,

            gp.participant_id
              AS "participantId",

            gp.generation_job_id
              AS "generationJobId",

            gp.storage_provider
              AS "storageProvider",

            gp.storage_key
              AS "storageKey",

            gp.status,

            gp.is_gallery_visible
              AS "isGalleryVisible",

            gp.is_selected_by_participant
              AS "isSelectedByParticipant",

            gp.created_at
              AS "createdAt",

            gp.updated_at
              AS "updatedAt",

            gj.provider,

            gj.status
              AS "generationStatus",

            (
              SELECT
                qr.notes

              FROM qa_reviews qr

              WHERE
                qr.portrait_id =
                  gp.id

              ORDER BY
                qr.created_at DESC,
                qr.id DESC

              LIMIT 1
            )
              AS notes,

            (
              SELECT
                qr.decision

              FROM qa_reviews qr

              WHERE
                qr.portrait_id =
                  gp.id

              ORDER BY
                qr.created_at DESC,
                qr.id DESC

              LIMIT 1
            )
              AS "lastQaDecision"

          FROM generated_portraits gp

          LEFT JOIN generation_jobs gj
            ON gj.id =
              gp.generation_job_id

          WHERE
            gp.participant_id =
              $1

            AND NOT EXISTS (
              SELECT
                1

              FROM qa_reviews qr_regenerate

              WHERE
                qr_regenerate.portrait_id =
                  gp.id

                AND qr_regenerate.decision =
                  'REGENERATE'
            )

          ORDER BY
            gp.created_at ASC,
            gp.id ASC
          `,
          [
            participantId,
          ]
        );

      const portraits =
        portraitsResult
          .rows;

      console.log(
        "[QA PORTRAITS][GET] Portraits actifs trouvés :",
        portraits.length
      );

      /*
       * =====================================================
       * 5. SIGNED URLS
       * =====================================================
       */

      const portraitsWithUrls =
        await Promise.all(
          portraits.map(
            async (
              portrait
            ) => {
              /*
               * Fichier inexploitable.
               */
              if (
                !portrait.storageKey ||
                portrait.storageProvider !==
                  "SUPABASE"
              ) {
                return {
                  ...portrait,

                  imageUrl:
                    null,

                  fileAvailable:
                    false,
                };
              }

              try {
                const {
                  data,
                  error,
                } =
                  await supabase
                    .storage
                    .from(
                      GENERATED_BUCKET
                    )
                    .createSignedUrl(
                      portrait.storageKey,

                      /*
                       * URL privée valide
                       * pendant 1 heure.
                       */
                      60 * 60
                    );

                if (
                  error ||
                  !data
                    ?.signedUrl
                ) {
                  console.error(
                    "[QA PORTRAITS][GET] Signed URL error :",
                    {
                      portraitId:
                        portrait.id,

                      storageKey:
                        portrait.storageKey,

                      error:
                        error
                          ?.message,
                    }
                  );

                  return {
                    ...portrait,

                    imageUrl:
                      null,

                    fileAvailable:
                      false,
                  };
                }

                return {
                  ...portrait,

                  imageUrl:
                    data.signedUrl,

                  fileAvailable:
                    true,
                };
              } catch (
                signedUrlError
              ) {
                console.error(
                  "[QA PORTRAITS][GET] Signed URL exception :",
                  {
                    portraitId:
                      portrait.id,

                    storageKey:
                      portrait.storageKey,

                    error:
                      signedUrlError
                        ?.message,
                  }
                );

                return {
                  ...portrait,

                  imageUrl:
                    null,

                  fileAvailable:
                    false,
                };
              }
            }
          )
        );

      /*
       * =====================================================
       * 6. STATS
       * =====================================================
       *
       * IMPORTANT :
       *
       * Ces stats portent uniquement
       * sur les portraits actifs visibles.
       */

      const approved =
        portraits.filter(
          (
            portrait
          ) =>
            portrait.status ===
            "QA_APPROVED"
        ).length;

      const rejected =
        portraits.filter(
          (
            portrait
          ) =>
            portrait.status ===
            "QA_REJECTED"
        ).length;

      const retouch =
        portraits.filter(
          (
            portrait
          ) =>
            portrait.status ===
            "RETOUCH_REQUIRED"
        ).length;

      const pending =
        portraits.filter(
          (
            portrait
          ) =>
            [
              "GENERATED",
              "QA_PENDING",
            ].includes(
              portrait.status
            )
        ).length;

      /*
       * =====================================================
       * 7. RESPONSE
       * =====================================================
       */

      console.log(
        "[QA PORTRAITS][GET] Réponse prête :",
        {
          participantId,

          total:
            portraits.length,

          pending,

          approved,

          rejected,

          retouch,
        }
      );

      return res
        .status(200)
        .json({
          success:
            true,

          data: {
            participant,

            portraits:
              portraitsWithUrls,

            stats: {
              total:
                portraits.length,

              pending,

              approved,

              rejected,

              retouch,
            },
          },
        });
    } catch (
      error
    ) {
      console.error(
        "[QA PORTRAITS][GET] ERROR :",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Impossible de récupérer les portraits générés.",
        });
    }
  };

module.exports = {
  getGeneratedPortraitsForParticipant,
};