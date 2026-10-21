
const { db } = require("../../config/db");
const { getStripe } = require("../../config/stripe");

/* =========================================================
   1. FONCTIONS UTILITAIRES

   Ces fonctions simplifient la lecture des données Stripe.
========================================================= */

/**
 * Stripe utilise des timestamps Unix en secondes.
 * PostgreSQL attend une date JavaScript.
 *
 * Exemple :
 * 1792500000 -> Date JavaScript
 */
const toDate = (timestamp) => {
  if (timestamp === null || timestamp === undefined) {
    return null;
  }

  const date = new Date(Number(timestamp) * 1000);

  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Dans Stripe, certaines propriétés peuvent contenir :
 *
 * - un identifiant : "sub_123"
 * - un objet complet : { id: "sub_123", ... }
 *
 * Cette fonction retourne toujours l'identifiant.
 */
const getStripeId = (value) => {
  if (!value) return null;

  return typeof value === "string"
    ? value
    : value.id || null;
};

/**
 * Conversion des statuts Stripe vers nos statuts SQL.
 *
 * Stripe        PostgreSQL
 * active     -> ACTIVE
 * past_due   -> PAST_DUE
 * unpaid     -> PAST_DUE
 * canceled   -> CANCELED
 * autres     -> INCOMPLETE
 */
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
   2. SYNCHRONISER UN ABONNEMENT STRIPE

   Cette fonction est appelée après un événement Stripe.

   Elle :
   1. Relit l'abonnement actuel chez Stripe.
   2. Vérifie son entreprise et son tarif.
   3. Vérifie les conditions du premier paiement.
   4. Met à jour PostgreSQL.
   5. Enregistre les résiliations programmées.

   IMPORTANT :
   On relit Stripe au lieu de faire confiance uniquement
   aux informations présentes dans l'événement webhook.

   Cela permet de récupérer l'état actuel même si plusieurs
   événements arrivent dans un ordre différent.
========================================================= */

const syncStripeSubscription = async (
  stripe,
  subscriptionId,
  { initialCheckout = null } = {}
) => {
  if (!subscriptionId) {
    throw new Error("Identifiant abonnement Stripe manquant.");
  }

  /* ---------------------------------------------------------
     2.1 Récupérer l'abonnement actuel chez Stripe
  --------------------------------------------------------- */

  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId,
    {
      expand: ["latest_invoice"],
    }
  );

  /* ---------------------------------------------------------
     2.2 Identifier l'entreprise propriétaire
     
     Le companyId est enregistré dans les métadonnées
     Stripe au moment de la création de l'abonnement.
  --------------------------------------------------------- */

  const companyId = Number(
    subscription.metadata?.companyId
  );

  if (
    !Number.isSafeInteger(companyId) ||
    companyId <= 0
  ) {
    throw new Error(
      "Identifiant entreprise Stripe invalide."
    );
  }

  /* ---------------------------------------------------------
     2.3 Récupérer le client Stripe
  --------------------------------------------------------- */

  const customerId = getStripeId(
    subscription.customer
  );

  if (!customerId) {
    throw new Error(
      "Client Stripe introuvable."
    );
  }

  /* ---------------------------------------------------------
     2.4 Vérifier le tarif PREMIUM

     On refuse de synchroniser un abonnement utilisant
     un tarif différent de celui configuré dans le backend.

     Attention :
     Si tu modifies le tarif Stripe plus tard, les anciens
     abonnements peuvent conserver leur ancien price_id.
     Il faudra alors adapter cette vérification pour gérer
     plusieurs versions de tarifs autorisées.
  --------------------------------------------------------- */

  const item = subscription.items?.data?.[0];

  if (
    subscription.items?.data?.length !== 1 ||
    item?.price?.id !==
      process.env.STRIPE_PREMIUM_PRICE_ID
  ) {
    throw new Error(
      "Le prix de l'abonnement Stripe est invalide."
    );
  }

  /* ---------------------------------------------------------
     2.5 Vérifier la dernière facture

     Pour le premier paiement, nous exigeons une facture
     payée et une session Checkout confirmée.

     Pour les mises à jour ultérieures, nous conservons
     le principe de l'abonnement Stripe déjà associé.
  --------------------------------------------------------- */

  const latestInvoice = subscription.latest_invoice;

  const latestInvoicePaid =
    latestInvoice?.status === "paid";

  /* ---------------------------------------------------------
     2.6 Récupérer les dates de la période

     La période de facturation est déjà stockée
     dans PostgreSQL.

     Exemple :
     Début : 20 octobre 2026
     Fin   : 20 novembre 2026
  --------------------------------------------------------- */

  const periodStart = toDate(
    item.current_period_start
  );

  const periodEnd = toDate(
    item.current_period_end
  );

  /* ---------------------------------------------------------
     2.7 Identifier la résiliation programmée

     false :
       L'abonnement se renouvelle normalement.

     true :
       Le client a demandé la résiliation à échéance.

     IMPORTANT :
     cancel_at_period_end = true ne veut PAS dire que
     l'abonnement est déjà terminé.

     Il reste ACTIVE jusqu'à la résiliation effective.
  --------------------------------------------------------- */

  const cancelAtPeriodEnd =
  subscription.status !== "canceled" &&
  (
    subscription.cancel_at_period_end === true ||
    (
      subscription.cancel_at != null &&
      Number(subscription.cancel_at) > 0
    )
  );

  /* ---------------------------------------------------------
     2.8 Récupérer la date de demande de résiliation

     canceled_at est renseigné par Stripe dans certains
     scénarios de résiliation.

     Ce n'est pas le même champ que cancel_at_period_end.
  --------------------------------------------------------- */

  const canceledAt = toDate(
    subscription.canceled_at
  );

  /* ---------------------------------------------------------
     2.9 Identifier une résiliation définitive

     Quand Stripe passe à "canceled", l'abonnement n'est
     plus actif.

     Nous remettons alors l'entreprise sur FREE.
  --------------------------------------------------------- */

  const isCanceled =
    subscription.status === "canceled";

  const stripeStatus = getSubscriptionStatus(
    subscription.status
  );

  /* =========================================================
     3. TRANSACTION POSTGRESQL

     On utilise une transaction pour éviter d'enregistrer
     une modification partielle en cas d'erreur.

     BEGIN    -> démarrer
     COMMIT   -> valider
     ROLLBACK -> annuler en cas d'erreur
  ========================================================= */

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /* -------------------------------------------------------
       3.1 Verrouiller l'entreprise

       Cela évite que deux webhooks modifient simultanément
       les données de la même entreprise.
    ------------------------------------------------------- */

    const companyResult = await client.query(
      `
      SELECT id
      FROM companies
      WHERE id = $1
      FOR UPDATE
      `,
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      throw new Error(
        "Entreprise introuvable dans PostgreSQL."
      );
    }

    /* -------------------------------------------------------
       3.2 Lire l'abonnement PostgreSQL existant
    ------------------------------------------------------- */

    const existingResult = await client.query(
      `
      SELECT
        cs.id,
        cs.status,
        cs.stripe_customer_id AS "stripeCustomerId",
        cs.stripe_subscription_id AS "stripeSubscriptionId",
        p.code AS "planCode"

      FROM company_subscriptions cs

      JOIN plans p
        ON p.id = cs.plan_id

      WHERE cs.company_id = $1

      FOR UPDATE OF cs
      `,
      [companyId]
    );

    const existing = existingResult.rows[0] || null;

    /* -------------------------------------------------------
       3.3 Protection : abonnement Stripe différent

       Si une autre souscription est déjà enregistrée,
       on refuse de la remplacer automatiquement.

       Cela protège contre l'écrasement d'un abonnement
       par un autre abonnement Stripe.
    ------------------------------------------------------- */

    if (
      existing?.stripeSubscriptionId &&
      existing.stripeSubscriptionId !== subscription.id
    ) {
      throw new Error(
        "Une autre souscription Stripe est déjà liée."
      );
    }

    /* -------------------------------------------------------
       3.4 Protection : client Stripe différent
    ------------------------------------------------------- */

    if (
      existing?.stripeCustomerId &&
      existing.stripeCustomerId !== customerId
    ) {
      throw new Error(
        "Client Stripe différent du client enregistré."
      );
    }

    /* -------------------------------------------------------
       3.5 Identifier la première activation

       La première activation PREMIUM exige impérativement
       un Checkout payé.

       Un simple customer.subscription.updated ne suffit
       pas à activer un nouvel abonnement.
    ------------------------------------------------------- */

    const firstActivation =
      !existing?.stripeSubscriptionId;

    if (firstActivation) {
      if (!initialCheckout) {
        await client.query("ROLLBACK");

        console.log(
          "ℹ️ Webhook ignoré : premier paiement non confirmé",
          {
            companyId,
            subscriptionId: subscription.id,
          }
        );

        return;
      }

      const validInitialCheckout =
        initialCheckout.payment_status === "paid" &&
        initialCheckout.status === "complete" &&
        initialCheckout.mode === "subscription" &&
        initialCheckout.metadata?.planCode === "PREMIUM" &&
        initialCheckout.metadata?.companyId ===
          String(companyId) &&
        initialCheckout.client_reference_id ===
          String(companyId) &&
        getStripeId(initialCheckout.customer) ===
          customerId &&
        getStripeId(initialCheckout.subscription) ===
          subscription.id &&
        subscription.status === "active" &&
        latestInvoicePaid;

      if (!validInitialCheckout) {
        throw new Error(
          "Paiement initial Premium non confirmé."
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
          "L'abonnement existant ne peut pas être remplacé."
        );
      }
    }

    /* -------------------------------------------------------
       3.6 Récupérer les identifiants des plans

       On récupère les IDs depuis PostgreSQL plutôt
       que d'écrire directement 1 ou 2 dans le code.
    ------------------------------------------------------- */

    const plansResult = await client.query(
      `
      SELECT id, code
      FROM plans
      WHERE code IN ('FREE', 'PREMIUM')
      `
    );

    const freePlan = plansResult.rows.find(
      (plan) => plan.code === "FREE"
    );

    const premiumPlan = plansResult.rows.find(
      (plan) => plan.code === "PREMIUM"
    );

    if (!freePlan || !premiumPlan) {
      throw new Error(
        "Plans FREE ou PREMIUM introuvables."
      );
    }

    /* -------------------------------------------------------
       3.7 Déterminer le plan final

       Cas A : PREMIUM actif
         -> PREMIUM + ACTIVE

       Cas B : résiliation programmée
         -> PREMIUM + ACTIVE
         -> cancel_at_period_end = TRUE

       Cas C : résiliation définitive
         -> FREE + ACTIVE
         -> cancel_at_period_end = FALSE

       Cas D : impayé
         -> PREMIUM + PAST_DUE
    ------------------------------------------------------- */

    const planId = isCanceled
      ? freePlan.id
      : premiumPlan.id;

    const dbStatus = isCanceled
      ? "ACTIVE"
      : stripeStatus;

    const dbCancelAtPeriodEnd = isCanceled
      ? false
      : cancelAtPeriodEnd;

    const dbPeriodEnd = isCanceled
      ? null
      : periodEnd;

    /* =======================================================
       4. METTRE À JOUR L'ABONNEMENT
    ======================================================= */

    if (existing) {
      /* -----------------------------------------------------
         4.1 Abonnement existant : UPDATE

         C'est ici qu'on ajoute :

         cancel_at_period_end = $9

         Le champ est mis à jour à chaque changement Stripe.
      ----------------------------------------------------- */

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
          cancel_at_period_end = $9,
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
          dbPeriodEnd,
          canceledAt,
          dbCancelAtPeriodEnd,
        ]
      );
    } else {
      /* -----------------------------------------------------
         4.2 Première souscription : INSERT

         Quand l'entreprise n'a pas encore de ligne
         dans company_subscriptions, on la crée.

         Le premier paiement a déjà été vérifié plus haut.
      ----------------------------------------------------- */

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
          canceled_at,
          cancel_at_period_end
        )

        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9
        )
        `,
        [
          companyId,
          planId,
          dbStatus,
          customerId,
          subscription.id,
          periodStart,
          dbPeriodEnd,
          canceledAt,
          dbCancelAtPeriodEnd,
        ]
      );
    }

    /* -------------------------------------------------------
       4.3 Valider toutes les modifications
    ------------------------------------------------------- */

    await client.query("COMMIT");

    /* -------------------------------------------------------
       4.4 Journaliser la synchronisation

       Ces informations permettront de vérifier
       le fonctionnement dans les logs Render.
    ------------------------------------------------------- */

    console.log(
      "✅ Abonnement Stripe synchronisé :",
      {
        companyId,
        subscriptionId: subscription.id,
        plan: isCanceled ? "FREE" : "PREMIUM",
        status: dbStatus,
        cancelAtPeriodEnd: dbCancelAtPeriodEnd,
        periodEnd: dbPeriodEnd,
      }
    );
  } catch (error) {
    /* -------------------------------------------------------
       En cas d'erreur, on annule les changements SQL.

       Stripe pourra retenter le webhook lorsqu'on retourne
       ensuite une erreur HTTP 500.
    ------------------------------------------------------- */

    await client.query("ROLLBACK").catch(() => {});

    throw error;
  } finally {
    /* -------------------------------------------------------
       Toujours libérer la connexion PostgreSQL.
    ------------------------------------------------------- */

    client.release();
  }
};

/* =========================================================
   5. RÉCEPTION DES WEBHOOKS STRIPE

   Stripe envoie automatiquement des événements à :

   POST /api/v1/stripe/webhook

   Le webhook traite uniquement les événements autorisés
   par notre application.
========================================================= */

const stripeWebhook = async (req, res) => {
  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET;

  /* ---------------------------------------------------------
     5.1 Vérifier la configuration
  --------------------------------------------------------- */

  if (!webhookSecret) {
    console.error(
      "❌ STRIPE_WEBHOOK_SECRET manquant."
    );

    return res.status(503).send(
      "Webhook non configuré."
    );
  }

  const stripe = getStripe();

  let event;

  /* ---------------------------------------------------------
     5.2 Vérifier la signature Stripe

     Cette vérification garantit que la requête provient
     réellement de Stripe.

     IMPORTANT :
     Ton app.js utilise déjà express.raw() pour ce webhook.
     Il faut conserver cette configuration.
  --------------------------------------------------------- */

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
      "Signature Stripe invalide."
    );
  }

  console.log(
    "📩 Webhook Stripe reçu :",
    event.type,
    event.id
  );

  try {
    /* -------------------------------------------------------
       5.3 Vérifier le mode Stripe

       Ton projet utilise une clé Stripe restreinte LIVE.

       Stripe possède deux types de préfixes possibles :

       sk_live_ : clé secrète classique
       rk_live_ : clé restreinte

       On accepte donc les deux préfixes LIVE.
    ------------------------------------------------------- */

    const secretKey =
      process.env.STRIPE_SECRET_KEY?.trim();

    if (
      !secretKey ||
      !(
        secretKey.startsWith("sk_live_") ||
        secretKey.startsWith("rk_live_") ||
        secretKey.startsWith("sk_test_") ||
        secretKey.startsWith("rk_test_")
      )
    ) {
      throw new Error(
        "Clé secrète Stripe invalide ou manquante."
      );
    }

    const configuredLiveMode =
      secretKey.startsWith("sk_live_") ||
      secretKey.startsWith("rk_live_");

    if (event.livemode !== configuredLiveMode) {
      throw new Error(
        "Mode Stripe incompatible."
      );
    }

    /* =======================================================
       6. TRAITEMENT DES ÉVÉNEMENTS
    ======================================================= */

    switch (event.type) {
      /* -----------------------------------------------------
         6.1 Premier paiement Stripe

         Stripe indique que le Checkout est terminé.

         On vérifie le paiement avant d'activer PREMIUM.
      ----------------------------------------------------- */

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

      /* -----------------------------------------------------
         6.2 Facture payée ou paiement échoué

         invoice.paid :
           Une facture a été payée.

         invoice.payment_failed :
           Un paiement a échoué.

         Dans les deux cas, on relit l'abonnement Stripe
         pour synchroniser son statut réel.
      ----------------------------------------------------- */

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

      /* -----------------------------------------------------
         6.3 Modification de l'abonnement

         Événement utilisé notamment lorsque :

         - le client programme une résiliation ;
         - le client annule cette résiliation ;
         - Stripe modifie son statut ;
         - sa période de facturation change.

         Exemple :

         Résiliation :
           cancel_at_period_end = true

         Réactivation :
           cancel_at_period_end = false
      ----------------------------------------------------- */

      case "customer.subscription.updated": {
        const subscription = event.data.object;

        await syncStripeSubscription(
          stripe,
          subscription.id
        );

        break;
      }

      /* -----------------------------------------------------
         6.4 Résiliation définitive

         Stripe annonce que l'abonnement est terminé.

         syncStripeSubscription() détecte :
           subscription.status === "canceled"

         Puis PostgreSQL passe à :
           plan = FREE
           status = ACTIVE
           cancel_at_period_end = FALSE
      ----------------------------------------------------- */

      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        await syncStripeSubscription(
          stripe,
          subscription.id
        );

        break;
      }

      /* -----------------------------------------------------
         6.5 Autres événements Stripe

         Ils ne sont pas traités par cette application.
      ----------------------------------------------------- */

      default:
        console.log(
          "ℹ️ Événement Stripe non traité :",
          event.type
        );

        break;
    }

    /* -------------------------------------------------------
       7. Confirmer à Stripe que l'événement est traité.

       HTTP 200 signifie que Stripe n'a pas besoin
       de réessayer cet événement.
    ------------------------------------------------------- */

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    /* -------------------------------------------------------
       HTTP 500 :

       Une erreur est survenue pendant la synchronisation.

       Stripe pourra effectuer une nouvelle tentative.
    ------------------------------------------------------- */

    console.error(
      "❌ Erreur webhook Stripe :",
      error
    );

    return res.status(500).json({
      received: false,
    });
  }
};

/* =========================================================
   8. EXPORT

   app.js importe cette fonction pour exposer la route :

   POST /api/v1/stripe/webhook
========================================================= */

module.exports = {
  stripeWebhook,
};
