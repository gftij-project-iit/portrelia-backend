const { db } = require("../../config/db");

const {
  createCampaignSchema,
} = require("../../dto/company/createCampaign.dto");

const {
  sendMail,
} = require("../../services/mailService");

const {
  participantInvitationEmail,
} = require("../../templates/participantInvitationEmail");

const createCampaign = async (req, res) => {
  const client = await db.connect();

  try {
    const { error, value } =
      createCampaignSchema.validate(
        req.body,
        {
          abortEarly: false,
          stripUnknown: true,
        }
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        errors: error.details.map(
          (detail) => ({
            field:
              detail.path.join("."),
            message:
              detail.message,
          })
        ),
      });
    }

    const companyId =
      req.user.companyId;

    const userId =
      req.user.id;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message:
          "Aucune entreprise associée à ce compte",
      });
    }

    const {
      name,
      description,
      deadline,
      targetDelay,
      portraitStyle,
      participants,
    } = value;

    /*
     * Vérification doublons email
     * dans la même campagne.
     */
    const normalizedParticipants =
      participants.map(
        (participant) => ({
          firstName:
            participant.firstName.trim(),

          lastName:
            participant.lastName.trim(),

          email:
            participant.email
              .trim()
              .toLowerCase(),
        })
      );

    const emails =
      normalizedParticipants.map(
        (participant) =>
          participant.email
      );

    const uniqueEmails =
      new Set(emails);

    if (
      uniqueEmails.size !==
      emails.length
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Un même collaborateur ne peut pas être ajouté plusieurs fois à la campagne",
      });
    }

    /*
     * Mapping entre les valeurs du front
     * et les styles présents en base.
     */
    const styleSlugMap = {
      MODERN_OFFICE:
        "moderne",

      LIGHT_STUDIO:
        "studio-neutre",

      EXECUTIVE:
        "executive",

      LINKEDIN:
        "corporate-clair",
    };

    const styleSlug =
      styleSlugMap[
        portraitStyle
      ];

    if (!styleSlug) {
      return res.status(400).json({
        success: false,
        message:
          "Style de portrait invalide",
      });
    }

    await client.query("BEGIN");

    /*
     * Vérifie que l'entreprise existe
     * et qu'elle est active.
     *
     * On récupère également son nom
     * pour le template de l'email.
     */
    const companyResult =
      await client.query(
        `
        SELECT
          id,
          name,
          status

        FROM companies

        WHERE
          id = $1

        LIMIT 1

        FOR SHARE
        `,
        [
          companyId,
        ]
      );

    if (
      companyResult.rows.length ===
      0
    ) {
      await client.query(
        "ROLLBACK"
      );

      return res.status(404).json({
        success: false,
        message:
          "Entreprise introuvable",
      });
    }

    const company =
      companyResult.rows[0];

    if (
      company.status !==
      "ACTIVE"
    ) {
      await client.query(
        "ROLLBACK"
      );

      return res.status(403).json({
        success: false,
        message:
          "Cette entreprise ne peut pas créer de campagne actuellement",
      });
    }

    /*
     * Récupération du style réel.
     */
    const styleResult =
      await client.query(
        `
        SELECT
          id,
          name,
          slug

        FROM portrait_styles

        WHERE
          slug = $1
          AND is_active = TRUE

        LIMIT 1
        `,
        [
          styleSlug,
        ]
      );

    if (
      styleResult.rows.length ===
      0
    ) {
      await client.query(
        "ROLLBACK"
      );

      return res.status(400).json({
        success: false,
        message:
          "Le style de portrait sélectionné n'est pas disponible",
      });
    }

    const style =
      styleResult.rows[0];

    /*
     * Création de la campagne.
     */
    const campaignResult =
      await client.query(
        `
        INSERT INTO campaigns (
          company_id,
          created_by_user_id,
          style_id,
          name,
          description,
          status,
          deadline_at,
          target_delay_hours,
          target_participant_count
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'DRAFT',
          $6,
          $7,
          $8
        )
        RETURNING
          id,
          company_id
            AS "companyId",
          created_by_user_id
            AS "createdByUserId",
          style_id
            AS "styleId",
          name,
          description,
          status,
          deadline_at
            AS "deadlineAt",
          target_delay_hours
            AS "targetDelayHours",
          target_participant_count
            AS "targetParticipantCount",
          created_at
            AS "createdAt",
          updated_at
            AS "updatedAt"
        `,
        [
          companyId,
          userId,
          style.id,
          name,
          description || null,
          deadline,
          targetDelay,
          normalizedParticipants.length,
        ]
      );

    const campaign =
      campaignResult.rows[0];

    /*
     * Création des participants
     * et de leurs invitations.
     *
     * Le token UUID est généré
     * automatiquement par PostgreSQL.
     */
    const createdParticipants =
      [];

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
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
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
            status,
            invited_at
              AS "invitedAt",
            created_at
              AS "createdAt"
          `,
          [
            campaign.id,
            participant.firstName,
            participant.lastName,
            participant.email,
          ]
        );

      const createdParticipant =
        participantResult.rows[0];

      /*
       * L'invitation est d'abord créée
       * en PENDING.
       *
       * Si l'envoi Brevo réussit après
       * le COMMIT, elle passera à SENT.
       */
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
              AS "expiresAt",
            created_at
              AS "createdAt"
          `,
          [
            createdParticipant.id,
            deadline,
          ]
        );

      createdParticipants.push({
        ...createdParticipant,

        invitation:
          invitationResult.rows[0],
      });
    }

    /*
     * Audit de création.
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
        'CAMPAIGN_CREATED',
        $4::jsonb
      )
      `,
      [
        userId,
        companyId,
        campaign.id,

        JSON.stringify({
          participantCount:
            normalizedParticipants.length,

          styleId:
            style.id,

          styleSlug:
            style.slug,

          deadline,

          targetDelay,
        }),
      ]
    );

    /*
     * La campagne, les participants
     * et les invitations sont sécurisés
     * en base avant l'envoi des emails.
     */
    await client.query("COMMIT");

    /*
     * Envoi automatique des invitations.
     *
     * IMPORTANT :
     * l'envoi se fait après le COMMIT.
     *
     * Si Brevo rencontre un problème,
     * la campagne n'est pas perdue.
     * L'invitation reste simplement
     * en PENDING et pourra être relancée.
     */
    const emailResults = [];

    for (
      const participant
      of createdParticipants
    ) {
      try {
        const invitationUrl =
          `${process.env.FRONTEND_URL}/invitation?token=${participant.invitation.token}`;

        const deadlineLabel =
          deadline
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
                    deadline
                  )
                )
            : null;

        /*
         * Envoi Brevo.
         */
        await sendMail({
          to:
            participant.email,

          subject:
            `Invitation Portrélia — ${campaign.name}`,

          html:
            participantInvitationEmail({
              firstName:
                participant.firstName,

              campaignName:
                campaign.name,

              companyName:
                company.name,

              invitationUrl,

              deadline:
                deadlineLabel,
            }),
        });

        /*
         * L'email a bien été envoyé :
         * l'invitation passe à SENT.
         */
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
            participant
              .invitation.id,
          ]
        );

        /*
         * On mémorise également
         * la date d'invitation
         * côté participant.
         */
        await db.query(
          `
          UPDATE participants

          SET
            invited_at = NOW()

          WHERE
            id = $1
          `,
          [
            participant.id,
          ]
        );

        emailResults.push({
          participantId:
            participant.id,

          email:
            participant.email,

          sent:
            true,
        });
      } catch (emailError) {
        /*
         * Une erreur email ne doit jamais
         * annuler la création de la campagne.
         *
         * L'invitation reste en PENDING
         * et pourra ensuite être relancée.
         */
        console.error(
          "Erreur envoi invitation :",
          participant.email,
          emailError
        );

        emailResults.push({
          participantId:
            participant.id,

          email:
            participant.email,

          sent:
            false,
        });
      }
    }

    /*
     * Résumé de l'envoi.
     */
    const emailsSent =
      emailResults.filter(
        (item) =>
          item.sent
      ).length;

    const emailsFailed =
      emailResults.filter(
        (item) =>
          !item.sent
      ).length;

    return res.status(201).json({
      success: true,

      message:
        emailsFailed === 0
          ? "Campagne créée et invitations envoyées avec succès"
          : "Campagne créée, mais certaines invitations n'ont pas pu être envoyées",

      data: {
        campaign: {
          ...campaign,

          style: {
            id:
              style.id,

            name:
              style.name,

            slug:
              style.slug,
          },
        },

        participants:
          createdParticipants.map(
            (participant) => ({
              id:
                participant.id,

              campaignId:
                participant
                  .campaignId,

              firstName:
                participant
                  .firstName,

              lastName:
                participant
                  .lastName,

              email:
                participant.email,

              status:
                participant.status,

              invitedAt:
                participant
                  .invitedAt,

              invitation: {
                id:
                  participant
                    .invitation.id,

                status:
                  emailResults.find(
                    (result) =>
                      result
                        .participantId ===
                      participant.id
                  )?.sent
                    ? "SENT"
                    : "PENDING",

                expiresAt:
                  participant
                    .invitation
                    .expiresAt,
              },
            })
          ),

        emails: {
          total:
            emailResults.length,

          sent:
            emailsSent,

          failed:
            emailsFailed,

          results:
            emailResults,
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

    /*
     * Sécurité supplémentaire si jamais
     * la contrainte UNIQUE campaign/email
     * est déclenchée.
     */
    if (
      error.code ===
      "23505"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Un collaborateur avec cette adresse email existe déjà dans cette campagne",
      });
    }

    console.error(
      "Erreur createCampaign :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de créer la campagne",
    });
  } finally {
    client.release();
  }
};

module.exports = {
  createCampaign,
};