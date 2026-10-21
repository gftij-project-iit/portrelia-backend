const Joi = require("joi");

const passwordSchema = Joi.string()
  .min(12)
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
    "string.base":
      "Le mot de passe doit être un texte.",
    "string.empty":
      "Le mot de passe est obligatoire.",
    "string.min":
      "Le mot de passe doit contenir au moins 12 caractères.",
    "any.required":
      "Le mot de passe est obligatoire.",
  });

module.exports = {
  passwordSchema,
};