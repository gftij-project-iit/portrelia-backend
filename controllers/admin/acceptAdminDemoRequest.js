const { db } = require("../../config/db");

const {
  sendMail,
} = require("../../services/mailService");

const {
  accountActivationEmail,
} = require("../../templates/accountActivationEmail");

const {
  generateActivationToken,
  hashToken,
  getActivationTokenExpiration,
} = require("../../utils/tokenUtils");

const acceptAdminDemoRequest = async (
  req,
  res
) => {
  const client = await db.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const requestResult =
      await client.query(
        `
        SELECT *
        FROM demo_requests
        WHERE id = $1
        FOR UPDATE
        `,
        [id]
      );

    if (requestResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message:
          "Demande introuvable",
      });
    }

    const demoRequest =
      requestResult.rows[0];

    if (
      demoRequest.status === "ACCEPTED"
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message:
          "Cette demande est déjà acceptée",
      });
    }

    if (
      demoRequest.status === "REJECTED"
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message:
          "Une demande refusée ne peut plus être acceptée",
      });
    }

    const existingCompany =
      await client.query(
        `
        SELECT id
        FROM companies
        WHERE source_demo_request_id = $1
        LIMIT 1
        `,
        [id]
      );

    if (
      existingCompany.rows.length > 0
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message:
          "Une entreprise existe déjà pour cette demande",
      });
    }

    const existingUser =
      await client.query(
        `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [demoRequest.email]
      );

    if (
      existingUser.rows.length > 0
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message:
          "Un utilisateur existe déjà avec cet email",
      });
    }

    const companyResult =
      await client.query(
        `
        INSERT INTO companies (
          name,
          billing_email,
          phone,
          employee_size_range,
          status,
          source_demo_request_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'ACTIVE',
          $5
        )
        RETURNING *
        `,
        [
          demoRequest.company_name,
          demoRequest.email,
          demoRequest.phone,
          demoRequest.team_size,
          id,
        ]
      );

    const company =
      companyResult.rows[0];

    const activationToken =
      generateActivationToken();

    const activationTokenHash =
      hashToken(
        activationToken
      );

    const activationTokenExpiresAt =
      getActivationTokenExpiration();

    const userResult =
      await client.query(
        `
        INSERT INTO users (
          first_name,
          last_name,
          email,
          password_hash,
          role,
          company_id,
          is_active,
          activation_token_hash,
          activation_token_expires_at
        )
        VALUES (
          $1,
          $2,
          $3,
          NULL,
          'COMPANY_ADMIN',
          $4,
          FALSE,
          $5,
          $6
        )
        RETURNING
          id,
          first_name,
          last_name,
          email,
          role,
          company_id,
          is_active
        `,
        [
          demoRequest.first_name,
          demoRequest.last_name,
          demoRequest.email,
          company.id,
          activationTokenHash,
          activationTokenExpiresAt,
        ]
      );

    const user =
      userResult.rows[0];

    const updatedRequest =
      await client.query(
        `
        UPDATE demo_requests
        SET
          status = 'ACCEPTED',
          handled_by_user_id = $1,
          handled_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [
          req.user.id,
          id,
        ]
      );

    await client.query("COMMIT");

    const activationUrl =
      `${process.env.FRONTEND_URL}/activation-compte?token=${activationToken}`;

    const html =
      accountActivationEmail({
        firstName:
          demoRequest.first_name,
        companyName:
          demoRequest.company_name,
        activationUrl,
      });

    try {
      await sendMail({
        to: demoRequest.email,
        subject:
          "Activez votre compte Portrélia",
        html,
      });
    } catch (mailError) {
      console.error(
        "Erreur envoi email activation :",
        mailError
      );

      return res.status(201).json({
        success: true,
        emailSent: false,
        message:
          "La demande a été acceptée et le compte créé, mais l'email d'activation n'a pas pu être envoyé.",
        data: {
          request:
            updatedRequest.rows[0],
          company,
          user,
        },
      });
    }

    return res.status(201).json({
      success: true,
      emailSent: true,
      message:
        "Demande acceptée. L'entreprise a été créée et l'email d'activation a été envoyé.",
      data: {
        request:
          updatedRequest.rows[0],
        company,
        user,
      },
    });
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {
      // Transaction déjà terminée
    }

    console.error(
      "Erreur acceptAdminDemoRequest :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible d'accepter cette demande",
    });
  } finally {
    client.release();
  }
};

module.exports = {
  acceptAdminDemoRequest,
};