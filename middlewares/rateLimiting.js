
const { rateLimit } = require("express-rate-limit");

// Protection générale de l'API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Trop de requêtes. Veuillez réessayer plus tard.",
  },
});

// Protection des connexions
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Trop de tentatives de connexion. Réessayez plus tard.",
  },
});

// Protection des demandes de réinitialisation
const passwordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Trop de demandes. Réessayez plus tard.",
  },
});

// Protection des formulaires de démonstration
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Trop de demandes de démonstration.",
  },
});

module.exports = {
  apiLimiter,
  loginLimiter,
  passwordLimiter,
  demoLimiter,
};
