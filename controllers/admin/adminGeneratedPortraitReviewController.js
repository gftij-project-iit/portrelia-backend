const {
  db,
} = require("../../config/db");

/*
 * =========================================================
 * DECISIONS AUTORISÉES
 * =========================================================
 */

const DECISION_TO_STATUS = {
  APPROVE:
    "QA_APPROVED",

  REJECT:
    "QA_REJECTED",

  RETOUCH:
    "RETOUCH_REQUIRED",
};

/*
 * =========================================================
 * REVIEWER USER ID
 * =========================================================
 *
 * On reste souple par rapport
 * à ton middleware auth.
 *
 * Si aucun user ID exploitable :
 * reviewer_user_id restera NULL.
 */

const getReviewerUserId =
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

    const reviewerUserId =
      Number(
        possibleId
      );

    if (
      !Number.isInteger(
        reviewerUserId
      ) ||
      reviewerUserId <= 0
    ) {
      return null;
    }

    return reviewerUserId;
  };

/*
 * =========================================================
 * REVIEW GENERATED PORTRAIT
 * =========================================================
 *
 * PATCH
 *
 * /api/v1/admin/generated-portraits/:portraitId/review
 *
 * BODY :
 *
 * {
 *   decision: "APPROVE" | "REJECT" | "RETOUCH",
 *   notes: "..."
 * }
 *
 * IMPORTANT :
 *
 * REGENERATE n'est PAS géré ici.
 *
 * Il utilise :
 *
 * POST
 * /generated-portraits/:portraitId/regenerate
 */

