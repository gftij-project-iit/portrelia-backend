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
const { getAdminCampaigns, getAdminCampaignById, getAdminParticipantById } = require("../controllers/admin/adminCampaignController");
const { reviewAdminPhoto } = require("../controllers/admin/adminPhotoReviewController");
const { completeParticipantQa } = require("../controllers/admin/adminQaController");
const { startParticipantGeneration } = require("../controllers/admin/adminGenerationController");
const { getGeneratedPortraitsForParticipant } = require("../controllers/admin/adminGeneratedPortraitController");
const { regenerateGeneratedPortrait } = require("../controllers/admin/adminPortraitRegenerationController");
const { reviewGeneratedPortrait } = require("../controllers/admin/adminGeneratedPortraitReviewController");
const { completePortraitQa } = require("../controllers/admin/adminPortraitQaCompleteController");
const { getAdminGalleries } = require("../controllers/admin/adminGalleriesController");
const { getAdminCompanyGalleryShare } = require("../controllers/admin/adminCompanyGalleryShareController");



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


router.get("/campaigns", getAdminCampaigns);
router.get("/campaigns/:campaignId", getAdminCampaignById);
router.get("/participants/:participantId",getAdminParticipantById);
router.patch( "/photos/:photoId/review",reviewAdminPhoto);
router.post("/participants/:participantId/qa/complete",completeParticipantQa);
router.post( "/participants/:participantId/generation/start",startParticipantGeneration);
router.get("/participants/:participantId/generated-portraits",getGeneratedPortraitsForParticipant);
router.post("/generated-portraits/:portraitId/regenerate",regenerateGeneratedPortrait);
router.patch("/generated-portraits/:portraitId/review",reviewGeneratedPortrait);
router.post("/participants/:participantId/portraits-qa/complete", completePortraitQa);
router.get("/galleries",getAdminGalleries);
router.get(
  "/companies/:companyId/campaigns/:campaignId/gallery-share",
  getAdminCompanyGalleryShare
);


module.exports = router;