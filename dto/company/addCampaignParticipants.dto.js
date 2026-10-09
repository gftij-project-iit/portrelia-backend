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
    .max(255)
    .required(),

  jobTitle: Joi.string()
    .trim()
    .max(150)
    .allow("", null)
    .optional(),
});

const addCampaignParticipantsSchema =
  Joi.object({
    participants: Joi.array()
      .items(participantSchema)
      .min(1)
      .max(100)
      .required(),
  });

module.exports = {
  addCampaignParticipantsSchema,
};