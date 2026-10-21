const Joi = require("joi");

const resetPasswordSchema = Joi.object({
  token: Joi.string()
    .pattern(/^[a-f0-9]{64}$/)
    .required()
    .messages({
      "string.pattern.base":
        "Lien de réinitialisation invalide.",
      "any.required":
        "Le lien de réinitialisation est obligatoire.",
    }),

  newPassword: Joi.string()
    .min(12)
    .max(128)
    .custom((value, helpers) => {
      if (Buffer.byteLength(value, "utf8") > 72) {
        return helpers.message(
          "Le mot de passe ne doit pas dépasser 72 octets."
        );
      }

      return value;
    })
    .required()
    .messages({
      "string.empty":
        "Le nouveau mot de passe est obligatoire.",
      "string.min":
        "Le nouveau mot de passe doit contenir au moins 12 caractères.",
      "string.max":
        "Le nouveau mot de passe ne doit pas dépasser 128 caractères.",
      "any.required":
        "Le nouveau mot de passe est obligatoire.",
    }),
});

module.exports = {
  resetPasswordSchema,
};