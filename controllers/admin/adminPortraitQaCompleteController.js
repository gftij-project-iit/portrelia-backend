const {
  db,
} = require("../../config/db");

const {
  sendMail,
} = require("../../services/mailService");

const {
  participantGalleryReadyEmail,
} = require(
  "../../templates/participantGalleryReadyEmail"
);

/*
 * =========================================================
 * CONFIG
 * =========================================================
 */

const GALLERY_EXPIRATION_DAYS =
  30;

/*
 * =========================================================
 * REVIEWER ID
 * =========================================================
 */

const getActorUserId =
  (req) => {
    const possibleId =
      req.user?.id ??
      req.auth?.userId ??
      req.userId ??
      null;

    if (
      possibleId ===
      null ||
      possibleId ===
      undefined
    ) {
      return null;
    }

    const id =
      Number(
        possibleId
      );

    return Number.isInteger(
      id
    ) &&
      id > 0
      ? id
      : null;
  };

/*
 * =========================================================
 * DATE LABEL
 * =========================================================
 */

const formatFrenchDate =
  (value) => {
    if (
      !value
    ) {
      return "";
    }

    try {
      return new Intl
        .DateTimeFormat(
          "fr-FR",
          {
            day:
              "2-digit",

            month:
              "long",

            year:
              "numeric",
          }
        )
        .format(
          new Date(
            value
          )
        );
    } catch (
      error
    ) {
      return "";
    }
  };

/*
 * =========================================================
 * COMPLETE PORTRAIT QA
 * =========================================================
 *
 * POST
 *
 * /api/v1/admin/participants/:participantId/portraits-qa/complete
 *
 * Cette API :
 *
 * 1. vérifie le participant
 * 2. vérifie qu'il est QA_PENDING
 * 3. bloque si portraits non contrôlés
 * 4. exige minimum 1 QA_APPROVED
 * 5. crée / republie la galerie
 * 6. ajoute uniquement les APPROVED
 * 7. masque tous les autres portraits
 * 8. passe les APPROVED à PUBLISHED
 * 9. passe participant à GALLERY_READY
 * 10. COMMIT
 * 11. envoie le mail après COMMIT
 */

