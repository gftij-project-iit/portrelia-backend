
const bcrypt = require("bcryptjs");

const { db } = require("../../config/db");

/*
 * =========================================================
 * PATCH /api/v1/company/settings/password
 * =========================================================
 *
 * Route réservée au COMPANY_ADMIN connecté.
 *
 * Body :
 * {
 *   currentPassword: "...",
 *   newPassword: "..."
 * }
 *
 * Aucun e-mail.
 * Aucun lien de réinitialisation.
 */

const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;

    const {
      currentPassword,
      newPassword,
    } = req.body || {};

    /*
     * Vérification de l'authentification.
     */

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Session invalide. Veuillez vous reconnecter.",
      });
    }

    /*
     * Vérification des champs.
     */

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Veuillez remplir tous les champs.",
      });
    }

    /*
     * Validation du nouveau mot de passe.
     */

    if (
      newPassword.length < 8 ||
      Buffer.byteLength(newPassword, "utf8") > 72
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Le nouveau mot de passe doit contenir au moins 8 caractères et ne pas dépasser 72 octets.",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Le nouveau mot de passe doit être différent de l'ancien.",
      });
    }

    /*
     * Récupération du hash actuel.
     */

    const result = await db.query(
      `
      SELECT
        id,
        password_hash AS "passwordHash"
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Compte introuvable.",
      });
    }

    const user = result.rows[0];

    /*
     * Vérification du mot de passe actuel.
     */

    const isCurrentPasswordValid =
      await bcrypt.compare(
        currentPassword,
        user.passwordHash
      );

    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Le mot de passe actuel est incorrect.",
      });
    }

    /*
     * Protection contre la réutilisation
     * du même mot de passe.
     */

    const isSamePassword =
      await bcrypt.compare(
        newPassword,
        user.passwordHash
      );

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message:
          "Veuillez choisir un mot de passe différent de l'actuel.",
      });
    }

    /*
     * Hash du nouveau mot de passe.
     */

    const newPasswordHash =
      await bcrypt.hash(newPassword, 12);

    /*
     * Mise à jour conditionnelle :
     * si le mot de passe a changé entre-temps,
     * on ne remplace pas une modification récente.
     */

    const updated = await db.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
        AND password_hash = $3
      RETURNING id
      `,
      [
        newPasswordHash,
        userId,
        user.passwordHash,
      ]
    );

    if (updated.rows.length === 0) {
      return res.status(409).json({
        success: false,
        message:
          "Le mot de passe a été modifié entre-temps. Veuillez réessayer.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Votre mot de passe a été modifié avec succès.",
    });
  } catch (error) {
    console.error(
      "[COMPANY SETTINGS] CHANGE PASSWORD:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de modifier votre mot de passe pour le moment.",
    });
  }
};

module.exports = {
  changePassword,
};
