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
 * UUID VALIDATION
 * =========================================================
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/*
 * =========================================================
 * GET PARTICIPANT GALLERY
 * =========================================================
 *
 * GET
 *
 * /api/v1/participant/gallery/:token
 *
 * Route publique.
 *
 * Sécurité :
 *
 * - token UUID de galleries.public_token
 * - galerie publiée
 * - galerie non expirée
 * - uniquement gallery_portraits
 * - uniquement portraits visibles
 * - uniquement portraits PUBLISHED / SELECTED
 *
 * Aucun compte participant nécessaire.
 */

const getParticipantGallery =
  async (
    req,
    res
  ) => {
    try {
      /*
       * =====================================================
       * 1. TOKEN
       * =====================================================
       */

      const token =
        String(
          req.params
            ?.token ||
            ""
        )
          .trim()
          .toLowerCase();

      if (
        !token ||
        !UUID_REGEX.test(
          token
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Lien de galerie invalide.",
          });
      }

      console.log(
        "\n=========================================="
      );

      console.log(
        "[PARTICIPANT GALLERY][GET] START"
      );

      console.log(
        "[PARTICIPANT GALLERY][GET] Token reçu"
      );

      console.log(
        "==========================================\n"
      );

      /*
       * =====================================================
       * 2. STORAGE CONFIG
       * =====================================================
       */

      if (
        !GENERATED_BUCKET
      ) {
        console.error(
          "[PARTICIPANT GALLERY][GET] Bucket portraits absent"
        );

        return res
          .status(500)
          .json({
            success:
              false,

            message:
              "Configuration du stockage indisponible.",
          });
      }

      /*
       * =====================================================
       * 3. GALLERY + PARTICIPANT + CAMPAIGN + COMPANY
       * =====================================================
       */

      const galleryResult =
        await db.query(
          `
          SELECT
            g.id,

            g.public_token
              AS "publicToken",

            g.published_at
              AS "publishedAt",

            g.expires_at
              AS "expiresAt",

            g.created_at
              AS "createdAt",

            p.id
              AS "participantId",

            p.first_name
              AS "firstName",

            p.last_name
              AS "lastName",

            p.status
              AS "participantStatus",

            p.campaign_id
              AS "campaignId",

            c.name
              AS "campaignName",

            c.company_id
              AS "companyId",

            co.name
              AS "companyName"

          FROM galleries g

          JOIN participants p
            ON p.id =
              g.participant_id

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          JOIN companies co
            ON co.id =
              c.company_id

          WHERE
            g.public_token =
              $1::uuid

          LIMIT 1
          `,
          [
            token,
          ]
        );

      if (
        galleryResult
          .rows.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Galerie introuvable.",
          });
      }

      const galleryData =
        galleryResult
          .rows[0];

      /*
       * =====================================================
       * 4. GALLERY PUBLISHED
       * =====================================================
       */

      if (
        !galleryData
          .publishedAt
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Cette galerie n'est pas encore disponible.",
          });
      }

      /*
       * =====================================================
       * 5. EXPIRATION
       * =====================================================
       */

      if (
        galleryData
          .expiresAt &&
        new Date(
          galleryData
            .expiresAt
        ).getTime() <=
          Date.now()
      ) {
        return res
          .status(410)
          .json({
            success:
              false,

            message:
              "Cette galerie a expiré.",
          });
      }

      /*
       * =====================================================
       * 6. PARTICIPANT STATUS
       * =====================================================
       *
       * Une galerie publique est accessible
       * à partir de GALLERY_READY.
       *
       * Elle peut rester accessible après
       * sélection / livraison tant qu'elle
       * n'est pas expirée.
       */

      const allowedParticipantStatuses =
        [
          "GALLERY_READY",
          "VALIDATED",
          "REVISION_REQUESTED",
          "DELIVERED",
        ];

      if (
        !allowedParticipantStatuses
          .includes(
            galleryData
              .participantStatus
          )
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Cette galerie n'est pas disponible.",
          });
      }

      /*
       * =====================================================
       * 7. GALLERY PORTRAITS
       * =====================================================
       *
       * Très important :
       *
       * On ne récupère PAS directement tous
       * les generated_portraits.
       *
       * On passe obligatoirement par
       * gallery_portraits.
       *
       * Donc seuls les portraits publiés
       * par l'admin peuvent apparaître.
       */

      const portraitsResult =
        await db.query(
          `
          SELECT
            gp.id,

            gp.storage_provider
              AS "storageProvider",

            gp.storage_key
              AS "storageKey",

            gp.status,

            gp.is_gallery_visible
              AS "isGalleryVisible",

            gp.is_selected_by_participant
              AS "isSelectedByParticipant",

            gallery_portraits.sort_order
              AS "sortOrder",

            gp.created_at
              AS "createdAt"

          FROM gallery_portraits

          JOIN generated_portraits gp
            ON gp.id =
              gallery_portraits.portrait_id

          WHERE
            gallery_portraits.gallery_id =
              $1

            AND gp.participant_id =
              $2

            AND gp.is_gallery_visible =
              TRUE

            AND gp.status IN (
              'PUBLISHED',
              'SELECTED',
              'DELIVERED'
            )

          ORDER BY
            gallery_portraits.sort_order ASC,
            gp.id ASC
          `,
          [
            galleryData.id,

            galleryData
              .participantId,
          ]
        );

      const portraits =
        portraitsResult
          .rows;

      /*
       * =====================================================
       * 8. SIGNED URLS
       * =====================================================
       *
       * Le bucket reste privé.
       *
       * On génère une URL temporaire
       * uniquement pour chaque portrait
       * autorisé dans la galerie.
       */

      const portraitsWithUrls =
        await Promise.all(
          portraits.map(
            async (
              portrait
            ) => {
              if (
                !portrait
                  .storageKey ||
                portrait
                  .storageProvider !==
                  "SUPABASE"
              ) {
                return {
                  id:
                    portrait.id,

                  status:
                    portrait.status,

                  sortOrder:
                    portrait.sortOrder,

                  isSelectedByParticipant:
                    portrait
                      .isSelectedByParticipant,

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
                      portrait
                        .storageKey,

                      /*
                       * URL image valide
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
                    "[PARTICIPANT GALLERY][GET] SIGNED URL ERROR :",
                    {
                      portraitId:
                        portrait.id,

                      error:
                        error
                          ?.message,
                    }
                  );

                  return {
                    id:
                      portrait.id,

                    status:
                      portrait.status,

                    sortOrder:
                      portrait.sortOrder,

                    isSelectedByParticipant:
                      portrait
                        .isSelectedByParticipant,

                    imageUrl:
                      null,

                    fileAvailable:
                      false,
                  };
                }

                return {
                  id:
                    portrait.id,

                  status:
                    portrait.status,

                  sortOrder:
                    portrait.sortOrder,

                  isSelectedByParticipant:
                    portrait
                      .isSelectedByParticipant,

                  imageUrl:
                    data.signedUrl,

                  fileAvailable:
                    true,
                };
              } catch (
                signedUrlError
              ) {
                console.error(
                  "[PARTICIPANT GALLERY][GET] SIGNED URL EXCEPTION :",
                  {
                    portraitId:
                      portrait.id,

                    error:
                      signedUrlError
                        ?.message,
                  }
                );

                return {
                  id:
                    portrait.id,

                  status:
                    portrait.status,

                  sortOrder:
                    portrait.sortOrder,

                  isSelectedByParticipant:
                    portrait
                      .isSelectedByParticipant,

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
       * 9. EXISTING FINAL SELECTION
       * =====================================================
       */

      const selectionResult =
        await db.query(
          `
          SELECT
            ps.id,

            ps.portrait_id
              AS "portraitId",

            ps.is_favorite
              AS "isFavorite",

            ps.is_final_selection
              AS "isFinalSelection",

            ps.revision_requested
              AS "revisionRequested",

            ps.revision_reason
              AS "revisionReason",

            ps.created_at
              AS "createdAt",

            ps.updated_at
              AS "updatedAt"

          FROM participant_selections ps

          WHERE
            ps.participant_id =
              $1

            AND ps.is_final_selection =
              TRUE

          ORDER BY
            ps.updated_at DESC,
            ps.id DESC

          LIMIT 1
          `,
          [
            galleryData
              .participantId,
          ]
        );

      const selection =
        selectionResult
          .rows[0] ||
        null;

      /*
       * =====================================================
       * 10. RESPONSE
       * =====================================================
       */

      console.log(
        "[PARTICIPANT GALLERY][GET] SUCCESS :",
        {
          galleryId:
            galleryData.id,

          participantId:
            galleryData
              .participantId,

          portraitCount:
            portraitsWithUrls
              .length,

          selectedPortraitId:
            selection
              ?.portraitId ||
            null,
        }
      );

      return res
        .status(200)
        .json({
          success:
            true,

          data: {
            gallery: {
              id:
                galleryData.id,

              publicToken:
                galleryData
                  .publicToken,

              publishedAt:
                galleryData
                  .publishedAt,

              expiresAt:
                galleryData
                  .expiresAt,
            },

            participant: {
              id:
                galleryData
                  .participantId,

              firstName:
                galleryData
                  .firstName,

              lastName:
                galleryData
                  .lastName,

              status:
                galleryData
                  .participantStatus,
            },

            campaign: {
              id:
                galleryData
                  .campaignId,

              name:
                galleryData
                  .campaignName,
            },

            company: {
              id:
                galleryData
                  .companyId,

              name:
                galleryData
                  .companyName,
            },

            portraits:
              portraitsWithUrls.map(
                (
                  portrait
                ) => ({
                  ...portrait,

                  /*
                   * On garantit la cohérence
                   * avec participant_selections.
                   */
                  isSelectedByParticipant:
                    selection
                      ?.portraitId
                      ? String(
                          selection
                            .portraitId
                        ) ===
                        String(
                          portrait.id
                        )
                      : Boolean(
                          portrait
                            .isSelectedByParticipant
                        ),
                })
              ),

            selection,
          },
        });
    } catch (
      error
    ) {
      console.error(
        "[PARTICIPANT GALLERY][GET] ERROR :",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Impossible de récupérer votre galerie.",
        });
    }
  };

module.exports = {
  getParticipantGallery,
};