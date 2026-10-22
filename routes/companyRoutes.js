const express = require("express");

const { authMiddleware } = require("../middlewares/authMiddleware");
const { roleMiddleware } = require("../middlewares/roleMiddleware");

const { createCampaign } = require("../controllers/company/createCampaign");
const { getCampaigns } = require("../controllers/company/getCampaigns");
const { getCampaignById } = require("../controllers/company/getCampaignById");
const { updateCampaign } = require("../controllers/company/updateCampaign");
const { cancelCampaign } = require("../controllers/company/cancelCampaign");
const { addCampaignParticipants } = require("../controllers/company/addCampaignParticipants");
const { resendCampaignInvitation } = require("../controllers/company/resendCampaignInvitation");
const { getPlans, chooseFreePlan, preparePremiumPlan, openBillingPortal, getBillingInvoices } = require("../controllers/company/companySubscriptionController");
const { getCompanyGalleryPortraits, getCompanyGalleryShare, createCompanyGalleryShare, revokeCompanyGalleryShare, getCompanyGalleryCampaigns } = require("../controllers/company/getCompanyGalleryPortraits");
const { changePassword } = require("../controllers/company/changePassword");
const { invitationLimiter } = require("../middlewares/rateLimiting");

const router = express.Router();

// Toutes les routes ici = COMPANY_ADMIN uniquement
router.use(authMiddleware);
router.use(roleMiddleware("COMPANY_ADMIN"));

// Invitations collaborateurs
router.post( "/campaigns/:id/invitations/:invitationId/resend",
  invitationLimiter,
  resendCampaignInvitation);

router.get("/plans",getPlans);

router.post(
  "/subscription/free",
  chooseFreePlan
);

router.post(
  "/subscription/premium",
  preparePremiumPlan
);


// Campagnes
router.get("/campaigns", getCampaigns);
router.get("/campaigns/:id", getCampaignById);
router.post("/campaigns", createCampaign);
router.patch("/campaigns/:id", updateCampaign);
router.post("/campaigns/:id/cancel", cancelCampaign);

// Collaborateurs d'une campagne
router.post("/campaigns/:id/participants", addCampaignParticipants);
router.post("/subscription/portal", openBillingPortal);

//factures
router.get("/billing/invoices", getBillingInvoices);


router.get("/gallery/campaigns", getCompanyGalleryCampaigns);
router.get("/gallery/portraits", getCompanyGalleryPortraits);
router.get("/gallery/share", getCompanyGalleryShare);
router.post("/gallery/share", createCompanyGalleryShare);
router.delete("/gallery/share", revokeCompanyGalleryShare);

// Paramètres — modification du mot de passe
router.patch("/settings/password", changePassword);



module.exports = router;