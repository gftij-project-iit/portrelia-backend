const { db } = require("../../config/db");

const getAdminCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.billing_email,
        c.phone,
        c.employee_count,
        c.employee_size_range,
        c.website_url,
        c.status,
        c.source_demo_request_id,
        c.created_at,
        c.updated_at,

        u.id AS contact_user_id,
        u.first_name AS contact_first_name,
        u.last_name AS contact_last_name,
        u.email AS contact_email,
        u.is_active AS contact_is_active,
        u.last_login_at AS contact_last_login_at,

        COUNT(DISTINCT ca.id)::INTEGER AS campaigns_count

      FROM companies c

      LEFT JOIN LATERAL (
        SELECT
          id,
          first_name,
          last_name,
          email,
          is_active,
          last_login_at
        FROM users
        WHERE company_id = c.id
          AND role = 'COMPANY_ADMIN'
        ORDER BY created_at ASC
        LIMIT 1
      ) u ON TRUE

      LEFT JOIN campaigns ca
        ON ca.company_id = c.id

      WHERE c.id = $1

      GROUP BY
        c.id,
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.is_active,
        u.last_login_at

      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Entreprise introuvable",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Erreur getAdminCompanyById :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer l'entreprise",
    });
  }
};

module.exports = {
  getAdminCompanyById,
};