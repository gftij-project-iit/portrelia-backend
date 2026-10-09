const path = require("path");
const fs = require("fs/promises");
const { db } = require("../../config/db");

/*
 * GET /api/v1/admin/campaigns
 * Liste toutes les campagnes.
 */
const getAdminCampaigns = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.status,
        c.deadline_at AS "deadlineAt",
        c.created_at AS "createdAt",

        co.id AS "companyId",
        co.name AS "companyName",

        COUNT(DISTINCT p.id)::int AS "participantCount",

        COUNT(
          DISTINCT CASE
            WHEN p.status = 'PHOTOS_RECEIVED'
              OR p.status = 'GENERATION_PENDING'
              OR p.status = 'GENERATION_IN_PROGRESS'
              OR p.status = 'QA_PENDING'
              OR p.status = 'GALLERY_READY'
              OR p.status = 'VALIDATED'
              OR p.status = 'DELIVERED'
            THEN p.id
          END
        )::int AS "photosReceivedCount"

      FROM campaigns c

      JOIN companies co
        ON co.id = c.company_id

      LEFT JOIN participants p
        ON p.campaign_id = c.id

      GROUP BY
        c.id,
        co.id,
        co.name

      ORDER BY c.created_at DESC
    `);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("getAdminCampaigns :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de récupérer les campagnes.",
    });
  }
};


/*
 * GET /api/v1/admin/campaigns/:campaignId
 * Détail campagne + participants + nombre de photos.
 */

const getAdminCampaignById = async (req, res) => {
  const { campaignId } = req.params;

  try {
    const campaignResult = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.description,
        c.status,
        c.deadline_at AS "deadlineAt",
        c.created_at AS "createdAt",

        co.id AS "companyId",
        co.name AS "companyName",

        ps.id AS "styleId",
        ps.name AS "styleName",
        ps.slug AS "styleSlug",
        ps.description AS "styleDescription",
        ps.preview_image_url AS "stylePreviewImageUrl"

      FROM campaigns c

      JOIN companies co
        ON co.id = c.company_id

      LEFT JOIN portrait_styles ps
        ON ps.id = c.style_id

      WHERE c.id = $1
      `,
      [campaignId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Campagne introuvable.",
      });
    }

    const participantsResult = await db.query(
      `
      SELECT
        p.id,
        p.first_name AS "firstName",
        p.last_name AS "lastName",
        p.email,
        p.job_title AS "jobTitle",
        p.status,
        p.invited_at AS "invitedAt",
        p.photos_received_at AS "photosReceivedAt",
        p.gallery_ready_at AS "galleryReadyAt",
        p.validated_at AS "validatedAt",
        p.delivered_at AS "deliveredAt",
        p.created_at AS "createdAt",

        COUNT(ip.id)::int AS "photoCount"

      FROM participants p

      LEFT JOIN input_photos ip
        ON ip.participant_id = p.id

      WHERE p.campaign_id = $1

      GROUP BY p.id

      ORDER BY p.created_at DESC
      `,
      [campaignId]
    );

    return res.status(200).json({
      success: true,
      data: {
        campaign: campaignResult.rows[0],
        participants: participantsResult.rows,
      },
    });
  } catch (error) {
    console.error(
      "getAdminCampaignById :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer la campagne.",
    });
  }
};


/*
 * GET /api/v1/admin/participants/:participantId
 *
 * Fiche complète d'un participant côté admin.
 *
 * Retourne :
 * - participant
 * - campagne
 * - entreprise
 * - style
 * - métadonnées des photos
 * - contenu réel des photos sous forme de Data URL
 *
 * V1 :
 * stockage LOCAL dans /uploads.
 */
/*
 * GET /api/v1/admin/participants/:participantId
 * Fiche complète participant + photos Supabase Storage.
 */
