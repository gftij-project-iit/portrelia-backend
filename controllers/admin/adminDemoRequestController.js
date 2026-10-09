const { db } = require("../../config/db");


const getAdminDemoRequests = async (req, res) => {
  try {
    const result = await db.query(`
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
      ORDER BY created_at DESC
    `);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Erreur getAdminDemoRequests :", error);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
};





module.exports = {
  getAdminDemoRequests
};