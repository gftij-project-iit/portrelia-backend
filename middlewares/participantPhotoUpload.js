const multer = require("multer");

/*
 * =========================================================
 * UPLOAD PHOTOS PARTICIPANT
 * =========================================================
 *
 * V1 :
 * - stockage temporaire en mémoire
 * - écriture disque par le controller
 * - 12 fichiers maximum
 * - 8 Mo maximum par fichier
 */

const MAX_PHOTOS = 12;
const MAX_FILE_SIZE =
  8 * 1024 * 1024;

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: MAX_PHOTOS,
    fileSize: MAX_FILE_SIZE,
  },

  fileFilter: (
    req,
    file,
    callback
  ) => {
    if (
      !ALLOWED_MIME_TYPES.includes(
        file.mimetype
      )
    ) {
      return callback(
        new Error(
          "Format de photo non autorisé"
        )
      );
    }

    callback(null, true);
  },
});

/*
 * Wrapper pour renvoyer
 * des erreurs JSON propres.
 */
const participantPhotoUpload =
  (req, res, next) => {
    upload.array(
      "photos",
      MAX_PHOTOS
    )(
      req,
      res,
      (error) => {
        if (!error) {
          return next();
        }

        if (
          error instanceof
          multer.MulterError
        ) {
          if (
            error.code ===
            "LIMIT_FILE_SIZE"
          ) {
            return res
              .status(413)
              .json({
                success: false,
                message:
                  "Chaque photo doit faire moins de 8 Mo",
              });
          }

          if (
            error.code ===
            "LIMIT_FILE_COUNT"
          ) {
            return res
              .status(400)
              .json({
                success: false,
                message:
                  "12 photos maximum sont autorisées",
              });
          }
        }

        return res
          .status(400)
          .json({
            success: false,
            message:
              error.message ||
              "Impossible de traiter les photos",
          });
      }
    );
  };

module.exports = {
  participantPhotoUpload,
};