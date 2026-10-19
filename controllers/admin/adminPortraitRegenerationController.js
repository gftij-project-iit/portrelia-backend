const {
  regeneratePortrait,
} = require(
  "../../services/generation/regeneratePortraitService"
);

const regenerateGeneratedPortrait =
  async (req, res) => {
    try {
      const portraitId =
        Number(
          req.params.portraitId
        );

      if (
        !Number.isInteger(
          portraitId
        ) ||
        portraitId <= 0
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Portrait invalide.",
          });
      }

      const notes =
        typeof req.body?.notes ===
        "string"
          ? req.body.notes
              .trim() ||
            null
          : null;

      /*
       * On ne force pas la structure req.user
       * si ton middleware utilise une autre propriété.
       */
      const reviewerUserId =
        req.user?.id ||
        null;

      const result =
        await regeneratePortrait({
          portraitId,

          reviewerUserId,

          notes,
        });

      return res
        .status(201)
        .json({
          success: true,

          message:
            "Portrait régénéré avec succès.",

          data:
            result,
        });
    } catch (error) {
      console.error(
        "[PORTRAIT REGENERATION] ERROR :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            error.message ||
            "Impossible de régénérer le portrait.",
        });
    }
  };

module.exports = {
  regenerateGeneratedPortrait,
};