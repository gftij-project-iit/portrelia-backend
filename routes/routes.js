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

const router = express.Router();

// Public
router.post("/demo-requests", createDemoRequest);
router.post("/activate-account", activateAccount);
router.post("/login", login);

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