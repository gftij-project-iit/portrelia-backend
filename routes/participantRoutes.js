const express = require("express");

const { getInvitationByToken } = require("../controllers/participant/getInvitationByToken");
const { uploadParticipantPhotos } = require("../controllers/participant/uploadParticipantPhotos");
const { getParticipantPhotos } = require("../controllers/participant/getParticipantPhotos");
const { getParticipantPhotoFile } = require("../controllers/participant/getParticipantPhotoFile");
const { deleteParticipantPhoto } = require("../controllers/participant/deleteParticipantPhoto");
const { submitParticipantPhotos } = require("../controllers/participant/submitParticipantPhotos");

const { participantInvitationMiddleware } = require("../middlewares/participantInvitationMiddleware");
const { participantPhotoUpload } = require("../middlewares/participantPhotoUpload");

const router = express.Router();

/*
 * =========================================================
 * ROUTES PUBLIQUES COLLABORATEUR
 * =========================================================
 *
 * Pas de authMiddleware.
 * Pas de roleMiddleware.
 *
 * Le collaborateur n'a pas de compte Portrélia.
 * Son accès est sécurisé grâce au token UUID
 * présent dans son invitation.
 */

/* Invitation */
router.get(
  "/invitations/:token",
  getInvitationByToken
);

/* Liste des photos déjà enregistrées */
router.get(
  "/invitations/:token/photos",
  participantInvitationMiddleware,
  getParticipantPhotos
);

/* Upload de nouvelles photos */
router.post(
  "/invitations/:token/photos",
  participantInvitationMiddleware,
  participantPhotoUpload,
  uploadParticipantPhotos
);

/* Affichage sécurisé d'une photo */
router.get(
  "/invitations/:token/photos/:photoId/file",
  participantInvitationMiddleware,
  getParticipantPhotoFile
);

/* Suppression réelle d'une photo */
router.delete(
  "/invitations/:token/photos/:photoId",
  participantInvitationMiddleware,
  deleteParticipantPhoto
);

/* Validation finale des photos */
router.post(
  "/invitations/:token/photos/submit",
  participantInvitationMiddleware,
  submitParticipantPhotos
);

module.exports = router;