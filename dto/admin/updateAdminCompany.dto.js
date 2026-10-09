const Joi = require("joi");

const updateAdminCompanySchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(255)
    .optional(),

  billingEmail: Joi.string()
    .email()
    .allow(null, "")
    .optional(),

  phone: Joi.string()
    .trim()
    .max(50)
    .allow(null, "")
    .optional(),

  website: Joi.string()
    .uri()
    .allow(null, "")
    .optional(),

  employeeCount: Joi.number()
    .integer()
    .min(0)
    .allow(null)
    .optional(),

  employeeSizeRange: Joi.string()
    .valid(
      "1-10",
      "11-50",
      "51-100",
      "101-250",
      "250+"
    )
    .allow(null, "")
    .optional(),

  status: Joi.string()
    .valid(
      "ACTIVE",
      "SUSPENDED",
      "ARCHIVED"
    )
    .optional(),
}).min(1);

module.exports = {
  updateAdminCompanySchema,
};