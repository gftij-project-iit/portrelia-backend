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

const deleteParticipantPhoto =
  async (req, res) => {
    const client =
      await db.connect();

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

      /*
       * Après soumission :
       * plus aucune modification.
       */
      if (
        ![
          "INVITED",
          "CONSENT_PENDING",
          "PHOTOS_PENDING",
        ].includes(
          access.participant_status
        )
      ) {
        return res
          .status(409)
          .json({
            success: false,
            message:
              "Vos photos ont déjà été soumises",
          });
      }

      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT
            id,
            storage_key

          FROM input_photos

          WHERE
            id = $1
            AND participant_id = $2

          LIMIT 1

          FOR UPDATE
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
        await client.query(
          "ROLLBACK"
        );

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

      await client.query(
        `
        DELETE FROM input_photos

        WHERE
          id = $1
          AND participant_id = $2
        `,
        [
          photoId,
          access.participant_id,
        ]
      );

      await client.query(
        "COMMIT"
      );

      /*
       * Suppression physique
       * après validation DB.
       */
      const absolutePath =
        path.resolve(
          BACKEND_ROOT,
          photo.storage_key
        );

      if (
        absolutePath.startsWith(
          UPLOAD_ROOT
        )
      ) {
        try {
          await fs.unlink(
            absolutePath
          );
        } catch (fileError) {
          if (
            fileError.code !==
            "ENOENT"
          ) {
            console.error(
              "Erreur suppression fichier :",
              fileError
            );
          }
        }
      }

      return res
        .status(200)
        .json({
          success: true,
          message:
            "Photo supprimée avec succès",
          data: {
            photoId,
          },
        });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {
        // transaction terminée
      }

      console.error(
        "Erreur deleteParticipantPhoto :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible de supprimer la photo",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  deleteParticipantPhoto,
};