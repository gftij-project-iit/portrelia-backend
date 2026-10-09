const { db } = require("../../config/db");

const getAdminCompanies = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        c.id,
        c.name,
        c.billing_email,
        c.phone,
        c.employee_count,
        c.employee_size_range,
        c.website_url,
        c.status,
        c.created_at,
        c.updated_at,

        u.first_name AS contact_first_name,
        u.last_name AS contact_last_name,
        u.email AS contact_email,
        u.is_active AS contact_is_active,

        COUNT(DISTINCT ca.id)::INTEGER AS campaigns_count

      FROM companies c

      LEFT JOIN LATERAL (
        SELECT
          first_name,
          last_name,
          email,
          is_active
        FROM users
        WHERE company_id = c.id
          AND role = 'COMPANY_ADMIN'
        ORDER BY created_at ASC
        LIMIT 1
      ) u ON TRUE

      LEFT JOIN campaigns ca
        ON ca.company_id = c.id

      GROUP BY
        c.id,
        u.first_name,
        u.last_name,
        u.email,
        u.is_active

      ORDER BY c.created_at DESC
    `);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error(
      "Erreur getAdminCompanies :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer les entreprises",
    });
  }
};

module.exports = {
  getAdminCompanies,
};