const { db } = require("../config/db");

/*
 * =========================================================
 * ACCÈS COLLABORATEUR PAR TOKEN D'INVITATION
 * =========================================================
 *
 * Le collaborateur n'a pas de compte Portrélia.
 *
 * Son token d'invitation permet :
 * - d'identifier son invitation
 * - d'identifier son participant
 * - de vérifier l'expiration
 * - de vérifier la campagne
 *
 * Ce middleware ne remplace PAS authMiddleware.
 * Il est spécifique au parcours collaborateur.
 */

const participantInvitationMiddleware =
  async (req, res, next) => {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Token d'invitation manquant",
        });
      }

      const result = await db.query(
        `
        SELECT
          i.id AS invitation_id,
          i.token,
          i.status AS invitation_status,
          i.expires_at,

          p.id AS participant_id,
          p.status AS participant_status,
          p.first_name,
          p.last_name,
          p.email,

          c.id AS campaign_id,
          c.status AS campaign_status,
          c.deadline_at,
          c.company_id

        FROM invitations i

        INNER JOIN participants p
          ON p.id = i.participant_id

        INNER JOIN campaigns c
          ON c.id = p.campaign_id

        WHERE
          i.token = $1

        LIMIT 1
        `,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Invitation introuvable",
        });
      }

      const access = result.rows[0];

      /*
       * Invitation explicitement révoquée.
       */
      if (
        access.invitation_status === "REVOKED"
      ) {
        return res.status(410).json({
          success: false,
          message: "Cette invitation n'est plus valide",
        });
      }

      /*
       * Invitation déjà expirée.
       */
      if (
        access.invitation_status === "EXPIRED"
      ) {
        return res.status(410).json({
          success: false,
          message: "Cette invitation a expiré",
        });
      }

      /*
       * Vérification réelle de la date.
       */
      if (
        access.expires_at &&
        new Date(access.expires_at).getTime() <=
          Date.now()
      ) {
        await db.query(
          `
          UPDATE invitations

          SET
            status = 'EXPIRED'

          WHERE
            id = $1
          `,
          [access.invitation_id]
        );

        return res.status(410).json({
          success: false,
          message: "Cette invitation a expiré",
        });
      }

      /*
       * La campagne doit toujours accepter
       * les participations.
       */
      if (
        access.campaign_status === "CANCELLED" ||
        access.campaign_status === "COMPLETED"
      ) {
        return res.status(410).json({
          success: false,
          message:
            "Cette campagne n'accepte plus de participation",
        });
      }

      /*
       * Données disponibles dans les controllers.
       */
      req.participantAccess = access;

      next();
    } catch (error) {
      console.error(
        "Erreur participantInvitationMiddleware :",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Impossible de vérifier cette invitation",
      });
    }
  };

module.exports = {
  participantInvitationMiddleware,
};