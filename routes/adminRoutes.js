const express = require("express");



const { authMiddleware } = require("../middlewares/authMiddleware");
const { roleMiddleware } = require("../middlewares/roleMiddleware");
const { getAdminDemoRequests } = require("../controllers/admin/adminDemoRequestController");
const { getAdminDemoRequestById } = require("../controllers/admin/adminDemoRequestById");
const { updateAdminDemoRequestStatus } = require("../controllers/admin/updateAdminDemoRequestStatus");
const { acceptAdminDemoRequest } = require("../controllers/admin/acceptAdminDemoRequest");
const { getAdminCompanies } = require("../controllers/admin/adminCompanies");
const { getAdminCompanyById } = require("../controllers/admin/adminCompanyById");
const { updateAdminCompany } = require("../controllers/admin/updateAdminCompany");
const { deleteAdminCompany } = require("../controllers/admin/deleteAdminCompany");
const { deleteAdminDemoRequest } = require("../controllers/admin/deleteAdminDemoRequest");


const router = express.Router();

// Toutes les routes ici = ADMIN uniquement
router.use(authMiddleware);
router.use(roleMiddleware("ADMIN"));

// Demandes de démo
router.get("/demo-requests", getAdminDemoRequests);
router.get("/demo-requests/:id", getAdminDemoRequestById);
router.patch("/demo-requests/:id/status", updateAdminDemoRequestStatus);
router.post("/demo-requests/:id/accept",acceptAdminDemoRequest);

// Entreprises
router.get("/companies",getAdminCompanies);
router.get("/companies/:id",getAdminCompanyById);
router.patch("/companies/:id",updateAdminCompany);
router.delete("/companies/:id",deleteAdminCompany);
router.delete("/demo-requests/:id",deleteAdminDemoRequest);

module.exports = router;