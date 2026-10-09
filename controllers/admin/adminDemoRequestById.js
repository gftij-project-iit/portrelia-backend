const { db } = require("../../config/db");

const getAdminDemoRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT
        id,
        company_name,
        first_name,
        last_name,
        email,
        phone,
        team_size,
        message,
        consent_to_contact,
        status,
        handled_by_user_id,
        handled_at,
        internal_notes,
        created_at,
        updated_at
      FROM demo_requests
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Demande introuvable",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Erreur getAdminDemoRequestById :",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
};

module.exports = {
  getAdminDemoRequestById,
};