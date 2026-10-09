const { db } = require("../../config/db");

const getCampaignById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const campaignId = Number(req.params.id);

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message:
          "Aucune entreprise associée à ce compte",
      });
    }

    if (
      !Number.isInteger(campaignId) ||
      campaignId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Identifiant de campagne invalide",
      });
    }

    /*
     * 1. Campagne
     *
     * Important :
     * company_id est imposé depuis le JWT.
     * Une entreprise ne peut donc jamais
     * consulter la campagne d'une autre.
     */
    const campaignResult = await db.query(
      `
      SELECT
        c.id,
        c.company_id
          AS "companyId",
        c.created_by_user_id
          AS "createdByUserId",

        c.name,
        c.description,
        c.status,

        c.deadline_at
          AS "deadlineAt",

        c.target_delay_hours
          AS "targetDelayHours",

        c.target_participant_count
          AS "targetParticipantCount",

        c.is_pilot
          AS "isPilot",

        c.completed_at
          AS "completedAt",

        c.created_at
          AS "createdAt",

        c.updated_at
          AS "updatedAt",

        ps.id
          AS "styleId",

        ps.name
          AS "styleName",

        ps.slug
          AS "styleSlug",

        ps.description
          AS "styleDescription",

        ps.preview_image_url
          AS "stylePreviewImageUrl"

      FROM campaigns c

      LEFT JOIN portrait_styles ps
        ON ps.id = c.style_id

      WHERE
        c.id = $1
        AND c.company_id = $2

      LIMIT 1
      `,
      [
        campaignId,
        companyId,
      ]
    );

    if (
      campaignResult.rows.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Campagne introuvable",
      });
    }

    const campaign =
      campaignResult.rows[0];

    /*
     * 2. Statistiques générales
     */
    const statsResult = await db.query(
      `
      SELECT
        COUNT(
          DISTINCT p.id
        )::INTEGER
          AS participants,

        COUNT(
          DISTINCT p.id
        ) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM input_photos ip
            WHERE
              ip.participant_id = p.id
          )
        )::INTEGER
          AS "photosReceived",

        COUNT(
          DISTINCT p.id
        ) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM galleries g
            WHERE
              g.participant_id = p.id
              AND g.published_at
                  IS NOT NULL
          )
        )::INTEGER
          AS "galleriesReady",

        COUNT(
          DISTINCT p.id
        ) FILTER (
          WHERE
            p.validated_at
            IS NOT NULL
        )::INTEGER
          AS validated,

        COUNT(
          DISTINCT p.id
        ) FILTER (
          WHERE
            p.delivered_at
            IS NOT NULL
        )::INTEGER
          AS delivered

      FROM participants p

      WHERE
        p.campaign_id = $1
      `,
      [
        campaignId,
      ]
    );

    const stats =
      statsResult.rows[0];

    const participantsCount =
      Number(
        stats.participants || 0
      );

    const validatedCount =
      Number(
        stats.validated || 0
      );

    const progress =
      participantsCount === 0
        ? 0
        : Math.round(
            (
              validatedCount /
              participantsCount
            ) * 100
          );

    /*
     * 3. Collaborateurs
     *
     * LATERAL permet de récupérer
     * uniquement la dernière invitation.
     *
     * On ne renvoie volontairement PAS
     * le token d'invitation.
     */
    const participantsResult =
      await db.query(
        `
        SELECT
          p.id,

          p.first_name
            AS "firstName",

          p.last_name
            AS "lastName",

          p.email,

          p.job_title
            AS "jobTitle",

          p.status,

          p.invited_at
            AS "invitedAt",

          p.photos_received_at
            AS "photosReceivedAt",

          p.gallery_ready_at
            AS "galleryReadyAt",

          p.validated_at
            AS "validatedAt",

          p.delivered_at
            AS "deliveredAt",

          p.created_at
            AS "createdAt",

          (
            SELECT
              COUNT(*)::INTEGER
            FROM input_photos ip
            WHERE
              ip.participant_id = p.id
          ) AS "photoCount",

          (
            SELECT
              COUNT(*)::INTEGER
            FROM input_photos ip
            WHERE
              ip.participant_id = p.id
              AND ip.status = 'ACCEPTED'
          ) AS "acceptedPhotoCount",

          (
            SELECT
              COUNT(*)::INTEGER
            FROM input_photos ip
            WHERE
              ip.participant_id = p.id
              AND ip.status = 'REJECTED'
          ) AS "rejectedPhotoCount",

          li.id
            AS "invitationId",

          li.status
            AS "invitationStatus",

          li.expires_at
            AS "invitationExpiresAt",

          li.sent_at
            AS "invitationSentAt",

          li.opened_at
            AS "invitationOpenedAt",

          li.reminder_count
            AS "invitationReminderCount",

          li.last_reminder_at
            AS "invitationLastReminderAt",

          g.id
            AS "galleryId",

          g.published_at
            AS "galleryPublishedAt",

          g.expires_at
            AS "galleryExpiresAt"

        FROM participants p

        LEFT JOIN LATERAL (
          SELECT
            i.id,
            i.status,
            i.expires_at,
            i.sent_at,
            i.opened_at,
            i.reminder_count,
            i.last_reminder_at
          FROM invitations i
          WHERE
            i.participant_id = p.id
          ORDER BY
            i.created_at DESC
          LIMIT 1
        ) li
          ON TRUE

        LEFT JOIN galleries g
          ON g.participant_id = p.id

        WHERE
          p.campaign_id = $1

        ORDER BY
          p.created_at ASC,
          p.id ASC
        `,
        [
          campaignId,
        ]
      );

    /*
     * 4. Points d'attention
     */
    const attentionResult =
      await db.query(
        `
        WITH latest_invitations AS (
          SELECT DISTINCT ON (
            i.participant_id
          )
            i.participant_id,
            i.status,
            i.expires_at,
            i.sent_at,
            i.opened_at

          FROM invitations i

          INNER JOIN participants p
            ON p.id = i.participant_id

          WHERE
            p.campaign_id = $1

          ORDER BY
            i.participant_id,
            i.created_at DESC
        )

        SELECT

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE NOT EXISTS (
              SELECT 1
              FROM input_photos ip
              WHERE
                ip.participant_id = p.id
            )
          )::INTEGER
            AS "withoutPhotos",

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE
              li.sent_at IS NOT NULL
              AND li.opened_at IS NULL
              AND li.status IN (
                'SENT',
                'PENDING'
              )
          )::INTEGER
            AS "invitationsNotOpened",

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE
              li.opened_at IS NULL
              AND (
                li.status = 'EXPIRED'
                OR (
                  li.expires_at
                    IS NOT NULL
                  AND li.expires_at
                    < NOW()
                )
              )
          )::INTEGER
            AS "expiredInvitations",

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE
              p.status =
                'REVISION_REQUESTED'
          )::INTEGER
            AS "revisionRequested",

          COUNT(
            DISTINCT p.id
          ) FILTER (
            WHERE EXISTS (
              SELECT 1
              FROM input_photos ip
              WHERE
                ip.participant_id = p.id
                AND ip.status =
                    'REJECTED'
            )
          )::INTEGER
            AS "photosToRedo"

        FROM participants p

        LEFT JOIN latest_invitations li
          ON li.participant_id = p.id

        WHERE
          p.campaign_id = $1
        `,
        [
          campaignId,
        ]
      );

    /*
     * 5. Activité disponible
     * dans audit_logs.
     */
    const activityResult =
      await db.query(
        `
        SELECT
          al.id,
          al.action,
          al.metadata,

          al.created_at
            AS "createdAt",

          u.first_name
            AS "actorFirstName",

          u.last_name
            AS "actorLastName"

        FROM audit_logs al

        LEFT JOIN users u
          ON u.id =
             al.actor_user_id

        WHERE
          al.company_id = $1
          AND al.entity_type =
              'campaign'
          AND al.entity_id = $2

        ORDER BY
          al.created_at DESC

        LIMIT 20
        `,
        [
          companyId,
          campaignId,
        ]
      );

    return res.status(200).json({
      success: true,

      data: {
        campaign: {
          id:
            campaign.id,

          companyId:
            campaign.companyId,

          createdByUserId:
            campaign.createdByUserId,

          name:
            campaign.name,

          description:
            campaign.description,

          status:
            campaign.status,

          deadlineAt:
            campaign.deadlineAt,

          targetDelayHours:
            campaign.targetDelayHours,

          targetParticipantCount:
            campaign.targetParticipantCount,

          isPilot:
            campaign.isPilot,

          completedAt:
            campaign.completedAt,

          createdAt:
            campaign.createdAt,

          updatedAt:
            campaign.updatedAt,

          style: campaign.styleId
            ? {
                id:
                  campaign.styleId,

                name:
                  campaign.styleName,

                slug:
                  campaign.styleSlug,

                description:
                  campaign.styleDescription,

                previewImageUrl:
                  campaign.stylePreviewImageUrl,
              }
            : null,
        },

        stats: {
          participants:
            participantsCount,

          photosReceived:
            Number(
              stats.photosReceived ||
                0
            ),

          galleriesReady:
            Number(
              stats.galleriesReady ||
                0
            ),

          validated:
            validatedCount,

          delivered:
            Number(
              stats.delivered ||
                0
            ),

          progress,
        },

        attention: {
          withoutPhotos:
            Number(
              attentionResult
                .rows[0]
                ?.withoutPhotos ||
                0
            ),

          invitationsNotOpened:
            Number(
              attentionResult
                .rows[0]
                ?.invitationsNotOpened ||
                0
            ),

          expiredInvitations:
            Number(
              attentionResult
                .rows[0]
                ?.expiredInvitations ||
                0
            ),

          revisionRequested:
            Number(
              attentionResult
                .rows[0]
                ?.revisionRequested ||
                0
            ),

          photosToRedo:
            Number(
              attentionResult
                .rows[0]
                ?.photosToRedo ||
                0
            ),
        },

        participants:
          participantsResult.rows,

        activity:
          activityResult.rows,
      },
    });
  } catch (error) {
    console.error(
      "Erreur getCampaignById :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de récupérer la campagne",
    });
  }
};

module.exports = {
  getCampaignById,
};