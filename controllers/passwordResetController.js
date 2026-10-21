
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const { db } = require("../config/db");

const {
  sendMail,
} = require("../services/mailService");
const { resetPasswordSchema } = require("../dto/resetPassword.dto");

const RESET_EXPIRATION_MINUTES = 30;

const GENERIC_MESSAGE =
  "Si cette adresse e-mail correspond à un compte, un lien de réinitialisation vous sera envoyé.";

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

const generateResetToken = () => {
  return crypto
    .randomBytes(32)
    .toString("hex");
};

const hashResetToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};

const getFrontendUrl = () => {
  const value = process.env.FRONTEND_URL;

  if (!value) {
    throw new Error(
      "FRONTEND_URL non configurée."
    );
  }

  const url = new URL(value);

  const isHttps = url.protocol === "https:";

  const isLocal =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(
      url.hostname
    );

  if (
    (!isHttps && !isLocal) ||
    (process.env.NODE_ENV === "production" && !isHttps)
  ) {
    throw new Error(
      "FRONTEND_URL invalide."
    );
  }

  return url.origin;
};

const validPassword = (password) => {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    Buffer.byteLength(password, "utf8") <= 72
  );
};

/*
 * =========================================================
 * POST /api/v1/forgot-password
 * =========================================================
 *
 * Le client fournit uniquement son adresse e-mail.
 *
 * On retourne toujours le même message,
 * que le compte existe ou non.
 */

