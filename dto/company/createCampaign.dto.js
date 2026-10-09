const Joi = require("joi");

const participantSchema = Joi.object({
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
    .required(),
});

const createCampaignSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(150)
    .required(),

  description: Joi.string()
    .trim()
    .max(1000)
    .allow(null, "")
    .optional(),

  deadline: Joi.date()
    .iso()
    .required(),

  targetDelay: Joi.number()
    .integer()
    .valid(48, 72, 120)
    .required(),

  portraitStyle: Joi.string()
    .valid(
      "MODERN_OFFICE",
      "LIGHT_STUDIO",
      "EXECUTIVE",
      "LINKEDIN"
    )
    .required(),

  participants: Joi.array()
    .items(participantSchema)
    .min(1)
    .required(),
});

module.exports = {
  createCampaignSchema,
};