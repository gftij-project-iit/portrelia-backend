
const { db } = require("../../config/db");

/*
 * =========================================================
 * RÉCUPÉRATION D'UNE INVITATION PUBLIQUE
 * =========================================================
 *
 * Aucun JWT nécessaire.
 * Le collaborateur est identifié par son token UUID.
 *
 * La date expires_at doit contenir l'heure réelle
 * d'expiration calculée lors de la création.
 */

const getInvitationByToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (
      !token ||
      typeof token !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Token d'invitation invalide",
      });
    }

    const result = await db.query(
      `
      SELECT
        i.id AS invitation_id,
        i.status AS invitation_status,
        i.expires_at,
        i.sent_at,
        i.opened_at,

        p.id AS participant_id,
        p.first_name,
        p.last_name,
        p.status AS participant_status,

        c.id AS campaign_id,
        c.name AS campaign_name,
        c.description AS campaign_description,
        c.status AS campaign_status,
        c.deadline_at,

        co.id AS company_id,
        co.name AS company_name,

        ps.id AS style_id,
        ps.name AS style_name,
        ps.slug AS style_slug,
        ps.description AS style_description,
        ps.preview_image_url AS style_preview_image_url

      FROM invitations i

      INNER JOIN participants p
        ON p.id = i.participant_id

      INNER JOIN campaigns c
        ON c.id = p.campaign_id

      INNER JOIN companies co
        ON co.id = c.company_id

      LEFT JOIN portrait_styles ps
        ON ps.id = c.style_id

      WHERE i.token = $1

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

    const invitation = result.rows[0];

    /*
     * Invitation révoquée.
     */
    if (invitation.invitation_status === "REVOKED") {
      return res.status(410).json({
        success: false,
        message: "Cette invitation n'est plus valide",
      });
    }

    /*
     * Invitation déjà expirée.
     *
     * Le statut EXPIRED reste bloquant.
     * Une invitation expirée ne doit pas être
     * réactivée automatiquement par une requête GET.
     */
    if (invitation.invitation_status === "EXPIRED") {
      return res.status(410).json({
        success: false,
        message: "Cette invitation a expiré",
      });
    }

    /*
     * Vérification précise de l'expiration.
     *
     * On utilise l'heure enregistrée en base.
     *
     * Exemple correct :
     * 25 octobre à 23h59min59s, heure de Paris.
     */
    if (invitation.expires_at) {
      const expiresAt = new Date(invitation.expires_at);
      const expiresAtMs = expiresAt.getTime();

      if (!Number.isFinite(expiresAtMs)) {
        console.error(
          "Date d'expiration invalide :",
          invitation.invitation_id
        );

        return res.status(500).json({
          success: false,
          message:
            "Impossible de vérifier la validité de cette invitation",
        });
      }

      if (expiresAtMs <= Date.now()) {
        await db.query(
          `
          UPDATE invitations
          SET status = 'EXPIRED'
          WHERE id = $1
            AND status IN ('PENDING', 'SENT')
            AND expires_at <= NOW()
          `,
          [invitation.invitation_id]
        );

        return res.status(410).json({
          success: false,
          message: "Cette invitation a expiré",
        });
      }
    }

    /*
     * Campagne annulée ou terminée.
     */
    if (
      invitation.campaign_status === "CANCELLED" ||
      invitation.campaign_status === "COMPLETED"
    ) {
      return res.status(410).json({
        success: false,
        message:
          "Cette campagne n'accepte plus de participation",
      });
    }

    /*
     * Réponse publique.
     *
     * On conserve la structure utilisée
     * actuellement par le frontend.
     */
    return res.status(200).json({
      success: true,

      data: {
        invitation: {
          id: invitation.invitation_id,
          status: invitation.invitation_status,
          expiresAt: invitation.expires_at,
          sentAt: invitation.sent_at,
        },

        participant: {
          id: invitation.participant_id,
          firstName: invitation.first_name,
          lastName: invitation.last_name,
          status: invitation.participant_status,
        },

        campaign: {
          id: invitation.campaign_id,
          name: invitation.campaign_name,
          description: invitation.campaign_description,
          status: invitation.campaign_status,
          deadlineAt: invitation.deadline_at,
        },

        company: {
          id: invitation.company_id,
          name: invitation.company_name,
        },

        style: invitation.style_id
          ? {
              id: invitation.style_id,
              name: invitation.style_name,
              slug: invitation.style_slug,
              description: invitation.style_description,
              previewImageUrl:
                invitation.style_preview_image_url,
            }
          : null,
      },
    });
  } catch (error) {
    console.error(
      "Erreur getInvitationByToken :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de charger cette invitation",
    });
  }
};

module.exports = {
  getInvitationByToken,
};
