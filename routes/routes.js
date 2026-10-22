
const express = require("express");

const { createDemoRequest } = require("../controllers/demoRequestController");
const {
  login,
  me,
  logout,
  acceptRequiredAction,
} = require("../controllers/authController");

const { authMiddleware } = require("../middlewares/authMiddleware");
const { activateAccount } = require("../controllers/activateAccountController");
const { getPublicCompanyGallery } = require("../controllers/company/getCompanyGalleryPortraits");
const { forgotPassword, resetPassword } = require("../controllers/passwordResetController");
const { demoLimiter, loginLimiter, passwordLimiter } = require("../middlewares/rateLimiting");



const router = express.Router();

// Public
router.post("/demo-requests", demoLimiter, createDemoRequest);
router.post("/activate-account", activateAccount);
router.post("/login", loginLimiter, login);

// Galerie publique accessible avec un lien de partage
router.get("/public/gallery/:token", getPublicCompanyGallery);

// Mot de passe oublié — aucune connexion nécessaire
router.post("/forgot-password", passwordLimiter, forgotPassword);

// Nouveau mot de passe depuis le lien reçu par e-mail
router.post("/reset-password", resetPassword);

// Authentification
router.get("/me", authMiddleware, me);
router.post("/logout", authMiddleware, logout);

// Required actions COMPANY_ADMIN
router.post(
  "/required-actions/:actionId/accept",
  authMiddleware,
  acceptRequiredAction
);

module.exports = router;
