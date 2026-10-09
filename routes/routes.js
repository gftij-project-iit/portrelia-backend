const express = require("express");
const { createDemoRequest } = require("../controllers/demoRequestController");
const { login, me, logout } = require("../controllers/authController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { activateAccount } = require("../controllers/activateAccountController");



const router = express.Router();

router.post( "/demo-requests", createDemoRequest);
router.post("/activate-account",activateAccount);
// Authentification
router.post("/login", login);
router.get("/me", authMiddleware, me);
router.post("/logout", authMiddleware, logout);

module.exports = router;