const getAdminParticipantById = async (req, res) => {
  const { participantId } = req.params;

  try {
    /*
     * -------------------------------------------------------
     * 1. Participant + campagne + entreprise + style
     * -------------------------------------------------------
     */
    const participantResult = await db.query(
      `
      SELECT
        p.id,
        p.first_name AS "firstName",
        p.last_name AS "lastName",
        p.email,
        p.job_title AS "jobTitle",
        p.status,

        p.invited_at AS "invitedAt",
        p.photos_received_at AS "photosReceivedAt",
        p.gallery_ready_at AS "galleryReadyAt",
        p.validated_at AS "validatedAt",
        p.delivered_at AS "deliveredAt",

        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt",

        c.id AS "campaignId",
        c.name AS "campaignName",
        c.description AS "campaignDescription",
        c.status AS "campaignStatus",
        c.deadline_at AS "deadlineAt",

        co.id AS "companyId",
        co.name AS "companyName",

        ps.id AS "styleId",
        ps.name AS "styleName",
        ps.slug AS "styleSlug",
        ps.description AS "styleDescription",
        ps.preview_image_url AS "stylePreviewImageUrl"

      FROM participants p

      JOIN campaigns c
        ON c.id = p.campaign_id

      JOIN companies co
        ON co.id = c.company_id

      LEFT JOIN portrait_styles ps
        ON ps.id = c.style_id

      WHERE p.id = $1
      LIMIT 1
      `,
      [participantId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Participant introuvable.",
      });
    }

    const participant =
      participantResult.rows[0];

    /*
     * -------------------------------------------------------
     * 2. Photos
     * -------------------------------------------------------
     */
    const photosResult = await db.query(
      `
      SELECT
        id,
        participant_id AS "participantId",

        storage_provider AS "storageProvider",
        storage_key AS "storageKey",

        original_filename AS "originalFilename",
        mime_type AS "mimeType",
        size_bytes AS "sizeBytes",

        width,
        height,
        status,

        rejection_reason AS "rejectionReason",
        quality_score AS "qualityScore",
        face_detected AS "faceDetected",

        created_at AS "createdAt"

      FROM input_photos

      WHERE participant_id = $1

      ORDER BY created_at ASC, id ASC
      `,
      [participantId]
    );

    /*
     * -------------------------------------------------------
     * 3. Signed URLs Supabase
     * -------------------------------------------------------
     */
    const photos = await Promise.all(
      photosResult.rows.map(async (photo) => {
        /*
         * Nouvelle architecture :
         * SUPABASE Storage.
         */
        if (
          photo.storageProvider ===
          "SUPABASE"
        ) {
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
                60 * 60
              );

          if (error) {
            console.error(
              "SIGNED URL ERROR :",
              {
                photoId:
                  photo.id,

                storageKey:
                  photo.storageKey,

                error:
                  error.message,
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

          return {
            ...photo,

            storageKey:
              undefined,

            imageUrl:
              data.signedUrl,

            fileAvailable:
              true,
          };
        }

        /*
         * Anciennes lignes LOCAL.
         *
         * On ne tente plus de lire le
         * disque Render.
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
      })
    );

    /*
     * -------------------------------------------------------
     * 4. Stats
     * -------------------------------------------------------
     */
    const photoCount =
      photos.length;

    const availablePhotoCount =
      photos.filter(
        (photo) =>
          photo.fileAvailable
      ).length;

    const acceptedPhotoCount =
      photos.filter(
        (photo) =>
          photo.status ===
          "ACCEPTED"
      ).length;

    const rejectedPhotoCount =
      photos.filter(
        (photo) =>
          photo.status ===
          "REJECTED"
      ).length;

    /*
     * -------------------------------------------------------
     * 5. Response
     * -------------------------------------------------------
     */
    return res.status(200).json({
      success: true,

      data: {
        participant,

        photos,

        photoCount,
        availablePhotoCount,
        acceptedPhotoCount,
        rejectedPhotoCount,

        photoRequirements: {
          minimum: 6,
          maximum: 12,
        },
      },
    });
  } catch (error) {
    console.error(
      "getAdminParticipantById :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer le participant.",
    });
  }
};


module.exports = {
  getAdminCampaigns,
  getAdminCampaignById,
  getAdminParticipantById,
};