const completePortraitQa =
  async (
    req,
    res
  ) => {
    const client =
      await db.connect();

    let transactionStarted =
      false;

    try {
      /*
       * =====================================================
       * 1. PARTICIPANT ID
       * =====================================================
       */

      const participantId =
        Number(
          req.params
            .participantId
        );

      if (
        !Number.isInteger(
          participantId
        ) ||
        participantId <=
          0
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Participant invalide.",
          });
      }

      const actorUserId =
        getActorUserId(
          req
        );

      console.log(
        "\n=========================================="
      );

      console.log(
        "[PORTRAITS QA COMPLETE] START"
      );

      console.log(
        "[PORTRAITS QA COMPLETE]",
        {
          participantId,

          actorUserId,
        }
      );

      console.log(
        "==========================================\n"
      );

      /*
       * =====================================================
       * 2. BEGIN
       * =====================================================
       */

      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      /*
       * =====================================================
       * 3. PARTICIPANT
       * =====================================================
       */

      const participantResult =
        await client.query(
          `
          SELECT
            p.id,

            p.first_name
              AS "firstName",

            p.last_name
              AS "lastName",

            p.email,

            p.status,

            p.campaign_id
              AS "campaignId",

            c.name
              AS "campaignName",

            c.company_id
              AS "companyId",

            co.name
              AS "companyName"

          FROM participants p

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          JOIN companies co
            ON co.id =
              c.company_id

          WHERE
            p.id = $1

          FOR UPDATE
          `,
          [
            participantId,
          ]
        );

      if (
        participantResult
          .rows.length ===
        0
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Participant introuvable.",
          });
      }

      const participant =
        participantResult
          .rows[0];

      /*
       * =====================================================
       * 4. STATUS PARTICIPANT
       * =====================================================
       */

      if (
        participant.status !==
        "QA_PENDING"
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success:
              false,

            message:
              `Le participant n'est pas en attente de validation QA (${participant.status}).`,
          });
      }

      /*
       * =====================================================
       * 5. PORTRAITS ACTIFS
       * =====================================================
       *
       * On ignore les anciennes versions
       * ayant une qa_review REGENERATE.
       */

      const portraitsResult =
        await client.query(
          `
          SELECT
            gp.id,

            gp.status

          FROM generated_portraits gp

          WHERE
            gp.participant_id =
              $1

            AND NOT EXISTS (
              SELECT
                1

              FROM qa_reviews qr

              WHERE
                qr.portrait_id =
                  gp.id

                AND qr.decision =
                  'REGENERATE'
            )

          ORDER BY
            gp.created_at ASC,
            gp.id ASC

          FOR UPDATE
          `,
          [
            participantId,
          ]
        );

      const portraits =
        portraitsResult
          .rows;

      if (
        portraits.length ===
        0
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success:
              false,

            message:
              "Aucun portrait disponible pour la publication.",
          });
      }

      /*
       * =====================================================
       * 6. UNRESOLVED PORTRAITS
       * =====================================================
       *
       * Tant qu'un portrait est :
       *
       * GENERATED
       * QA_PENDING
       * RETOUCH_REQUIRED
       *
       * on interdit la publication.
       */

      const unresolvedPortraits =
        portraits.filter(
          (
            portrait
          ) =>
            [
              "GENERATED",
              "QA_PENDING",
              "RETOUCH_REQUIRED",
            ].includes(
              portrait.status
            )
        );

      if (
        unresolvedPortraits
          .length >
        0
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success:
              false,

            message:
              `${unresolvedPortraits.length} portrait(s) doivent encore être contrôlés avant publication.`,
          });
      }

      /*
       * =====================================================
       * 7. APPROVED
       * =====================================================
       */

      const approvedPortraits =
        portraits.filter(
          (
            portrait
          ) =>
            portrait.status ===
            "QA_APPROVED"
        );

      if (
        approvedPortraits
          .length ===
        0
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success:
              false,

            message:
              "Au moins un portrait doit être approuvé avant de publier la galerie.",
          });
      }

      /*
       * =====================================================
       * 8. MASQUER TOUS LES PORTRAITS
       * =====================================================
       *
       * Sécurité importante :
       *
       * QA_REJECTED
       * => jamais envoyé au participant.
       */

      await client.query(
        `
        UPDATE generated_portraits

        SET
          is_gallery_visible =
            FALSE

        WHERE
          participant_id =
            $1
        `,
        [
          participantId,
        ]
      );

      /*
       * =====================================================
       * 9. GALLERY
       * =====================================================
       *
       * Une seule galerie par participant.
       *
       * Si elle existe :
       * on conserve le même public_token
       * mais on renouvelle la publication
       * et l'expiration.
       */

      const galleryResult =
        await client.query(
          `
          INSERT INTO galleries (
            participant_id,
            published_at,
            expires_at
          )

          VALUES (
            $1,
            NOW(),
            NOW() +
              ($2 * INTERVAL '1 day')
          )

          ON CONFLICT (
            participant_id
          )

          DO UPDATE

          SET
            published_at =
              NOW(),

            expires_at =
              NOW() +
              ($2 * INTERVAL '1 day')

          RETURNING
            id,

            participant_id
              AS "participantId",

            public_token
              AS "publicToken",

            published_at
              AS "publishedAt",

            expires_at
              AS "expiresAt"
          `,
          [
            participantId,

            GALLERY_EXPIRATION_DAYS,
          ]
        );

      const gallery =
        galleryResult
          .rows[0];

      /*
       * =====================================================
       * 10. RESET GALLERY PORTRAITS
       * =====================================================
       */

      await client.query(
        `
        DELETE FROM
          gallery_portraits

        WHERE
          gallery_id =
            $1
        `,
        [
          gallery.id,
        ]
      );

      /*
       * =====================================================
       * 11. INSERT APPROVED PORTRAITS ONLY
       * =====================================================
       */

      for (
        let index = 0;
        index <
        approvedPortraits.length;
        index += 1
      ) {
        const portrait =
          approvedPortraits[
            index
          ];

        await client.query(
          `
          INSERT INTO
            gallery_portraits (
              gallery_id,
              portrait_id,
              sort_order
            )

          VALUES (
            $1,
            $2,
            $3
          )
          `,
          [
            gallery.id,

            portrait.id,

            index,
          ]
        );
      }

      /*
       * =====================================================
       * 12. PUBLISH APPROVED PORTRAITS
       * =====================================================
       */

      const approvedIds =
        approvedPortraits
          .map(
            (
              portrait
            ) =>
              portrait.id
          );

      await client.query(
        `
        UPDATE generated_portraits

        SET
          status =
            'PUBLISHED',

          is_gallery_visible =
            TRUE

        WHERE
          participant_id =
            $1

          AND id =
            ANY(
              $2::bigint[]
            )
        `,
        [
          participantId,

          approvedIds,
        ]
      );

      /*
       * =====================================================
       * 13. PARTICIPANT → GALLERY_READY
       * =====================================================
       */

      await client.query(
        `
        UPDATE participants

        SET
          status =
            'GALLERY_READY'

        WHERE
          id =
            $1
        `,
        [
          participantId,
        ]
      );

      /*
       * =====================================================
       * 14. AUDIT
       * =====================================================
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
          'gallery',
          $3,
          'PARTICIPANT_GALLERY_PUBLISHED',
          $4::jsonb
        )
        `,
        [
          actorUserId,

          participant.companyId,

          gallery.id,

          JSON.stringify({
            participantId,

            campaignId:
              participant.campaignId,

            approvedPortraitIds:
              approvedIds,

            approvedCount:
              approvedPortraits
                .length,

            expirationDays:
              GALLERY_EXPIRATION_DAYS,

            expiresAt:
              gallery.expiresAt,
          }),
        ]
      );

      /*
       * =====================================================
       * 15. COMMIT
       * =====================================================
       *
       * IMPORTANT :
       *
       * La galerie est sécurisée
       * en BDD AVANT l'envoi email.
       */

      await client.query(
        "COMMIT"
      );

      transactionStarted =
        false;

      /*
       * =====================================================
       * 16. GALLERY URL
       * =====================================================
       */

      const frontendUrl =
        String(
          process.env
            .FRONTEND_URL ||
            ""
        )
          .trim()
          .replace(
            /\/+$/,
            ""
          );

      const galleryUrl =
        `${frontendUrl}/gallery/${gallery.publicToken}`;

      /*
       * =====================================================
       * 17. SEND EMAIL
       * =====================================================
       *
       * Si Brevo échoue :
       *
       * la galerie RESTE publiée.
       */

      let emailSent =
        false;

      let emailError =
        null;

      try {
        await sendMail({
          to:
            participant.email,

          subject:
            "Vos portraits Portrélia sont prêts",

          html:
            participantGalleryReadyEmail({
              firstName:
                participant.firstName,

              galleryUrl,

              expiresAtLabel:
                formatFrenchDate(
                  gallery.expiresAt
                ),
            }),
        });

        emailSent =
          true;

        console.log(
          "[PORTRAITS QA COMPLETE] EMAIL SENT :",
          participant.email
        );
      } catch (
        mailError
      ) {
        emailError =
          mailError
            ?.message ||
          "Erreur email inconnue";

        console.error(
          "[PORTRAITS QA COMPLETE] EMAIL ERROR :",
          mailError
        );
      }

      /*
       * =====================================================
       * 18. SUCCESS
       * =====================================================
       */

      console.log(
        "[PORTRAITS QA COMPLETE] SUCCESS :",
        {
          participantId,

          galleryId:
            gallery.id,

          portraitCount:
            approvedPortraits
              .length,

          emailSent,
        }
      );

      return res
        .status(200)
        .json({
          success:
            true,

          message:
            emailSent
              ? "Galerie publiée et email envoyé au participant."
              : "Galerie publiée, mais l'email n'a pas pu être envoyé.",

          data: {
            participant: {
              id:
                participant.id,

              status:
                "GALLERY_READY",
            },

            gallery: {
              id:
                gallery.id,

              publicToken:
                gallery.publicToken,

              publishedAt:
                gallery.publishedAt,

              expiresAt:
                gallery.expiresAt,

              url:
                galleryUrl,
            },

            publishedPortraits:
              approvedIds,

            portraitCount:
              approvedPortraits
                .length,

            email: {
              sent:
                emailSent,

              error:
                emailSent
                  ? null
                  : emailError,
            },
          },
        });
    } catch (
      error
    ) {
      /*
       * =====================================================
       * ROLLBACK
       * =====================================================
       */

      if (
        transactionStarted
      ) {
        try {
          await client.query(
            "ROLLBACK"
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "[PORTRAITS QA COMPLETE] ROLLBACK ERROR :",
            rollbackError
          );
        }
      }

      console.error(
        "[PORTRAITS QA COMPLETE] ERROR :",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Impossible de publier la galerie participant.",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  completePortraitQa,
};