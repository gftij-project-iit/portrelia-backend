const {
  db,
} = require("../../config/db");

const getParticipantPhotos =
  async (req, res) => {
    try {
      const access =
        req.participantAccess;

      const result =
        await db.query(
          `
          SELECT
            id,

            original_filename
              AS "originalFilename",

            mime_type
              AS "mimeType",

            size_bytes
              AS "sizeBytes",

            status,

            rejection_reason
              AS "rejectionReason",

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

      const locked =
        ![
          "INVITED",
          "CONSENT_PENDING",
          "PHOTOS_PENDING",
        ].includes(
          access.participant_status
        );

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

            photos:
              result.rows,

            count:
              result.rows.length,

            minimum: 6,
            maximum: 12,

            locked,
          },
        });
    } catch (error) {
      console.error(
        "Erreur getParticipantPhotos :",
        error
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