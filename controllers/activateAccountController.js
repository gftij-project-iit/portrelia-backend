const crypto = require("crypto");
const bcrypt = require("bcrypt");

const { db } = require("../config/db");
const { activateAccountSchema } = require("../dto/admin/activateAccount.dto");



const activateAccount = async (
  req,
  res
) => {
  try {
    const { error, value } =
      activateAccountSchema.validate(
        req.body,
        {
          abortEarly: false,
          stripUnknown: true,
        }
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          error.details[0].message,
      });
    }

    const {
      token,
      password,
    } = value;

    const tokenHash =
      crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

    const userResult =
      await db.query(
        `
        SELECT
          id,
          is_active
        FROM users
        WHERE activation_token_hash = $1
          AND activation_token_expires_at > NOW()
        LIMIT 1
        `,
        [tokenHash]
      );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Lien d'activation invalide ou expiré",
      });
    }

    const user =
      userResult.rows[0];

    if (user.is_active) {
      return res.status(409).json({
        success: false,
        message:
          "Ce compte est déjà activé",
      });
    }

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    await db.query(
      `
      UPDATE users
      SET
        password_hash = $1,
        is_active = TRUE,
        activation_token_hash = NULL,
        activation_token_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        passwordHash,
        user.id,
      ]
    );

    return res.status(200).json({
      success: true,
      message:
        "Votre compte a été activé avec succès",
    });
  } catch (error) {
    console.error(
      "Erreur activateAccount :",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
};

module.exports = {
  activateAccount,
};