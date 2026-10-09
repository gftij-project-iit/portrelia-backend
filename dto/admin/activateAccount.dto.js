const Joi = require("joi");

const activateAccountSchema =
  Joi.object({
    token: Joi.string()
      .min(32)
      .required(),

    password: Joi.string()
      .min(8)
      .max(128)
      .required(),

    confirmPassword: Joi.string()
      .valid(Joi.ref("password"))
      .required()
      .messages({
        "any.only":
          "Les mots de passe ne correspondent pas",
      }),
  });

module.exports = {
  activateAccountSchema,
};