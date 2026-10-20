
const { getStripe } = require("../config/stripe");

/* =========================================================
   CRÉER OU RÉCUPÉRER UN CLIENT STRIPE
========================================================= */

const getOrCreateStripeCustomer = async ({
  companyId,
  companyName,
  email,
  stripeCustomerId = null,
}) => {
  const stripe = getStripe();

  if (!companyId || !companyName || !email) {
    throw new Error(
      "Informations entreprise incomplètes."
    );
  }

  // Récupération d'un client Stripe existant
  if (stripeCustomerId) {
    const customer = await stripe.customers.retrieve(
      stripeCustomerId
    );

    if (!customer.deleted) {
      const ownerId = customer.metadata?.companyId;

      if (
        ownerId &&
        ownerId !== String(companyId)
      ) {
        throw new Error(
          "Ce client Stripe appartient à une autre entreprise."
        );
      }

      console.log(
        "✅ Client Stripe existant :",
        customer.id
      );

      return customer;
    }
  }

  // Création d'un nouveau client Stripe
  const customer = await stripe.customers.create({
    name: companyName,
    email,
    metadata: {
      companyId: String(companyId),
    },
  });

  console.log(
    "✅ Nouveau client Stripe créé :",
    customer.id
  );

  return customer;
};

/* =========================================================
   VÉRIFIER LE PRIX PREMIUM
========================================================= */

const getPremiumStripePrice = async ({
  expectedPrice,
  currency = "EUR",
}) => {
  const stripe = getStripe();

  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;

  if (!priceId) {
    throw new Error(
      "STRIPE_PREMIUM_PRICE_ID manquant dans le fichier .env."
    );
  }

  // Récupération du prix réel depuis Stripe
  const price = await stripe.prices.retrieve(priceId);

  // Vérification de la périodicité
  if (
    !price.active ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1
  ) {
    throw new Error(
      "Le prix Stripe doit être un abonnement mensuel actif."
    );
  }

  // Conversion du prix PostgreSQL en centimes
  const expectedAmount = Math.round(
    Number(expectedPrice) * 100
  );

  // Vérification du montant et de la devise
  if (
    !Number.isSafeInteger(expectedAmount) ||
    expectedAmount <= 0 ||
    price.unit_amount !== expectedAmount ||
    price.currency.toUpperCase() !==
      currency.trim().toUpperCase()
  ) {
    throw new Error(
      "Le prix Stripe ne correspond pas au prix PostgreSQL."
    );
  }

  console.log(
    "✅ Prix Premium Stripe vérifié :",
    price.unit_amount / 100,
    price.currency.toUpperCase()
  );

  return price;
};

/* =========================================================
   CRÉER UNE SESSION STRIPE CHECKOUT
========================================================= */

const createPremiumCheckoutSession = async ({
  companyId,
  companyName,
  email,
  stripeCustomerId = null,
  priceMonthly,
  currency = "EUR",
}) => {
  const stripe = getStripe();

  // Vérification des données
  if (!companyId || !companyName || !email) {
    throw new Error(
      "Informations entreprise incomplètes."
    );
  }

  const frontendUrl =
    process.env.FRONTEND_URL?.replace(/\/$/, "");

  if (!frontendUrl) {
    throw new Error(
      "FRONTEND_URL manquante dans le fichier .env."
    );
  }

  // Vérifier le tarif configuré chez Stripe
  const price = await getPremiumStripePrice({
    expectedPrice: priceMonthly,
    currency,
  });

  // Créer ou récupérer le client Stripe
  const customer = await getOrCreateStripeCustomer({
    companyId,
    companyName,
    email,
    stripeCustomerId,
  });

  // Créer une session de paiement
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",

    customer: customer.id,

    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],

    client_reference_id: String(companyId),

    metadata: {
      companyId: String(companyId),
      planCode: "PREMIUM",
    },

    subscription_data: {
      metadata: {
        companyId: String(companyId),
        planCode: "PREMIUM",
      },
    },

    success_url:
      `${frontendUrl}/dashboard/abonnement` +
      "?payment=success&session_id={CHECKOUT_SESSION_ID}",

    cancel_url:
      `${frontendUrl}/dashboard/abonnement/choisir` +
      "?payment=cancel",

    billing_address_collection: "required",
  });

  if (!session.url) {
    throw new Error(
      "Stripe n'a pas retourné d'URL de paiement."
    );
  }

  console.log(
    "✅ Session Stripe Checkout créée :",
    session.id
  );

  console.log(
    "💳 Mode Stripe :",
    session.livemode ? "LIVE" : "TEST"
  );

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    stripeCustomerId: customer.id,
  };
};



const createBillingPortalSession = async ({
  companyId,
  stripeCustomerId,
}) => {
  if (!companyId || !stripeCustomerId) {
    throw new Error("Abonnement Stripe introuvable.");
  }

  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");

  if (!frontendUrl) {
    throw new Error("FRONTEND_URL manquante.");
  }

  const stripe = getStripe();

  const customer = await stripe.customers.retrieve(stripeCustomerId);

  if (customer.deleted) {
    throw new Error("Client Stripe supprimé.");
  }

  if (customer.metadata?.companyId !== String(companyId)) {
    throw new Error(
      "Le client Stripe ne correspond pas à cette entreprise."
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${frontendUrl}/dashboard/abonnement`,
  });

  console.log(
    "✅ Portail Stripe créé pour l'entreprise :",
    companyId
  );

  return {
    portalUrl: session.url,
  };
};

module.exports = {
  getOrCreateStripeCustomer,
  getPremiumStripePrice,
  createPremiumCheckoutSession,
  createBillingPortalSession,
};

