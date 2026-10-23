
const Joi = require("joi");

// Retourne la date actuelle à Paris au format YYYY-MM-DD.
function getParisToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

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

  deadline: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom((value, helpers) => {
      const parsed = new Date(`${value}T12:00:00Z`);

      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
      ) {
        return helpers.message(
          "La date limite de participation est invalide."
        );
      }

      if (value <= getParisToday()) {
        return helpers.message(
          "La date limite de participation doit être à partir de demain."
        );
      }

      return value;
    })
    .required()
    .messages({
      "string.empty": "La date limite est obligatoire.",
      "string.pattern.base":
        "La date limite doit être au format AAAA-MM-JJ.",
      "any.required": "La date limite est obligatoire.",
    }),

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
