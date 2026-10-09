const Joi = require("joi");

const updateAdminDemoRequestStatusSchema = Joi.object({
  status: Joi.string()
    .valid(
      "CONTACTED",
      "REJECTED"
    )
    .required(),
});

module.exports = {
  updateAdminDemoRequestStatusSchema,
};