
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { dbConnect } = require("./config/db");
const { testSupabaseConnection } = require("./config/supabase");
const { testStripeConnection } = require("./config/stripe");
const { stripeWebhook } = require("./controllers/company/stripeWebhookController");

const router = require("./routes/routes");

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Webhook Stripe avant express.json()
app.post(
  "/api/v1/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

dbConnect();
testSupabaseConnection();
testStripeConnection();

// Routes publiques et authentification
app.use("/api/v1", router);

// Routes administrateur
app.use("/api/v1/admin", require("./routes/adminRoutes"));

// Routes entreprise
app.use("/api/v1/company", require("./routes/companyRoutes"));

// Routes participant
app.use("/api/v1/participant", require("./routes/participantRoutes"));

const start = async () => {
  try {
    const port = process.env.PORT ;

    app.listen(port, () => {
      console.log(`Auth service running on http://localhost:${port}`);
      console.log("Stripe webhook : /api/v1/stripe/webhook");
    });
  } catch (error) {
    console.error("❌ Auth service failed:", error);
    process.exit(1);
  }
};

start();
