
const { db } = require("../../config/db");
const { getStripe } = require("../../config/stripe");

/* =========================================================
   HELPERS
========================================================= */

const toDate = (timestamp) => {
  if (!timestamp) return null;
  return new Date(timestamp * 1000);
};

const getStripeId = (value) => {
  if (!value) return null;

  return typeof value === "string"
    ? value
    : value.id || null;
};

const getSubscriptionStatus = (status) => {
  switch (status) {
    case "active":
      return "ACTIVE";

    case "past_due":
    case "unpaid":
      return "PAST_DUE";

    case "canceled":
      return "CANCELED";

    default:
      return "INCOMPLETE";
  }
};

/* =========================================================
   SYNCHRONISER L'ABONNEMENT

   Pour une nouvelle souscription, l'activation
   doit être autorisée par un Checkout payé.

   Pour les suivantes, on utilise l'identifiant
   de souscription Stripe déjà enregistré.
========================================================= */

const syncStripeSubscription = async (
  stripe,
  subscriptionId,
  { initialCheckout = null } = {}
) => {
  const subscription =
    await stripe.subscriptions.retrieve(
      subscriptionId,
      {
        expand: ["latest_invoice"],
      }
    );

  const companyId = Number(
    subscription.metadata?.companyId
  );

  if (
    !Number.isSafeInteger(companyId) ||
    companyId <= 0
  ) {
    throw new Error(
      "Identifiant entreprise Stripe invalide"
    );
  }

  const customerId = getStripeId(
    subscription.customer
  );

  if (!customerId) {
    throw new Error(
      "Client Stripe introuvable"
    );
  }

  const item = subscription.items?.data?.[0];

  if (
    subscription.items?.data?.length !== 1 ||
    item?.price?.id !==
      process.env.STRIPE_PREMIUM_PRICE_ID
  ) {
    throw new Error(
      "Le prix de l'abonnement Stripe est invalide"
    );
  }

  const latestInvoice =
    subscription.latest_invoice;

  const latestInvoicePaid =
    latestInvoice?.status === "paid";

  const periodStart = toDate(
    item.current_period_start
  );

  const periodEnd = toDate(
    item.current_period_end
  );

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Verrouiller l'entreprise.
    const companyResult = await client.query(
      `
      SELECT id
      FROM companies
      WHERE id = $1
      FOR UPDATE
      `,
      [companyId]
    );

    if (!companyResult.rows.length) {
      throw new Error(
        "Entreprise introuvable dans PostgreSQL"
      );
    }

    const existingResult = await client.query(
      `
      SELECT
        cs.id,
        cs.status,
        cs.stripe_customer_id AS "stripeCustomerId",
        cs.stripe_subscription_id AS "stripeSubscriptionId",
        p.code AS "planCode"
      FROM company_subscriptions cs
      JOIN plans p ON p.id = cs.plan_id
      WHERE cs.company_id = $1
      FOR UPDATE OF cs
      `,
      [companyId]
    );

    const existing = existingResult.rows[0];

    if (
      existing?.stripeSubscriptionId &&
      existing.stripeSubscriptionId !==
        subscription.id
    ) {
      throw new Error(
        "Une autre souscription Stripe est déjà liée"
      );
    }

    if (
      existing?.stripeCustomerId &&
      existing.stripeCustomerId !== customerId
    ) {
      throw new Error(
        "Client Stripe différent du client enregistré"
      );
    }

    const firstActivation =
      !existing?.stripeSubscriptionId;

    if (firstActivation) {
      // Ne jamais activer un nouvel abonnement
      // sur un simple événement subscription.updated.
      if (!initialCheckout) {
        await client.query("ROLLBACK");
        return;
      }

      if (
        initialCheckout.payment_status !== "paid" ||
        initialCheckout.status !== "complete" ||
        initialCheckout.mode !== "subscription" ||
        initialCheckout.metadata?.planCode !== "PREMIUM" ||
        initialCheckout.metadata?.companyId !==
          String(companyId) ||
        initialCheckout.client_reference_id !==
          String(companyId) ||
        getStripeId(initialCheckout.customer) !==
          customerId ||
        getStripeId(initialCheckout.subscription) !==
          subscription.id ||
        subscription.status !== "active" ||
        !latestInvoicePaid
      ) {
        throw new Error(
          "Paiement initial Premium non confirmé"
        );
      }

      if (
        existing &&
        !(
          existing.planCode === "FREE" &&
          existing.status === "ACTIVE"
        )
      ) {
        throw new Error(
          "L'abonnement existant ne peut pas être remplacé"
        );
      }
    }

    const status = getSubscriptionStatus(
      subscription.status
    );

    const premiumResult = await client.query(
      `
      SELECT id
      FROM plans
      WHERE code = 'PREMIUM'
      LIMIT 1
      `
    );

    const freeResult = await client.query(
      `
      SELECT id
      FROM plans
      WHERE code = 'FREE'
      LIMIT 1
      `
    );

    if (
      !premiumResult.rows.length ||
      !freeResult.rows.length
    ) {
      throw new Error(
        "Plans FREE ou PREMIUM introuvables"
      );
    }

    const premiumId = premiumResult.rows[0].id;
    const freeId = freeResult.rows[0].id;

    // Après résiliation effective, revenir à FREE.
    // Les autres statuts conservent le plan PREMIUM,
    // mais seul ACTIVE donne accès à ses avantages.
    const canceled =
      subscription.status === "canceled";

    const planId = canceled
      ? freeId
      : premiumId;

    const dbStatus = canceled
      ? "ACTIVE"
      : status;

    if (existing) {
      await client.query(
        `
        UPDATE company_subscriptions
        SET
          plan_id = $2,
          status = $3,
          stripe_customer_id = $4,
          stripe_subscription_id = $5,
          current_period_start = $6,
          current_period_end = $7,
          canceled_at = $8,
          updated_at = NOW()
        WHERE company_id = $1
        `,
        [
          companyId,
          planId,
          dbStatus,
          customerId,
          subscription.id,
          periodStart,
          canceled ? null : periodEnd,
          toDate(subscription.canceled_at),
        ]
      );
    } else {
      await client.query(
        `
        INSERT INTO company_subscriptions (
          company_id,
          plan_id,
          status,
          stripe_customer_id,
          stripe_subscription_id,
          current_period_start,
          current_period_end,
          canceled_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          companyId,
          planId,
          dbStatus,
          customerId,
          subscription.id,
          periodStart,
          periodEnd,
          toDate(subscription.canceled_at),
        ]
      );
    }

    await client.query("COMMIT");

    console.log(
      "✅ Abonnement Stripe synchronisé :",
      {
        companyId,
        subscriptionId: subscription.id,
        plan: canceled ? "FREE" : "PREMIUM",
        status: dbStatus,
      }
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* =========================================================
   WEBHOOK STRIPE
========================================================= */

const stripeWebhook = async (req, res) => {
  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error(
      "❌ STRIPE_WEBHOOK_SECRET manquant"
    );

    return res.status(503).send(
      "Webhook non configuré"
    );
  }

  const stripe = getStripe();

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      webhookSecret
    );
  } catch (error) {
    console.error(
      "❌ Signature Stripe invalide :",
      error.message
    );

    return res.status(400).send(
      "Signature Stripe invalide"
    );
  }

  console.log(
    "📩 Webhook Stripe reçu :",
    event.type,
    event.id
  );

  try {
    // Éviter de mélanger les événements
    // des comptes LIVE et TEST.
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

const configuredLiveMode =
  secretKey?.startsWith("sk_live_") ||
  secretKey?.startsWith("rk_live_");

    if (event.livemode !== configuredLiveMode) {
      throw new Error(
        "Mode Stripe incompatible"
      );
    }

    switch (event.type) {
      /* =====================================
         PAIEMENT INITIAL
      ===================================== */

      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;

        if (
          session.mode !== "subscription" ||
          !session.subscription ||
          session.payment_status !== "paid"
        ) {
          break;
        }

        // Relire la session depuis Stripe.
        const checkout =
          await stripe.checkout.sessions.retrieve(
            session.id
          );

        if (
          checkout.status !== "complete" ||
          checkout.payment_status !== "paid"
        ) {
          break;
        }

        await syncStripeSubscription(
          stripe,
          getStripeId(checkout.subscription),
          {
            initialCheckout: checkout,
          }
        );

        break;
      }

      /* =====================================
         RENOUVELLEMENT / IMPAYÉ
      ===================================== */

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object;

        const subscriptionId = getStripeId(
          invoice.parent?.subscription_details
            ?.subscription
        );

        if (subscriptionId) {
          await syncStripeSubscription(
            stripe,
            subscriptionId
          );
        }

        break;
      }

      /* =====================================
         CHANGEMENT / RÉSILIATION
      ===================================== */

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        await syncStripeSubscription(
          stripe,
          subscription.id
        );

        break;
      }

      default:
        break;
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error(
      "❌ Erreur webhook Stripe :",
      error
    );

    return res.status(500).json({
      received: false,
    });
  }
};

module.exports = {
  stripeWebhook,
};
