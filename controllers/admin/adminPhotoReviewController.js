const {
  db,
} = require("../../config/db");

/*
 * =========================================================
 * REVIEW PHOTO
 * =========================================================
 *
 * PATCH
 * /api/v1/admin/photos/:photoId/review
 *
 * Body :
 *
 * {
 *   status: "ACCEPTED"
 * }
 *
 * ou :
 *
 * {
 *   status: "REJECTED",
 *   rejectionReason: "Photo trop floue"
 * }
 */
const reviewAdminPhoto =
  async (req, res) => {
    const client =
      await db.connect();

    let transactionStarted =
      false;

    try {
      const photoId =
        Number(
          req.params.photoId
        );

      const {
        status,
        rejectionReason,
      } = req.body || {};

      /*
       * =====================================================
       * 1. PHOTO ID
       * =====================================================
       */
      if (
        !Number.isInteger(
          photoId
        ) ||
        photoId <= 0
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Photo invalide.",
          });
      }

      /*
       * =====================================================
       * 2. STATUS
       * =====================================================
       */
      const allowedStatuses =
        [
          "ACCEPTED",
          "REJECTED",
        ];

      if (
        !allowedStatuses.includes(
          status
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Le statut doit être ACCEPTED ou REJECTED.",
          });
      }

      /*
       * =====================================================
       * 3. REJECTION REASON
       * =====================================================
       */
      const cleanReason =
        typeof rejectionReason ===
        "string"
          ? rejectionReason.trim()
          : "";

      if (
        status ===
          "REJECTED" &&
        !cleanReason
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Un motif de rejet est obligatoire.",
          });
      }

      /*
       * =====================================================
       * 4. TRANSACTION
       * =====================================================
       */
      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      /*
       * =====================================================
       * 5. PHOTO + PARTICIPANT
       * =====================================================
       */
      const photoResult =
        await client.query(
          `
          SELECT
            ip.id,

            ip.participant_id
              AS "participantId",

            ip.status,

            ip.storage_provider
              AS "storageProvider",

            ip.original_filename
              AS "originalFilename",

            p.status
              AS "participantStatus",

            c.company_id
              AS "companyId",

            c.id
              AS "campaignId"

          FROM input_photos ip

          JOIN participants p
            ON p.id =
              ip.participant_id

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          WHERE
            ip.id = $1

          FOR UPDATE
          `,
          [
            photoId,
          ]
        );

      if (
        photoResult
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
              "Photo introuvable.",
          });
      }

      const photo =
        photoResult.rows[0];

      /*
       * =====================================================
       * 6. VÉRIFICATION WORKFLOW
       * =====================================================
       *
       * Le contrôle des photos source
       * se fait lorsque les photos ont
       * été soumises.
       */
      if (
        photo.participantStatus !==
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
              "Les photos de ce participant ne sont pas disponibles pour le contrôle qualité.",
          });
      }

      /*
       * =====================================================
       * 7. UPDATE PHOTO
       * =====================================================
       */
      const updateResult =
        await client.query(
          `
          UPDATE input_photos

          SET
            status = $1,

            rejection_reason =
              $2

          WHERE
            id = $3

          RETURNING
            id,

            participant_id
              AS "participantId",

            status,

            rejection_reason
              AS "rejectionReason",

            storage_provider
              AS "storageProvider",

            original_filename
              AS "originalFilename",

            mime_type
              AS "mimeType",

            size_bytes
              AS "sizeBytes",

            width,

            height,

            quality_score
              AS "qualityScore",

            face_detected
              AS "faceDetected",

            created_at
              AS "createdAt"
          `,
          [
            status,

            status ===
              "REJECTED"
              ? cleanReason
              : null,

            photoId,
          ]
        );

      const updatedPhoto =
        updateResult.rows[0];

      /*
       * =====================================================
       * 8. AUDIT LOG
       * =====================================================
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
          'input_photo',
          $2,
          $3,
          $4::jsonb
        )
        `,
        [
          photo.companyId,

          photoId,

          status ===
            "ACCEPTED"
            ? "PHOTO_ACCEPTED"
            : "PHOTO_REJECTED",

          JSON.stringify({
            participantId:
              photo.participantId,

            campaignId:
              photo.campaignId,

            rejectionReason:
              status ===
                "REJECTED"
                ? cleanReason
                : null,
          }),
        ]
      );

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
            status ===
              "ACCEPTED"
              ? "Photo acceptée."
              : "Photo rejetée.",

          data: {
            photo:
              updatedPhoto,
          },
        });
    } catch (error) {
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
            "ROLLBACK REVIEW PHOTO ERROR :",
            rollbackError
          );
        }
      }

      console.error(
        "reviewAdminPhoto :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible de mettre à jour le contrôle de cette photo.",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  reviewAdminPhoto,
};