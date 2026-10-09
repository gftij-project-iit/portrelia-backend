const { db } = require("../../config/db");
const {
  updateAdminDemoRequestStatusSchema,
} = require("../../dto/admin/updateAdminDemoRequestStatus.dto");

const updateAdminDemoRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const { error, value } =
      updateAdminDemoRequestStatusSchema.validate(
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

    const { status } = value;

    const currentResult = await db.query(
      `
      SELECT id, status
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

    const currentStatus =
      currentResult.rows[0].status;

    if (
      currentStatus === "ACCEPTED" ||
      currentStatus === "REJECTED"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Cette demande est déjà finalisée",
      });
    }

    if (
      status === "CONTACTED" &&
      currentStatus !== "PENDING"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Cette demande a déjà été contactée",
      });
    }

    const result = await db.query(
      `
      UPDATE demo_requests
      SET
        status = $1,
        handled_by_user_id = $2,
        handled_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      RETURNING
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
      `,
      [
        status,
        req.user.id,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message:
        status === "CONTACTED"
          ? "Demande marquée comme contactée"
          : "Demande refusée",
      data: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Erreur updateAdminDemoRequestStatus :",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
};

module.exports = {
  updateAdminDemoRequestStatus,
};