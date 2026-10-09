const { db } = require("../../config/db");

const deleteAdminDemoRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const currentResult = await db.query(
      `
      SELECT
        id,
        status
      FROM demo_requests
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Demande introuvable",
      });
    }

    const currentRequest =
      currentResult.rows[0];

    /*
     * On évite de supprimer directement
     * une demande déjà acceptée,
     * car elle peut être liée à une company.
     */
    if (currentRequest.status === "ACCEPTED") {
      return res.status(409).json({
        success: false,
        message:
          "Une demande acceptée ne peut pas être supprimée directement. Supprimez d'abord l'entreprise associée.",
      });
    }

    const result = await db.query(
      `
      DELETE FROM demo_requests
      WHERE id = $1
      RETURNING
        id,
        company_name,
        email,
        status
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      message:
        "Demande de démo supprimée avec succès",
      data: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Erreur deleteAdminDemoRequest :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de supprimer la demande",
    });
  }
};

module.exports = {
  deleteAdminDemoRequest,
};