const reviewGeneratedPortrait =
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
       * 1. PORTRAIT ID
       * =====================================================
       */

      const portraitId =
        Number(
          req.params
            .portraitId
        );

      if (
        !Number.isInteger(
          portraitId
        ) ||
        portraitId <= 0
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Portrait invalide.",
          });
      }

      /*
       * =====================================================
       * 2. BODY
       * =====================================================
       */

      const decision =
        String(
          req.body
            ?.decision ||
            ""
        )
          .trim()
          .toUpperCase();

      const notes =
        typeof req.body
          ?.notes ===
        "string"
          ? req.body
              .notes
              .trim() ||
            null
          : null;

      /*
       * =====================================================
       * 3. VALIDATION DECISION
       * =====================================================
       */

      if (
        decision ===
        "REGENERATE"
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Utilisez l'API dédiée de régénération pour cette action.",
          });
      }

      if (
        !Object.prototype
          .hasOwnProperty
          .call(
            DECISION_TO_STATUS,
            decision
          )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Décision QA invalide.",
          });
      }

      const newStatus =
        DECISION_TO_STATUS[
          decision
        ];

      const reviewerUserId =
        getReviewerUserId(
          req
        );

      console.log(
        "\n=========================================="
      );

      console.log(
        "[QA PORTRAIT][REVIEW] START"
      );

      console.log(
        "[QA PORTRAIT][REVIEW]",
        {
          portraitId,

          decision,

          newStatus,

          reviewerUserId,
        }
      );

      console.log(
        "==========================================\n"
      );

      /*
       * =====================================================
       * 4. BEGIN TRANSACTION
       * =====================================================
       */

      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      /*
       * =====================================================
       * 5. GET + LOCK PORTRAIT
       * =====================================================
       */

      const portraitResult =
        await client.query(
          `
          SELECT
            gp.id,

            gp.participant_id
              AS "participantId",

            gp.status,

            gp.is_gallery_visible
              AS "isGalleryVisible",

            gp.is_selected_by_participant
              AS "isSelectedByParticipant",

            p.status
              AS "participantStatus",

            p.campaign_id
              AS "campaignId",

            c.company_id
              AS "companyId"

          FROM generated_portraits gp

          JOIN participants p
            ON p.id =
              gp.participant_id

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          WHERE
            gp.id = $1

          FOR UPDATE
          `,
          [
            portraitId,
          ]
        );

      if (
        portraitResult
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
              "Portrait introuvable.",
          });
      }

      const portrait =
        portraitResult
          .rows[0];

      /*
       * =====================================================
       * 6. PARTICIPANT STATUS
       * =====================================================
       *
       * Le QA des portraits doit
       * être fait pendant QA_PENDING.
       */

      if (
        portrait.participantStatus !==
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
              `Le participant n'est pas en QA portraits (${portrait.participantStatus}).`,
          });
      }

      /*
       * =====================================================
       * 7. PORTRAIT STATUS
       * =====================================================
       */

      const allowedStatuses =
        [
          "GENERATED",
          "QA_PENDING",
          "QA_APPROVED",
          "QA_REJECTED",
          "RETOUCH_REQUIRED",
        ];

      if (
        !allowedStatuses.includes(
          portrait.status
        )
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
              `Ce portrait ne peut plus être contrôlé (${portrait.status}).`,
          });
      }

      /*
       * =====================================================
       * 8. INSERT QA REVIEW
       * =====================================================
       *
       * On garde tout l'historique.
       *
       * Exemple :
       *
       * APPROVE
       * REJECT
       * APPROVE
       *
       * => 3 lignes dans qa_reviews.
       */

      const reviewResult =
        await client.query(
          `
          INSERT INTO qa_reviews (
            portrait_id,
            reviewer_user_id,
            decision,
            notes
          )

          VALUES (
            $1,
            $2,
            $3,
            $4
          )

          RETURNING
            id,

            portrait_id
              AS "portraitId",

            reviewer_user_id
              AS "reviewerUserId",

            decision,

            notes,

            created_at
              AS "createdAt"
          `,
          [
            portraitId,

            reviewerUserId,

            decision,

            notes,
          ]
        );

      const review =
        reviewResult
          .rows[0];

      /*
       * =====================================================
       * 9. UPDATE GENERATED PORTRAIT
       * =====================================================
       *
       * APPROVE
       * → QA_APPROVED
       *
       * REJECT
       * → QA_REJECTED
       *
       * RETOUCH
       * → RETOUCH_REQUIRED
       *
       * On ne rend PAS encore visible
       * dans la galerie.
       *
       * Ça sera fait uniquement lors
       * du POST portraits-qa/complete.
       */

      const updateResult =
        await client.query(
          `
          UPDATE generated_portraits

          SET
            status =
              $2,

            is_gallery_visible =
              FALSE

          WHERE
            id = $1

          RETURNING
            id,

            participant_id
              AS "participantId",

            generation_job_id
              AS "generationJobId",

            storage_provider
              AS "storageProvider",

            storage_key
              AS "storageKey",

            status,

            is_gallery_visible
              AS "isGalleryVisible",

            is_selected_by_participant
              AS "isSelectedByParticipant",

            created_at
              AS "createdAt",

            updated_at
              AS "updatedAt"
          `,
          [
            portraitId,

            newStatus,
          ]
        );

      const updatedPortrait =
        updateResult
          .rows[0];

      /*
       * =====================================================
       * 10. AUDIT LOG
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
          'generated_portrait',
          $3,
          $4,
          $5::jsonb
        )
        `,
        [
          reviewerUserId,

          portrait.companyId,

          portraitId,

          `PORTRAIT_QA_${decision}`,

          JSON.stringify({
            portraitId,

            participantId:
              portrait.participantId,

            campaignId:
              portrait.campaignId,

            previousStatus:
              portrait.status,

            newStatus,

            decision,

            notes,
          }),
        ]
      );

      /*
       * =====================================================
       * 11. COMMIT
       * =====================================================
       */

      await client.query(
        "COMMIT"
      );

      transactionStarted =
        false;

      console.log(
        "[QA PORTRAIT][REVIEW] SUCCESS :",
        {
          portraitId,

          decision,

          status:
            newStatus,
        }
      );

      /*
       * =====================================================
       * 12. RESPONSE
       * =====================================================
       */

      return res
        .status(200)
        .json({
          success:
            true,

          message:
            decision ===
            "APPROVE"
              ? "Portrait approuvé."
              : decision ===
                "REJECT"
              ? "Portrait rejeté."
              : "Portrait envoyé en retouche.",

          data: {
            portrait:
              updatedPortrait,

            review,
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
            "[QA PORTRAIT][REVIEW] ROLLBACK ERROR :",
            rollbackError
          );
        }
      }

      console.error(
        "[QA PORTRAIT][REVIEW] ERROR :",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Impossible d'enregistrer la décision QA.",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  reviewGeneratedPortrait,
};