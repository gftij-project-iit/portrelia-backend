const { db } = require("../../config/db");

/*
 * =========================================================
 * RÉCUPÉRATION D'UNE INVITATION PUBLIQUE
 * =========================================================
 *
 * Cette route ne nécessite PAS de JWT.
 *
 * Le collaborateur est identifié uniquement
 * grâce au token UUID présent dans son lien.
 *
 * Exemple :
 * /invitation?token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */

const getInvitationByToken =
  async (req, res) => {
    try {
      const {
        token,
      } = req.params;

      /*
       * Vérification minimale du token.
       */
      if (
        !token ||
        typeof token !== "string"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Token d'invitation invalide",
          });
      }

      /*
       * On recherche EXACTEMENT
       * l'invitation correspondant
       * au token reçu.
       *
       * On ne cherche jamais par
       * participant_id ici.
       */
      const result =
        await db.query(
          `
          SELECT
            i.id
              AS invitation_id,

            i.status
              AS invitation_status,

            i.expires_at,

            i.sent_at,

            i.opened_at,

            p.id
              AS participant_id,

            p.first_name,

            p.last_name,

            p.status
              AS participant_status,

            c.id
              AS campaign_id,

            c.name
              AS campaign_name,

            c.description
              AS campaign_description,

            c.status
              AS campaign_status,

            c.deadline_at,

            co.id
              AS company_id,

            co.name
              AS company_name,

            ps.id
              AS style_id,

            ps.name
              AS style_name,

            ps.slug
              AS style_slug,

            ps.description
              AS style_description,

            ps.preview_image_url
              AS style_preview_image_url

          FROM invitations i

          INNER JOIN participants p
            ON p.id =
               i.participant_id

          INNER JOIN campaigns c
            ON c.id =
               p.campaign_id

          INNER JOIN companies co
            ON co.id =
               c.company_id

          LEFT JOIN portrait_styles ps
            ON ps.id =
               c.style_id

          WHERE
            i.token = $1

          LIMIT 1
          `,
          [
            token,
          ]
        );

      /*
       * Aucun token correspondant.
       */
      if (
        result.rows.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Invitation introuvable",
          });
      }

      const invitation =
        result.rows[0];

      /*
       * Invitation révoquée.
       *
       * Normalement ce cas deviendra
       * rare avec notre modèle :
       * 1 participant = 1 invitation.
       */
      if (
        invitation
          .invitation_status ===
        "REVOKED"
      ) {
        return res
          .status(410)
          .json({
            success: false,
            message:
              "Cette invitation n'est plus valide",
          });
      }

      /*
       * Invitation déjà marquée
       * comme expirée.
       */
      if (
        invitation
          .invitation_status ===
        "EXPIRED"
      ) {
        return res
          .status(410)
          .json({
            success: false,
            message:
              "Cette invitation a expiré",
          });
      }

      /*
       * Vérification réelle de
       * expires_at.
       *
       * Même si le statut n'a pas encore
       * été changé en EXPIRED, le lien
       * devient inutilisable dès que
       * expires_at est dépassé.
       */
      if (
        invitation.expires_at &&
        new Date(
          invitation.expires_at
        ).getTime() <= Date.now()
      ) {
        /*
         * On synchronise également
         * le statut en base.
         */
        await db.query(
          `
          UPDATE invitations

          SET
            status = 'EXPIRED'

          WHERE
            id = $1
            AND status <> 'EXPIRED'
          `,
          [
            invitation
              .invitation_id,
          ]
        );

        return res
          .status(410)
          .json({
            success: false,
            message:
              "Cette invitation a expiré",
          });
      }

      /*
       * Une campagne annulée ou terminée
       * ne peut plus accepter
       * de participation.
       */
      if (
        invitation
          .campaign_status ===
          "CANCELLED" ||
        invitation
          .campaign_status ===
          "COMPLETED"
      ) {
        return res
          .status(410)
          .json({
            success: false,
            message:
              "Cette campagne n'accepte plus de participation",
          });
      }

      /*
       * On ne renvoie au frontend
       * que les informations utiles.
       *
       * Aucun email interne,
       * aucune information sensible
       * de l'entreprise n'est exposée.
       */
      return res
        .status(200)
        .json({
          success: true,

          data: {
            invitation: {
              id:
                invitation
                  .invitation_id,

              status:
                invitation
                  .invitation_status,

              expiresAt:
                invitation
                  .expires_at,

              sentAt:
                invitation
                  .sent_at,
            },

            participant: {
              id:
                invitation
                  .participant_id,

              firstName:
                invitation
                  .first_name,

              lastName:
                invitation
                  .last_name,

              status:
                invitation
                  .participant_status,
            },

            campaign: {
              id:
                invitation
                  .campaign_id,

              name:
                invitation
                  .campaign_name,

              description:
                invitation
                  .campaign_description,

              status:
                invitation
                  .campaign_status,

              deadlineAt:
                invitation
                  .deadline_at,
            },

            company: {
              id:
                invitation
                  .company_id,

              name:
                invitation
                  .company_name,
            },

            style: invitation.style_id
              ? {
                  id:
                    invitation
                      .style_id,

                  name:
                    invitation
                      .style_name,

                  slug:
                    invitation
                      .style_slug,

                  description:
                    invitation
                      .style_description,

                  previewImageUrl:
                    invitation
                      .style_preview_image_url,
                }
              : null,
          },
        });
    } catch (error) {
      console.error(
        "Erreur getInvitationByToken :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible de charger cette invitation",
        });
    }
  };

module.exports = {
  getInvitationByToken,
};