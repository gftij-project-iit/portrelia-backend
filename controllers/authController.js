const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { db } = require("../config/db");
const { loginSchema } = require("../dto/login.dto");

/*
 * Actions obligatoires non encore validées
 * pour un COMPANY_ADMIN.
 */
const getRequiredActionsForUser = async (userId, role) => {
  if (role !== "COMPANY_ADMIN") {
    return [];
  }

  const result = await db.query(
    `
    SELECT
      ra.id,
      ra.code,
      ra.version,
      ra.title,
      ra.description,
      ra.created_at AS "createdAt"
    FROM required_actions ra
    WHERE ra.is_active = TRUE
      AND ra.target_role = 'COMPANY_ADMIN'
      AND NOT EXISTS (
        SELECT 1
        FROM user_required_action_acceptances ura
        WHERE ura.user_id = $1
          AND ura.required_action_id = ra.id
      )
    ORDER BY ra.created_at ASC, ra.id ASC
    `,
    [userId]
  );

  return result.rows;
};

/*
 * Abonnement de l'entreprise.
 * ADMIN => null
 * COMPANY_ADMIN sans plan => null
 */
const getSubscriptionForUser = async (companyId, role) => {
  if (role !== "COMPANY_ADMIN" || !companyId) {
    return null;
  }

  const result = await db.query(
    `
    SELECT
      cs.id,
      cs.status,
      cs.stripe_customer_id AS "stripeCustomerId",
      cs.stripe_subscription_id AS "stripeSubscriptionId",
      cs.current_period_start AS "currentPeriodStart",
      cs.current_period_end AS "currentPeriodEnd",
      cs.canceled_at AS "canceledAt",
      cs.created_at AS "createdAt",
      cs.updated_at AS "updatedAt",

      p.id AS "planId",
      p.code AS "planCode",
      p.name AS "planName",
      p.description AS "planDescription",
      p.price_monthly AS "priceMonthly",
      p.currency,
      p.is_free AS "isFree"
    FROM company_subscriptions cs
    JOIN plans p ON p.id = cs.plan_id
    WHERE cs.company_id = $1
    LIMIT 1
    `,
    [companyId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const subscription = result.rows[0];

  return {
    id: subscription.id,
    status: subscription.status,
    stripeCustomerId: subscription.stripeCustomerId,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    canceledAt: subscription.canceledAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    plan: {
      id: subscription.planId,
      code: subscription.planCode,
      name: subscription.planName,
      description: subscription.planDescription,
      priceMonthly: subscription.priceMonthly,
      currency: subscription.currency,
      isFree: subscription.isFree,
    },
  };
};

const login = async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { email, password } = value;

    const result = await db.query(
      `
      SELECT
        id,
        first_name,
        last_name,
        email,
        password_hash,
        role,
        company_id,
        is_active
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Compte désactivé",
      });
    }

    const passwordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await db.query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    const requiredActions = await getRequiredActionsForUser(
      user.id,
      user.role
    );

    const subscription = await getSubscriptionForUser(
      user.company_id,
      user.role
    );

    return res.status(200).json({
      success: true,
      message: "Connexion réussie",
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        requiredActions,
        subscription,
      },
    });
  } catch (error) {
    console.error("Erreur login :", error);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
};

const me = async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        first_name,
        last_name,
        email,
        role,
        company_id,
        is_active
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur introuvable",
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Compte désactivé",
      });
    }

    const requiredActions = await getRequiredActionsForUser(
      user.id,
      user.role
    );

    const subscription = await getSubscriptionForUser(
      user.company_id,
      user.role
    );

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        requiredActions,
        subscription,
      },
    });
  } catch (error) {
    console.error("Erreur me :", error);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
};

const acceptRequiredAction = async (req, res) => {
  try {
    if (req.user.role !== "COMPANY_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Action non autorisée",
      });
    }

    const actionId = Number(req.params.actionId);

    if (!Number.isInteger(actionId) || actionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Action invalide",
      });
    }

    const actionResult = await db.query(
      `
      SELECT
        id,
        code,
        version,
        title,
        target_role AS "targetRole",
        is_active AS "isActive"
      FROM required_actions
      WHERE id = $1
      LIMIT 1
      `,
      [actionId]
    );

    if (actionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Action introuvable",
      });
    }

    const action = actionResult.rows[0];

    if (!action.isActive) {
      return res.status(409).json({
        success: false,
        message: "Cette action n'est plus active",
      });
    }

    if (action.targetRole !== "COMPANY_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Cette action ne concerne pas votre compte",
      });
    }

    await db.query(
      `
      INSERT INTO user_required_action_acceptances (
        user_id,
        required_action_id,
        accepted_at
      )
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, required_action_id)
      DO NOTHING
      `,
      [req.user.id, actionId]
    );

    return res.status(200).json({
      success: true,
      message: "Action validée",
    });
  } catch (error) {
    console.error("Erreur required action :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de valider l'action",
    });
  }
};

const logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return res.status(200).json({
    success: true,
    message: "Déconnexion réussie",
  });
};

module.exports = {
  login,
  me,
  logout,
  acceptRequiredAction,
};