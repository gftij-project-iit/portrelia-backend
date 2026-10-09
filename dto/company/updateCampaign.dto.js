const Joi = require("joi");

const updateCampaignSchema =
  Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(255),

    description: Joi.string()
      .trim()
      .max(2000)
      .allow("", null),

    deadline: Joi.date()
      .iso()
      .allow(null),

    targetDelay: Joi.number()
      .integer()
      .valid(
        48,
        72,
        120
      ),

    portraitStyle:
      Joi.string().valid(
        "MODERN_OFFICE",
        "LIGHT_STUDIO",
        "EXECUTIVE",
        "LINKEDIN"
      ),
  })
    .min(1)
    .unknown(false);

module.exports = {
  updateCampaignSchema,
};