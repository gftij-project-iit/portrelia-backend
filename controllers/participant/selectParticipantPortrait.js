const {
  db,
} = require("../../config/db");

/*
 * =========================================================
 * SELECT FINAL PORTRAIT
 * =========================================================
 *
 * POST
 * /api/v1/participant/gallery/:token/select
 *
 * BODY :
 *
 * {
 *   portraitId: 123
 * }
 *
 * Une fois le portrait confirmé :
 *
 * participant -> VALIDATED
 *
 * Ensuite aucune nouvelle sélection
 * n'est autorisée.
 */

const selectParticipantPortrait =
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
       * 1. TOKEN
       * =====================================================
       */

      const token =
        String(
          req.params
            ?.token ||
            ""
        )
          .trim();

      if (
        !token
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Lien de galerie manquant.",
          });
      }

      /*
       * =====================================================
       * 2. PORTRAIT ID
       * =====================================================
       */

      const portraitId =
        Number(
          req.body
            ?.portraitId
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
            success: false,

            message:
              "Portrait invalide.",
          });
      }

      console.log(
        "\n=========================================="
      );

      console.log(
        "[PARTICIPANT GALLERY][SELECT] START"
      );

      console.log(
        "[PARTICIPANT GALLERY][SELECT]",
        {
          portraitId,
        }
      );

      console.log(
        "==========================================\n"
      );

      /*
       * =====================================================
       * 3. BEGIN
       * =====================================================
       */

      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      /*
       * =====================================================
       * 4. GALLERY
       * =====================================================
       */

      const galleryResult =
        await client.query(
          `
          SELECT
            g.id,

            g.participant_id
              AS "participantId",

            g.public_token
              AS "publicToken",

            g.published_at
              AS "publishedAt",

            g.expires_at
              AS "expiresAt",

            p.status
              AS "participantStatus",

            p.campaign_id
              AS "campaignId",

            c.company_id
              AS "companyId"

          FROM galleries g

          JOIN participants p
            ON p.id =
              g.participant_id

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          WHERE
            g.public_token::text =
              $1

          LIMIT 1

          FOR UPDATE
          `,
          [
            token,
          ]
        );

      if (
        galleryResult
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
            success: false,

            message:
              "Galerie introuvable.",
          });
      }

      const gallery =
        galleryResult
          .rows[0];

      /*
       * =====================================================
       * 5. PUBLISHED
       * =====================================================
       */

      if (
        !gallery
          .publishedAt
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              "Cette galerie n'est pas encore publiée.",
          });
      }

      /*
       * =====================================================
       * 6. EXPIRATION
       * =====================================================
       */

      if (
        gallery
          .expiresAt &&
        new Date(
          gallery
            .expiresAt
        ).getTime() <=
          Date.now()
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(410)
          .json({
            success: false,

            message:
              "Cette galerie a expiré.",
          });
      }

      /*
       * =====================================================
       * 7. STATUS
       * =====================================================
       *
       * IMPORTANT :
       *
       * sélection possible uniquement
       * quand le participant est GALLERY_READY.
       */

      if (
        gallery
          .participantStatus ===
        "VALIDATED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              "Votre portrait final a déjà été confirmé.",
          });
      }

      if (
        gallery
          .participantStatus !==
        "GALLERY_READY"
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              "La sélection n'est plus disponible.",
          });
      }

      /*
       * =====================================================
       * 8. PORTRAIT
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
              AS "isSelectedByParticipant"

          FROM gallery_portraits gpx

          JOIN generated_portraits gp
            ON gp.id =
              gpx.portrait_id

          WHERE
            gpx.gallery_id =
              $1

            AND gp.id =
              $2

            AND gp.participant_id =
              $3

          FOR UPDATE
          `,
          [
            gallery.id,

            portraitId,

            gallery
              .participantId,
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
            success: false,

            message:
              "Ce portrait n'appartient pas à cette galerie.",
          });
      }

      const portrait =
        portraitResult
          .rows[0];

      /*
       * =====================================================
       * 9. VISIBILITY
       * =====================================================
       */

      if (
        !portrait
          .isGalleryVisible
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              "Ce portrait n'est pas disponible.",
          });
      }

      /*
       * =====================================================
       * 10. STATUS PORTRAIT
       * =====================================================
       */

      if (
        portrait.status !==
        "PUBLISHED"
      ) {
        await client.query(
          "ROLLBACK"
        );

        transactionStarted =
          false;

        return res
          .status(409)
          .json({
            success: false,

            message:
              "Ce portrait ne peut plus être sélectionné.",
          });
      }

      /*
       * =====================================================
       * 11. RESET FLAGS
       * =====================================================
       */

      await client.query(
        `
        UPDATE generated_portraits

        SET
          is_selected_by_participant =
            FALSE

        WHERE
          participant_id =
            $1
        `,
        [
          gallery
            .participantId,
        ]
      );

      /*
       * =====================================================
       * 12. RESET OLD FINAL SELECTION
       * =====================================================
       */

      await client.query(
        `
        UPDATE participant_selections

        SET
          is_final_selection =
            FALSE,

          updated_at =
            NOW()

        WHERE
          participant_id =
            $1

          AND is_final_selection =
            TRUE
        `,
        [
          gallery
            .participantId,
        ]
      );

      /*
       * =====================================================
       * 13. SELECTION
       * =====================================================
       */

      const selectionResult =
        await client.query(
          `
          INSERT INTO participant_selections (
            participant_id,
            portrait_id,
            is_favorite,
            is_final_selection,
            revision_requested,
            revision_reason
          )

          VALUES (
            $1,
            $2,
            TRUE,
            TRUE,
            FALSE,
            NULL
          )

          ON CONFLICT (
            participant_id,
            portrait_id
          )

          DO UPDATE

          SET
            is_favorite =
              TRUE,

            is_final_selection =
              TRUE,

            revision_requested =
              FALSE,

            revision_reason =
              NULL,

            updated_at =
              NOW()

          RETURNING
            id,

            participant_id
              AS "participantId",

            portrait_id
              AS "portraitId",

            is_favorite
              AS "isFavorite",

            is_final_selection
              AS "isFinalSelection",

            created_at
              AS "createdAt",

            updated_at
              AS "updatedAt"
          `,
          [
            gallery
              .participantId,

            portraitId,
          ]
        );

      const selection =
        selectionResult
          .rows[0];

      /*
       * =====================================================
       * 14. SELECTED PORTRAIT
       * =====================================================
       */

      const selectedPortraitResult =
        await client.query(
          `
          UPDATE generated_portraits

          SET
            status =
              'SELECTED',

            is_selected_by_participant =
              TRUE

          WHERE
            id =
              $1

            AND participant_id =
              $2

          RETURNING
            id,

            participant_id
              AS "participantId",

            status,

            is_gallery_visible
              AS "isGalleryVisible",

            is_selected_by_participant
              AS "isSelectedByParticipant",

            updated_at
              AS "updatedAt"
          `,
          [
            portraitId,

            gallery
              .participantId,
          ]
        );

      const selectedPortrait =
        selectedPortraitResult
          .rows[0];

      /*
       * =====================================================
       * 15. PARTICIPANT VALIDATED
       * =====================================================
       */

      await client.query(
        `
        UPDATE participants

        SET
          status =
            'VALIDATED'

        WHERE
          id =
            $1
        `,
        [
          gallery
            .participantId,
        ]
      );

      /*
       * =====================================================
       * 16. AUDIT
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
          NULL,
          $1,
          'participant',
          $2,
          'PARTICIPANT_PORTRAIT_SELECTED',
          $3::jsonb
        )
        `,
        [
          gallery
            .companyId,

          gallery
            .participantId,

          JSON.stringify({
            participantId:
              gallery
                .participantId,

            campaignId:
              gallery
                .campaignId,

            galleryId:
              gallery.id,

            portraitId,

            selectionId:
              selection.id,
          }),
        ]
      );

      /*
       * =====================================================
       * 17. COMMIT
       * =====================================================
       */

      await client.query(
        "COMMIT"
      );

      transactionStarted =
        false;

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Votre portrait a bien été confirmé.",

          data: {
            participant: {
              id:
                gallery
                  .participantId,

              status:
                "VALIDATED",
            },

            gallery: {
              id:
                gallery.id,

              publicToken:
                gallery
                  .publicToken,

              expiresAt:
                gallery
                  .expiresAt,
            },

            portrait:
              selectedPortrait,

            selection,
          },
        });
    } catch (
      error
    ) {
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
            "[PARTICIPANT GALLERY][SELECT] ROLLBACK ERROR :",
            rollbackError
          );
        }
      }

      console.error(
        "[PARTICIPANT GALLERY][SELECT] ERROR :",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Impossible d'enregistrer votre sélection.",
        });
    } finally {
      client.release();
    }
  };

module.exports = {
  selectParticipantPortrait,
};