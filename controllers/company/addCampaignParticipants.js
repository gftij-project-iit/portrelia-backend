const { db } = require("../../config/db");

const {
  addCampaignParticipantsSchema,
} = require(
  "../../dto/company/addCampaignParticipants.dto"
);

const {
  sendMail,
} = require("../../services/mailService");

const {
  participantInvitationEmail,
} = require(
  "../../templates/participantInvitationEmail"
);

const addCampaignParticipants =
  async (req, res) => {
    const client =
      await db.connect();

    try {
      const companyId =
        req.user.companyId;

      const userId =
        req.user.id;

      const campaignId =
        Number(req.params.id);

      if (!companyId) {
        return res.status(403).json({
          success: false,
          message:
            "Aucune entreprise associée à ce compte",
        });
      }

      if (
        !Number.isInteger(
          campaignId
        ) ||
        campaignId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Identifiant de campagne invalide",
        });
      }

      const {
        error,
        value,
      } =
        addCampaignParticipantsSchema
          .validate(
            req.body,
            {
              abortEarly: false,
              stripUnknown: true,
            }
          );

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            "Données invalides",

          errors:
            error.details.map(
              (detail) => ({
                field:
                  detail.path.join(
                    "."
                  ),

                message:
                  detail.message,
              })
            ),
        });
      }

      const normalizedParticipants =
        value.participants.map(
          (participant) => ({
            firstName:
              participant.firstName
                .trim(),

            lastName:
              participant.lastName
                .trim(),

            email:
              participant.email
                .trim()
                .toLowerCase(),

            jobTitle:
              participant.jobTitle
                ?.trim() ||
              null,
          })
        );

      const emails =
        normalizedParticipants.map(
          (participant) =>
            participant.email
        );

      if (
        new Set(emails).size !==
        emails.length
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Un même collaborateur apparaît plusieurs fois",
        });
      }

      await client.query(
        "BEGIN"
      );

      /*
       * Vérification campagne.
       */
      const campaignResult =
        await client.query(
          `
          SELECT
            c.id,
            c.name,
            c.status,
            c.deadline_at,
            co.name AS company_name

          FROM campaigns c

          INNER JOIN companies co
            ON co.id =
               c.company_id

          WHERE
            c.id = $1
            AND c.company_id = $2

          LIMIT 1
          FOR UPDATE
          `,
          [
            campaignId,
            companyId,
          ]
        );

      if (
        campaignResult.rows
          .length === 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          message:
            "Campagne introuvable",
        });
      }

      const campaign =
        campaignResult.rows[0];

      if (
        campaign.status ===
          "COMPLETED" ||
        campaign.status ===
          "CANCELLED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          success: false,
          message:
            "Cette campagne ne peut plus recevoir de nouveaux collaborateurs",
        });
      }

      /*
       * Recherche emails déjà présents.
       */
      const existingResult =
        await client.query(
          `
          SELECT
            email

          FROM participants

          WHERE
            campaign_id = $1
            AND LOWER(email) =
                ANY($2::text[])
          `,
          [
            campaignId,
            emails,
          ]
        );

      if (
        existingResult.rows
          .length > 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          success: false,

          message:
            "Certains collaborateurs sont déjà présents dans cette campagne",

          emails:
            existingResult.rows.map(
              (row) =>
                row.email
            ),
        });
      }

      const created = [];

      /*
       * Création participants
       * + invitations PENDING.
       */
      for (
        const participant
        of normalizedParticipants
      ) {
        const participantResult =
          await client.query(
            `
            INSERT INTO participants (
              campaign_id,
              first_name,
              last_name,
              email,
              job_title,
              status
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              'INVITED'
            )
            RETURNING
              id,
              campaign_id
                AS "campaignId",
              first_name
                AS "firstName",
              last_name
                AS "lastName",
              email,
              job_title
                AS "jobTitle",
              status,
              created_at
                AS "createdAt"
            `,
            [
              campaignId,
              participant.firstName,
              participant.lastName,
              participant.email,
              participant.jobTitle,
            ]
          );

        const createdParticipant =
          participantResult.rows[0];

        const invitationResult =
          await client.query(
            `
            INSERT INTO invitations (
              participant_id,
              status,
              expires_at
            )
            VALUES (
              $1,
              'PENDING',
              $2
            )
            RETURNING
              id,
              participant_id
                AS "participantId",
              token,
              status,
              expires_at
                AS "expiresAt"
            `,
            [
              createdParticipant.id,
              campaign.deadline_at,
            ]
          );

        created.push({
          participant:
            createdParticipant,

          invitation:
            invitationResult.rows[0],
        });
      }

      /*
       * Synchronisation du nombre
       * de participants.
       */
      await client.query(
        `
        UPDATE campaigns
        SET
          target_participant_count = (
            SELECT
              COUNT(*)::INTEGER
            FROM participants
            WHERE
              campaign_id = $1
          )
        WHERE
          id = $1
        `,
        [
          campaignId,
        ]
      );

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
          'PARTICIPANTS_ADDED',
          $4::jsonb
        )
        `,
        [
          userId,
          companyId,
          campaignId,

          JSON.stringify({
            participantCount:
              created.length,

            emails:
              created.map(
                (item) =>
                  item.participant
                    .email
              ),
          }),
        ]
      );

      await client.query(
        "COMMIT"
      );

      /*
       * Emails APRES COMMIT.
       *
       * Si Brevo tombe,
       * les collaborateurs restent
       * créés et leurs invitations
       * restent PENDING.
       */
      const emailResults = [];

      for (
        const item
        of created
      ) {
        try {
          const invitationUrl =
            `${process.env.FRONTEND_URL}/invitation?token=${item.invitation.token}`;

          const deadline =
            campaign.deadline_at
              ? new Intl.DateTimeFormat(
                  "fr-FR",
                  {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  }
                ).format(
                  new Date(
                    campaign.deadline_at
                  )
                )
              : null;

          await sendMail({
            to:
              item.participant
                .email,

            subject:
              `Invitation Portrélia — ${campaign.name}`,

            html:
              participantInvitationEmail({
                firstName:
                  item.participant
                    .firstName,

                campaignName:
                  campaign.name,

                companyName:
                  campaign.company_name,

                invitationUrl,

                deadline,
              }),
          });

          await db.query(
            `
            UPDATE invitations
            SET
              status = 'SENT',
              sent_at = NOW()
            WHERE
              id = $1
            `,
            [
              item.invitation.id,
            ]
          );

          await db.query(
            `
            UPDATE participants
            SET
              invited_at = NOW()
            WHERE
              id = $1
            `,
            [
              item.participant.id,
            ]
          );

          emailResults.push({
            participantId:
              item.participant.id,

            email:
              item.participant.email,

            sent:
              true,
          });
        } catch (error) {
          console.error(
            "Erreur email participant :",
            error
          );

          emailResults.push({
            participantId:
              item.participant.id,

            email:
              item.participant.email,

            sent:
              false,
          });
        }
      }

      return res
        .status(201)
        .json({
          success: true,

          message:
            "Collaborateurs ajoutés avec succès",

          data: {
            added:
              created.length,

            participants:
              created.map(
                (item) =>
                  item.participant
              ),

            emails:
              emailResults,
          },
        });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {
        // transaction terminée
      }

      if (
        error.code === "23505"
      ) {
        return res
          .status(409)
          .json({
            success: false,
            message:
              "Un collaborateur existe déjà dans cette campagne",
          });
      }

      console.error(
        "Erreur addCampaignParticipants :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Impossible d'ajouter les collaborateurs",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  addCampaignParticipants,
};