const forgotPassword = async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Veuillez saisir une adresse e-mail valide.",
      });
    }

    /*
     * On recherche le compte.
     *
     * La réponse HTTP ne révélera pas
     * si ce compte existe.
     */

    const userResult = await db.query(
      `
      SELECT
        id,
        first_name AS "firstName",
        email

      FROM users

      WHERE LOWER(email) = $1

      LIMIT 1
      `,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: GENERIC_MESSAGE,
      });
    }

    const user = userResult.rows[0];

    /*
     * Limite simple : au maximum une demande
     * enregistrée toutes les 60 secondes
     * pour un même compte.
     *
     * Un rate limiter global reste nécessaire
     * sur la route publique.
     */

    const recentRequest = await db.query(
      `
      SELECT id
      FROM password_reset_tokens

      WHERE user_id = $1

        AND created_at >
          NOW() - INTERVAL '60 seconds'

      LIMIT 1
      `,
      [user.id]
    );

    if (recentRequest.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: GENERIC_MESSAGE,
      });
    }

    const token = generateResetToken();

    const tokenHash = hashResetToken(token);

    const expiresAt = new Date(
      Date.now() +
      RESET_EXPIRATION_MINUTES * 60 * 1000
    );

    const frontendUrl = getFrontendUrl();

    const resetUrl =
      `${frontendUrl}/reinitialiser-mot-de-passe?token=${token}`;

    /*
     * Insertion du token avant l'envoi.
     *
     * Si l'e-mail échoue, on supprime
     * le token qui vient d'être créé.
     */

    const inserted = await db.query(
      `
      INSERT INTO password_reset_tokens (
        user_id,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [
        user.id,
        tokenHash,
        expiresAt,
      ]
    );

    const resetId = inserted.rows[0].id;

    try {
      await sendMail({
        to: user.email,

        subject:
          "Portrélia — Réinitialisation de votre mot de passe",

        html: `
          <!DOCTYPE html>
          <html lang="fr">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport"
              content="width=device-width, initial-scale=1.0" />
          </head>

          <body style="
            margin:0;
            padding:32px 16px;
            background:#f7f5fa;
            font-family:Arial,sans-serif;
            color:#211b2d;
          ">
            <div style="
              max-width:540px;
              margin:auto;
              padding:36px;
              background:#ffffff;
              border-radius:16px;
            ">
              <h1 style="
                margin:0 0 22px;
                color:#56319a;
                font-size:25px;
              ">
                Portrélia
              </h1>

              <h2 style="
                margin:0 0 16px;
                font-size:21px;
              ">
                Réinitialiser votre mot de passe
              </h2>

              <p style="
                font-size:14px;
                line-height:1.8;
              ">
                Nous avons reçu une demande de
                réinitialisation du mot de passe
                de votre compte.
              </p>

              <p style="
                font-size:14px;
                line-height:1.8;
              ">
                Cliquez sur le bouton ci-dessous
                pour choisir un nouveau mot de passe.
              </p>

              <div style="
                margin:30px 0;
                text-align:center;
              ">
                <a
                  href="${resetUrl}"
                  style="
                    display:inline-block;
                    padding:14px 24px;
                    border-radius:10px;
                    background:#56319a;
                    color:#ffffff;
                    text-decoration:none;
                    font-size:14px;
                    font-weight:bold;
                  "
                >
                  Réinitialiser mon mot de passe
                </a>
              </div>

              <p style="
                font-size:13px;
                color:#777184;
                line-height:1.8;
              ">
                Ce lien est valable pendant
                30 minutes et ne peut être
                utilisé qu'une seule fois.
              </p>

              <p style="
                font-size:13px;
                color:#777184;
                line-height:1.8;
              ">
                Si vous n'êtes pas à l'origine
                de cette demande, ignorez cet e-mail.
                Votre mot de passe actuel reste inchangé.
              </p>
            </div>
          </body>
          </html>
        `,
      });
    } catch (mailError) {
      console.error(
        "[PASSWORD RESET] Envoi e-mail échoué :",
        mailError.message
      );

      await db.query(
        `
        DELETE FROM password_reset_tokens
        WHERE id = $1
        `,
        [resetId]
      );

      // Même réponse pour ne pas révéler
      // l'existence du compte.
    }

    return res.status(200).json({
      success: true,
      message: GENERIC_MESSAGE,
    });
  } catch (error) {
    console.error(
      "[PASSWORD RESET] forgotPassword :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de traiter la demande pour le moment.",
    });
  }
};

/*
 * =========================================================
 * POST /api/v1/reset-password
 * =========================================================
 *
 * Body :
 * {
 *   token,
 *   newPassword
 * }
 *
 * Vérifie le token puis enregistre
 * le hash du nouveau mot de passe.
 */

const resetPassword = async (req, res) => {
  const { error, value } = resetPasswordSchema.validate(
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

  const { token, newPassword } = value;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const tokenHash = hashResetToken(token);

    /*
     * Verrouillage du token :
     * empêche sa consommation simultanée
     * par deux requêtes.
     */

    const tokenResult = await client.query(
      `
      SELECT
        id,
        user_id AS "userId"

      FROM password_reset_tokens

      WHERE
        token_hash = $1
        AND used_at IS NULL
        AND expires_at > NOW()

      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message:
          "Ce lien est invalide, expiré ou déjà utilisé.",
      });
    }

    const resetToken = tokenResult.rows[0];

    /*
     * Utiliser le même algorithme bcrypt
     * que le contrôleur login.
     */

    const passwordHash = await bcrypt.hash(
      newPassword,
      12
    );

    const updatedUser = await client.query(
      `
      UPDATE users

      SET password_hash = $1

      WHERE id = $2

      RETURNING id
      `,
      [
        passwordHash,
        resetToken.userId,
      ]
    );

    if (updatedUser.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message:
          "Compte introuvable.",
      });
    }

    /*
     * Invalider tous les liens de réinitialisation
     * du même utilisateur.
     */

    await client.query(
      `
      UPDATE password_reset_tokens

      SET used_at = NOW()

      WHERE user_id = $1
        AND used_at IS NULL
      `,
      [resetToken.userId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message:
        "Votre mot de passe a été réinitialisé. Vous pouvez vous connecter.",
    });
  } catch (error) {
    await client
      .query("ROLLBACK")
      .catch(() => {});

    console.error(
      "[PASSWORD RESET] resetPassword :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de réinitialiser le mot de passe.",
    });
  } finally {
    client.release();
  }
};

module.exports = {
  forgotPassword,
  resetPassword,
};
