const crypto =
  require("crypto");

const {
  db,
} = require("../../config/db");

const {
  sendMail,
} = require("../../services/mailService");

const {
  participantInvitationEmail,
} = require(
  "../../templates/participantInvitationEmail"
);

/*
 * =========================================================
 * RELANCE D'UNE INVITATION
 * =========================================================
 *
 * Nouveau fonctionnement :
 *
 * - un participant possède UNE seule invitation
 * - aucune nouvelle ligne n'est créée lors d'une relance
 * - un nouveau token est généré
 * - la même invitation est mise à jour
 * - reminder_count est incrémenté
 *
 * Si Brevo échoue :
 * - la transaction est annulée
 * - l'ancien token reste valide
 * - aucune donnée n'est perdue
 */

const resendCampaignInvitation =
  async (req, res) => {

    const client =
      await db.connect();

    try {
      const companyId =
        req.user.companyId;

      const userId =
        req.user.id;

      const campaignId =
        Number(
          req.params.id
        );

      const invitationId =
        Number(
          req.params.invitationId
        );

      /*
       * Vérification des paramètres.
       */
      if (
        !companyId ||
        !Number.isInteger(
          campaignId
        ) ||
        !Number.isInteger(
          invitationId
        ) ||
        campaignId <= 0 ||
        invitationId <= 0
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Paramètres invalides",
          });
      }

      await client.query(
        "BEGIN"
      );

      /*
       * On verrouille l'invitation
       * pendant toute la relance.
       *
       * Cela empêche deux relances
       * simultanées sur la même invitation.
       */
      const result =
        await client.query(
          `
          SELECT
            i.id
              AS invitation_id,

            i.token,

            i.status
              AS invitation_status,

            i.expires_at,

            i.sent_at,

            i.opened_at,

            i.reminder_count,

            p.id
              AS participant_id,

            p.first_name,

            p.last_name,

            p.email,

            c.id
              AS campaign_id,

            c.name
              AS campaign_name,

            c.status
              AS campaign_status,

            c.deadline_at,

            co.name
              AS company_name

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

          WHERE
            i.id = $1

            AND c.id = $2

            AND c.company_id = $3

          LIMIT 1

          FOR UPDATE OF i
          `,
          [
            invitationId,
            campaignId,
            companyId,
          ]
        );

      if (
        result.rows.length ===
        0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res
          .status(404)
          .json({
            success: false,
            message:
              "Invitation introuvable",
          });
      }

      const data =
        result.rows[0];

      /*
       * Une campagne terminée
       * ou annulée ne peut plus
       * envoyer d'invitation.
       */
      if (
        data.campaign_status ===
          "COMPLETED" ||
        data.campaign_status ===
          "CANCELLED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res
          .status(409)
          .json({
            success: false,
            message:
              "Impossible de renvoyer une invitation pour cette campagne",
          });
      }

      /*
       * Le nouveau token est généré
       * côté Node.
       *
       * On conserve toujours
       * UNE seule ligne invitation.
       */
      const newToken =
        crypto.randomUUID();

      /*
       * L'expiration de l'invitation
       * suit la deadline actuelle
       * de la campagne.
       */
      const expiresAt =
        data.deadline_at ||
        null;

      /*
       * On prépare l'invitation
       * avec le nouveau token.
       *
       * IMPORTANT :
       * nous sommes toujours dans
       * la transaction.
       *
       * Si l'email échoue,
       * un ROLLBACK restaurera
       * automatiquement l'ancien token.
       */
      const pendingResult =
        await client.query(
          `
          UPDATE invitations

          SET
            token = $1,
            status = 'PENDING',
            expires_at = $2,
            opened_at = NULL

          WHERE
            id = $3

          RETURNING
            id,
            token,
            status,
            expires_at
              AS "expiresAt",
            reminder_count
              AS "reminderCount"
          `,
          [
            newToken,
            expiresAt,
            invitationId,
          ]
        );

      const invitation =
        pendingResult.rows[0];

      /*
       * Construction du nouveau
       * lien sécurisé.
       */
      const invitationUrl =
        `${process.env.FRONTEND_URL}/invitation?token=${invitation.token}`;

      /*
       * Formatage de la deadline
       * pour l'email.
       */
      const deadline =
        expiresAt
          ? new Intl
              .DateTimeFormat(
                "fr-FR",
                {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                }
              )
              .format(
                new Date(
                  expiresAt
                )
              )
          : null;

      /*
       * =====================================================
       * ENVOI BREVO
       * =====================================================
       *
       * Si l'envoi échoue :
       *
       * ROLLBACK
       *
       * donc :
       * - ancien token restauré
       * - ancien statut restauré
       * - ancien expires_at restauré
       */
      try {
        await sendMail({
          to:
            data.email,

          subject:
            `Rappel Portrélia — ${data.campaign_name}`,

          html:
            participantInvitationEmail({
              firstName:
                data.first_name,

              campaignName:
                data.campaign_name,

              companyName:
                data.company_name,

              invitationUrl,

              deadline,
            }),
        });
      } catch (mailError) {
        await client.query(
          "ROLLBACK"
        );

        console.error(
          "Erreur Brevo lors de la relance :",
          mailError
        );

        return res
          .status(502)
          .json({
            success: false,
            message:
              "L'email n'a pas pu être envoyé. L'invitation précédente reste active.",
          });
      }

      /*
       * L'email a été envoyé.
       *
       * La même invitation passe
       * maintenant à SENT.
       */
      const sentResult =
        await client.query(
          `
          UPDATE invitations

          SET
            status = 'SENT',

            sent_at = NOW(),

            reminder_count =
              reminder_count + 1,

            last_reminder_at =
              NOW()

          WHERE
            id = $1

          RETURNING
            id,

            token,

            status,

            sent_at
              AS "sentAt",

            opened_at
              AS "openedAt",

            reminder_count
              AS "reminderCount",

            last_reminder_at
              AS "lastReminderAt",

            expires_at
              AS "expiresAt",

            created_at
              AS "createdAt",

            updated_at
              AS "updatedAt"
          `,
          [
            invitationId,
          ]
        );

      const sentInvitation =
        sentResult.rows[0];

      /*
       * On mémorise également
       * la dernière date d'envoi
       * côté participant.
       */
      await client.query(
        `
        UPDATE participants

        SET
          invited_at = NOW()

        WHERE
          id = $1
        `,
        [
          data.participant_id,
        ]
      );

      /*
       * Audit de la relance.
       *
       * L'id de l'invitation reste
       * identique car nous ne créons
       * plus une nouvelle ligne.
       */
      await client.query(
        `
        INSERT INTO audit_logs (
          actor_user_id,
          company_id,
          entity_type,
          entity_id,
          action,
          metadata
        )

        VALUES (
          $1,
          $2,
          'campaign',
          $3,
          'INVITATION_RESENT',
          $4::jsonb
        )
        `,
        [
          userId,
          companyId,
          campaignId,

          JSON.stringify({
            participantId:
              data.participant_id,

            invitationId:
              invitationId,

            reminderCount:
              sentInvitation
                .reminderCount,

            expiresAt:
              sentInvitation
                .expiresAt,
          }),
        ]
      );

      /*
       * Toutes les modifications
       * sont cohérentes :
       *
       * on valide la transaction.
       */
      await client.query(
        "COMMIT"
      );

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Invitation renvoyée avec succès",

          data: {
            participantId:
              data.participant_id,

            invitation: {
              id:
                sentInvitation.id,

              status:
                sentInvitation.status,

              sentAt:
                sentInvitation
                  .sentAt,

              reminderCount:
                sentInvitation
                  .reminderCount,

              lastReminderAt:
                sentInvitation
                  .lastReminderAt,

              expiresAt:
                sentInvitation
                  .expiresAt,
            },
          },
        });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {
        // transaction déjà terminée
      }

      console.error(
        "Erreur resendCampaignInvitation :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible de renvoyer l'invitation",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  resendCampaignInvitation,
};