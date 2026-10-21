const Joi = require("joi");

const activateAccountSchema = Joi.object({
  token: Joi.string()
    .min(32)
    .required(),

  password: Joi.string()
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
        "Le mot de passe est obligatoire.",
      "string.min":
        "Le mot de passe doit contenir au moins 12 caractères.",
      "string.max":
        "Le mot de passe ne doit pas dépasser 128 caractères.",
      "any.required":
        "Le mot de passe est obligatoire.",
    }),

  confirmPassword: Joi.string()
    .valid(Joi.ref("password"))
    .required()
    .messages({
      "any.only":
        "Les mots de passe ne correspondent pas.",
      "string.empty":
        "Veuillez confirmer votre mot de passe.",
      "any.required":
        "Veuillez confirmer votre mot de passe.",
    }),
});

module.exports = {
  activateAccountSchema,
};