
const Stripe = require("stripe");

let stripeInstance = null;

const getStripe = () => {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY manquante");
  }

  stripeInstance = new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 30000,
  });

  return stripeInstance;
};

const testStripeConnection = async () => {
  try {
    console.log("🔄 Vérification de Stripe...");

    const stripe = getStripe();

    // Véritable requête vers l'API Stripe
    const account = await stripe.accounts.retrieve();

    console.log("✅ Stripe connecté avec succès");
    console.log("🏢 Compte Stripe :", account.id);
    console.log(
      "🔐 Mode :",
      process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")
        ? "TEST"
        : "LIVE"
    );

    return true;
  } catch (error) {
    console.error("❌ Connexion Stripe échouée :", error.message);
    return false;
  }
};

module.exports = {
  getStripe,
  testStripeConnection,
};
