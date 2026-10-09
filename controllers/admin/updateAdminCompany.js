const { db } = require("../../config/db");

const {
  updateAdminCompanySchema,
} = require("../../dto/admin/updateAdminCompany.dto");

const updateAdminCompany = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      error,
      value,
    } = updateAdminCompanySchema.validate(
      req.body,
      {
        abortEarly: false,
        stripUnknown: true,
      }
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const currentResult = await db.query(
      `
      SELECT *
      FROM companies
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Entreprise introuvable",
      });
    }

    const current =
      currentResult.rows[0];

    const name =
      value.name !== undefined
        ? value.name
        : current.name;

    const billingEmail =
      value.billingEmail !== undefined
        ? value.billingEmail || null
        : current.billing_email;

    const phone =
      value.phone !== undefined
        ? value.phone || null
        : current.phone;

    const website =
      value.website !== undefined
        ? value.website || null
        : current.website_url;

    const employeeCount =
      value.employeeCount !== undefined
        ? value.employeeCount
        : current.employee_count;

    const employeeSizeRange =
      value.employeeSizeRange !== undefined
        ? value.employeeSizeRange || null
        : current.employee_size_range;

    const status =
      value.status !== undefined
        ? value.status
        : current.status;

    const result = await db.query(
      `
      UPDATE companies
      SET
        name = $1,
        billing_email = $2,
        phone = $3,
        website_url = $4,
        employee_count = $5,
        employee_size_range = $6,
        status = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        name,
        billingEmail,
        phone,
        website,
        employeeCount,
        employeeSizeRange,
        status,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message:
        "Entreprise mise à jour avec succès",
      data: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Erreur updateAdminCompany :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de modifier l'entreprise",
    });
  }
};

module.exports = {
  updateAdminCompany,
};