const fs =
  require("fs/promises");

const path =
  require("path");

const {
  db,
} = require("../../config/db");

const BACKEND_ROOT =
  path.resolve(
    __dirname,
    "../.."
  );

const UPLOAD_ROOT =
  path.resolve(
    BACKEND_ROOT,
    "uploads",
    "participants"
  );

const getParticipantPhotoFile =
  async (req, res) => {
    try {
      const access =
        req.participantAccess;

      const photoId =
        Number(
          req.params.photoId
        );

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
              "Photo invalide",
          });
      }

      const result =
        await db.query(
          `
          SELECT
            storage_key,
            mime_type

          FROM input_photos

          WHERE
            id = $1
            AND participant_id = $2

          LIMIT 1
          `,
          [
            photoId,
            access.participant_id,
          ]
        );

      if (
        result.rows.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Photo introuvable",
          });
      }

      const photo =
        result.rows[0];

      const absolutePath =
        path.resolve(
          BACKEND_ROOT,
          photo.storage_key
        );

      /*
       * Protection contre
       * les chemins malveillants.
       */
      if (
        !absolutePath.startsWith(
          UPLOAD_ROOT
        )
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Accès interdit",
          });
      }

      try {
        await fs.access(
          absolutePath
        );
      } catch {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Fichier photo introuvable",
          });
      }

      res.type(
        photo.mime_type
      );

      return res.sendFile(
        absolutePath
      );
    } catch (error) {
      console.error(
        "Erreur getParticipantPhotoFile :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible de charger cette photo",
        });
    }
  };

module.exports = {
  getParticipantPhotoFile,
};