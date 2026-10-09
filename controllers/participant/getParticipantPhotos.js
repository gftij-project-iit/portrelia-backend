const {
  db,
} = require("../../config/db");

const {
  supabase,
} = require("../../config/supabase");

const MIN_PHOTOS = 6;
const MAX_PHOTOS = 12;

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET;

const SIGNED_URL_DURATION =
  60 * 60;

/*
 * =========================================================
 * GET PHOTOS PARTICIPANT
 * =========================================================
 *
 * GET
 * /api/v1/participant/invitations/:token/photos
 *
 * Retourne :
 * - participant
 * - photos
 * - signed URL Supabase pour chaque photo
 * - count
 * - minimum / maximum
 * - locked
 */
const getParticipantPhotos =
  async (req, res) => {
    try {
      const access =
        req.participantAccess;

      /*
       * =====================================================
       * 1. VÉRIFICATION ACCÈS
       * =====================================================
       */
      if (!access) {
        return res
          .status(401)
          .json({
            success: false,
            message:
              "Accès participant introuvable",
          });
      }

      /*
       * =====================================================
       * 2. VÉRIFICATION STORAGE
       * =====================================================
       */
      if (!STORAGE_BUCKET) {
        console.error(
          "SUPABASE_STORAGE_BUCKET manquant"
        );

        return res
          .status(500)
          .json({
            success: false,
            message:
              "Configuration du stockage indisponible",
          });
      }

      /*
       * =====================================================
       * 3. PHOTOS EN BASE
       * =====================================================
       */
      const result =
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

            rejection_reason
              AS "rejectionReason",

            quality_score
              AS "qualityScore",

            face_detected
              AS "faceDetected",

            created_at
              AS "createdAt"

          FROM input_photos

          WHERE
            participant_id = $1

          ORDER BY
            created_at ASC,
            id ASC
          `,
          [
            access.participant_id,
          ]
        );

      /*
       * =====================================================
       * 4. SIGNED URL SUPABASE
       * =====================================================
       *
       * Le bucket est privé.
       *
       * On génère donc une URL temporaire
       * pour chaque photo.
       *
       * Maximum : 12 photos.
       */
      const photos =
        await Promise.all(
          result.rows.map(
            async (photo) => {
              /*
               * Nouvelle architecture.
               */
              if (
                photo.storageProvider ===
                "SUPABASE"
              ) {
                try {
                  const {
                    data,
                    error,
                  } =
                    await supabase.storage
                      .from(
                        STORAGE_BUCKET
                      )
                      .createSignedUrl(
                        photo.storageKey,
                        SIGNED_URL_DURATION
                      );

                  if (
                    error ||
                    !data?.signedUrl
                  ) {
                    console.error(
                      "SIGNED URL ERROR :",
                      {
                        photoId:
                          photo.id,

                        storageKey:
                          photo.storageKey,

                        message:
                          error?.message ||
                          "Signed URL absente",
                      }
                    );

                    return {
                      ...photo,

                      /*
                       * Ne pas exposer
                       * la clé interne inutilement
                       * au frontend.
                       */
                      storageKey:
                        undefined,

                      imageUrl:
                        null,

                      fileAvailable:
                        false,
                    };
                  }

                  return {
                    ...photo,

                    storageKey:
                      undefined,

                    imageUrl:
                      data.signedUrl,

                    fileAvailable:
                      true,
                  };
                } catch (
                  storageError
                ) {
                  console.error(
                    "SIGNED URL EXCEPTION :",
                    {
                      photoId:
                        photo.id,

                      message:
                        storageError.message,
                    }
                  );

                  return {
                    ...photo,

                    storageKey:
                      undefined,

                    imageUrl:
                      null,

                    fileAvailable:
                      false,
                  };
                }
              }

              /*
               * Anciennes photos LOCAL.
               *
               * Elles ne sont plus utilisées
               * dans la nouvelle architecture.
               */
              return {
                ...photo,

                storageKey:
                  undefined,

                imageUrl:
                  null,

                fileAvailable:
                  false,
              };
            }
          )
        );

      /*
       * =====================================================
       * 5. STATUT LOCKED
       * =====================================================
       *
       * Après soumission,
       * le collaborateur ne peut plus
       * modifier ses photos.
       */
      const locked =
        ![
          "INVITED",
          "CONSENT_PENDING",
          "PHOTOS_PENDING",
        ].includes(
          access.participant_status
        );

      /*
       * =====================================================
       * 6. STATISTIQUES
       * =====================================================
       */
      const availableCount =
        photos.filter(
          (photo) =>
            photo.fileAvailable
        ).length;

      /*
       * =====================================================
       * 7. RESPONSE
       * =====================================================
       */
      return res
        .status(200)
        .json({
          success: true,

          data: {
            participant: {
              id:
                access.participant_id,

              firstName:
                access.first_name,

              lastName:
                access.last_name,

              status:
                access.participant_status,
            },

            photos,

            count:
              photos.length,

            availableCount,

            minimum:
              MIN_PHOTOS,

            maximum:
              MAX_PHOTOS,

            locked,
          },
        });
    } catch (error) {
      console.error(
        "Erreur getParticipantPhotos :",
        {
          message:
            error.message,

          code:
            error.code,

          stack:
            error.stack,
        }
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Impossible de charger les photos",
        });
    }
  };

module.exports = {
  getParticipantPhotos,
};