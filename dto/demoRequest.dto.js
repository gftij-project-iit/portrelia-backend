const Joi = require("joi");

const createDemoRequestSchema = Joi.object({
  companyName: Joi.string()
    .trim()
    .min(2)
    .max(255)
    .required(),

  firstName: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required(),

  lastName: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required(),

  email: Joi.string()
    .trim()
    .lowercase()
    .email()
    .max(255)
    .required(),

  phone: Joi.string()
    .trim()
    .max(50)
    .allow("", null)
    .optional(),

  teamSize: Joi.string()
    .valid(
      "1-10",
      "11-25",
      "26-50",
      "51-100",
      "101-250",
      "251-500",
      "500+"
    )
    .required(),

  message: Joi.string()
    .trim()
    .max(3000)
    .allow("", null)
    .optional(),

  consent: Joi.boolean()
    .valid(true)
    .required(),
});

module.exports = {
  createDemoRequestSchema,
};