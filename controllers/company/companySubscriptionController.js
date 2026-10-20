
const { db } = require("../../config/db");

const {
  createPremiumCheckoutSession,
  createBillingPortalSession,
} = require("../../services/stripeService");

const getPlans = async (req, res) => {
  try {
    if (req.user.role !== "COMPANY_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Accès non autorisé",
      });
    }

    const result = await db.query(`
      SELECT
        id,
        code,
        name,
        description,
        price_monthly AS "priceMonthly",
        currency,
        is_free AS "isFree",
        sort_order AS "sortOrder",
        max_active_campaigns AS "maxActiveCampaigns",
        max_participants_per_campaign AS "maxParticipantsPerCampaign",
        max_portraits_per_month AS "maxPortraitsPerMonth",
        all_styles AS "allStyles",
        hd_download AS "hdDownload",
        zip_export AS "zipExport",
        custom_branding AS "customBranding",
        priority_support AS "prioritySupport"
      FROM plans
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, id ASC
    `);

    return res.status(200).json({
      success: true,
      plans: result.rows,
    });
  } catch (error) {
    console.error("Erreur getPlans :", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de récupérer les offres",
    });
  }
};

const chooseFreePlan = async (req, res) => {
  if (req.user.role !== "COMPANY_ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Accès non autorisé",
    });
  }

  const companyId = req.user.companyId;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "Entreprise introuvable",
    });
  }

  let client;
  let transactionStarted = false;

  try {
    client = await db.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const companyResult = await client.query(
      `
      SELECT id, status
      FROM companies
      WHERE id = $1
      FOR UPDATE
      `,
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: "Entreprise introuvable",
      });
    }

    if (companyResult.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        success: false,
        message: "Cette entreprise n'est pas active",
      });
    }

    const existingResult = await client.query(
      `
      SELECT
        cs.id,
        cs.status,
        p.code AS "planCode"
      FROM company_subscriptions cs
      JOIN plans p ON p.id = cs.plan_id
      WHERE cs.company_id = $1
      LIMIT 1
      FOR UPDATE OF cs
      `,
      [companyId]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];

      await client.query("ROLLBACK");
      transactionStarted = false;

      if (
        existing.planCode === "FREE" &&
        existing.status === "ACTIVE"
      ) {
        return res.status(409).json({
          success: false,
          code: "FREE_ALREADY_ACTIVE",
          message: "Votre offre Free est déjà active.",
        });
      }

      if (
        existing.planCode === "PREMIUM" &&
        existing.status === "ACTIVE"
      ) {
        return res.status(409).json({
          success: false,
          code: "PREMIUM_ALREADY_ACTIVE",
          message: "Votre offre Premium est déjà active.",
        });
      }

      return res.status(409).json({
        success: false,
        code: "SUBSCRIPTION_EXISTS",
        message: "Un abonnement existe déjà pour cette entreprise.",
      });
    }

    const planResult = await client.query(`
      SELECT
        id,
        code,
        name,
        description,
        price_monthly AS "priceMonthly",
        currency,
        is_free AS "isFree",
        max_active_campaigns AS "maxActiveCampaigns",
        max_participants_per_campaign AS "maxParticipantsPerCampaign",
        max_portraits_per_month AS "maxPortraitsPerMonth",
        all_styles AS "allStyles",
        hd_download AS "hdDownload",
        zip_export AS "zipExport",
        custom_branding AS "customBranding",
        priority_support AS "prioritySupport"
      FROM plans
      WHERE code = 'FREE'
        AND is_active = TRUE
        AND is_free = TRUE
      LIMIT 1
    `);

    if (planResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: "L'offre Free n'est pas disponible",
      });
    }

    const plan = planResult.rows[0];

    const subscriptionResult = await client.query(
      `
      INSERT INTO company_subscriptions (
        company_id,
        plan_id,
        status,
        current_period_start,
        current_period_end
      )
      VALUES ($1, $2, 'ACTIVE', NOW(), NULL)
      RETURNING
        id,
        company_id AS "companyId",
        plan_id AS "planId",
        status,
        current_period_start AS "currentPeriodStart",
        current_period_end AS "currentPeriodEnd",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [companyId, plan.id]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("✅ Offre FREE activée :", companyId);

    return res.status(201).json({
      success: true,
      message: "Offre Free activée avec succès",
      subscription: {
        ...subscriptionResult.rows[0],
        plan,
      },
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Erreur rollback FREE :", rollbackError);
      }
    }

    console.error("Erreur chooseFreePlan :", error);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        code: "SUBSCRIPTION_EXISTS",
        message: "Un abonnement existe déjà pour cette entreprise.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Impossible d'activer l'offre Free",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

const preparePremiumPlan = async (req, res) => {
  try {
    if (req.user.role !== "COMPANY_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Accès non autorisé",
      });
    }

    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Entreprise introuvable",
      });
    }

    console.log("🔄 Préparation Checkout PREMIUM :", companyId);

    const companyResult = await db.query(
      `
      SELECT
        id,
        name,
        status,
        billing_email AS "billingEmail"
      FROM companies
      WHERE id = $1
      LIMIT 1
      `,
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Entreprise introuvable",
      });
    }

    const company = companyResult.rows[0];

    if (company.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Cette entreprise ne peut pas souscrire à Premium.",
      });
    }

    const existingResult = await db.query(
      `
      SELECT
        cs.id,
        cs.status,
        cs.stripe_customer_id AS "stripeCustomerId",
        cs.stripe_subscription_id AS "stripeSubscriptionId",
        p.code AS "planCode",
        p.name AS "planName"
      FROM company_subscriptions cs
      JOIN plans p ON p.id = cs.plan_id
      WHERE cs.company_id = $1
      LIMIT 1
      `,
      [companyId]
    );

    const existingSubscription = existingResult.rows[0] || null;

    if (
      existingSubscription?.planCode === "PREMIUM" &&
      existingSubscription?.status === "ACTIVE"
    ) {
      return res.status(409).json({
        success: false,
        code: "PREMIUM_ALREADY_ACTIVE",
        message: "Votre abonnement Premium est déjà actif.",
      });
    }

    if (
      existingSubscription?.planCode === "PREMIUM" &&
      existingSubscription?.status === "INCOMPLETE"
    ) {
      return res.status(409).json({
        success: false,
        code: "PREMIUM_PENDING",
        message: "Un abonnement Premium est déjà en attente de paiement.",
      });
    }

    if (existingSubscription?.status === "PAST_DUE") {
      return res.status(409).json({
        success: false,
        code: "PAYMENT_PAST_DUE",
        message: "Votre abonnement nécessite une régularisation de paiement.",
      });
    }

    if (
      existingSubscription &&
      !(
        existingSubscription.planCode === "FREE" &&
        existingSubscription.status === "ACTIVE"
      )
    ) {
      return res.status(409).json({
        success: false,
        code: "SUBSCRIPTION_NOT_ELIGIBLE",
        message: "Votre abonnement actuel ne permet pas cette opération.",
      });
    }

    if (existingSubscription?.stripeSubscriptionId) {
      return res.status(409).json({
        success: false,
        code: "STRIPE_SUBSCRIPTION_EXISTS",
        message: "Un abonnement Stripe est déjà associé à cette entreprise.",
      });
    }

    const planResult = await db.query(`
      SELECT
        id,
        code,
        name,
        description,
        price_monthly AS "priceMonthly",
        currency,
        is_free AS "isFree",
        max_active_campaigns AS "maxActiveCampaigns",
        max_participants_per_campaign AS "maxParticipantsPerCampaign",
        max_portraits_per_month AS "maxPortraitsPerMonth",
        all_styles AS "allStyles",
        hd_download AS "hdDownload",
        zip_export AS "zipExport",
        custom_branding AS "customBranding",
        priority_support AS "prioritySupport"
      FROM plans
      WHERE code = 'PREMIUM'
        AND is_active = TRUE
        AND is_free = FALSE
      LIMIT 1
    `);

    if (planResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "L'offre Premium n'est pas disponible",
      });
    }

    const premiumPlan = planResult.rows[0];

    if (Number(premiumPlan.priceMonthly) <= 0) {
      return res.status(409).json({
        success: false,
        code: "INVALID_PREMIUM_PRICE",
        message: "Le tarif Premium n'est pas correctement configuré.",
      });
    }

    const checkout = await createPremiumCheckoutSession({
      companyId,
      companyName: company.name,
      email: company.billingEmail || req.user.email,
      stripeCustomerId: existingSubscription?.stripeCustomerId || null,
      priceMonthly: premiumPlan.priceMonthly,
      currency: premiumPlan.currency,
    });

    console.log("✅ Stripe Checkout PREMIUM prêt :", checkout.sessionId);

    return res.status(200).json({
      success: true,
      code: "PREMIUM_CHECKOUT_READY",
      message: "Session de paiement Premium créée avec succès.",
      paymentRequired: true,
      paymentConfigured: true,
      checkoutUrl: checkout.checkoutUrl,
      sessionId: checkout.sessionId,
      action: existingSubscription
        ? "UPGRADE_FREE_TO_PREMIUM"
        : "SUBSCRIBE_PREMIUM",
      plan: premiumPlan,
    });
  } catch (error) {
    console.error("❌ Erreur preparePremiumPlan :", error);

    if (
      error.type?.startsWith("Stripe") ||
      error.name?.startsWith("Stripe")
    ) {
      return res.status(502).json({
        success: false,
        code: "STRIPE_ERROR",
        message: "Le service de paiement est momentanément indisponible.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Impossible de préparer le paiement Premium.",
    });
  }
};

const openBillingPortal = async (req, res) => {
  try {
    if (req.user.role !== "COMPANY_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Accès non autorisé",
      });
    }

    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: "Aucune entreprise associée à ce compte.",
      });
    }

    const result = await db.query(
      `
      SELECT
        cs.id,
        cs.status,
        cs.stripe_customer_id AS "stripeCustomerId",
        cs.stripe_subscription_id AS "stripeSubscriptionId",
        p.code AS "planCode",
        co.status AS "companyStatus"
      FROM company_subscriptions cs
      JOIN plans p ON p.id = cs.plan_id
      JOIN companies co ON co.id = cs.company_id
      WHERE cs.company_id = $1
      LIMIT 1
      `,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Aucun abonnement trouvé pour cette entreprise.",
      });
    }

    const subscription = result.rows[0];

    if (subscription.companyStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Cette entreprise n'est pas active.",
      });
    }

    if (
      subscription.planCode !== "PREMIUM" ||
      !subscription.stripeCustomerId ||
      !subscription.stripeSubscriptionId
    ) {
      return res.status(409).json({
        success: false,
        code: "NO_STRIPE_SUBSCRIPTION",
        message: "Aucun abonnement Premium Stripe à gérer.",
      });
    }

    if (
      !["ACTIVE", "PAST_DUE", "INCOMPLETE"].includes(
        subscription.status
      )
    ) {
      return res.status(409).json({
        success: false,
        code: "SUBSCRIPTION_NOT_MANAGEABLE",
        message: "Cet abonnement ne peut pas être géré actuellement.",
      });
    }

    const portal = await createBillingPortalSession({
      companyId,
      stripeCustomerId: subscription.stripeCustomerId,
    });

    if (!portal?.portalUrl) {
      return res.status(502).json({
        success: false,
        message: "Stripe n'a pas retourné de lien de gestion.",
      });
    }

    console.log("✅ Portail Stripe créé pour l'entreprise :", companyId);

    return res.status(200).json({
      success: true,
      message: "Portail de gestion disponible.",
      portalUrl: portal.portalUrl,
    });
  } catch (error) {
    console.error("❌ Erreur openBillingPortal :", error);

    if (
      error.type?.startsWith("Stripe") ||
      error.name?.startsWith("Stripe")
    ) {
      return res.status(502).json({
        success: false,
        code: "STRIPE_PORTAL_ERROR",
        message: "Impossible d'ouvrir le portail Stripe actuellement.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Impossible d'accéder à la gestion de l'abonnement.",
    });
  }
};

module.exports = {
  getPlans,
  chooseFreePlan,
  preparePremiumPlan,
  openBillingPortal,
};
