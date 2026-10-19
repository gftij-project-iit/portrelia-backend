const {
  db,
} = require("../../config/db");

const {
  generatePortraitsWithGemini,
} = require("./geminiGenerationService");

const MIN_ACCEPTED_PHOTOS = 6;

const regeneratePortrait =
  async ({
    portraitId,
    reviewerUserId = null,
    notes = null,
  }) => {
    let generationJobId =
      null;

    /*
     * =====================================================
     * 1. PORTRAIT + PARTICIPANT + CAMPAIGN + STYLE
     * =====================================================
     */
    const portraitResult =
      await db.query(
        `
        SELECT
          gp.id
            AS "portraitId",

          gp.participant_id
            AS "participantId",

          gp.status
            AS "portraitStatus",

          p.status
            AS "participantStatus",

          p.first_name
            AS "firstName",

          p.last_name
            AS "lastName",

          p.campaign_id
            AS "campaignId",

          c.company_id
            AS "companyId",

          c.name
            AS "campaignName",

          c.style_id
            AS "styleId",

          ps.name
            AS "styleName",

          ps.slug
            AS "styleSlug",

          ps.description
            AS "styleDescription",

          ps.prompt_template
            AS "promptTemplate"

        FROM generated_portraits gp

        JOIN participants p
          ON p.id =
            gp.participant_id

        JOIN campaigns c
          ON c.id =
            p.campaign_id

        LEFT JOIN portrait_styles ps
          ON ps.id =
            c.style_id

        WHERE
          gp.id = $1
        `,
        [
          portraitId,
        ]
      );

    if (
      portraitResult
        .rows.length === 0
    ) {
      throw new Error(
        "Portrait introuvable."
      );
    }

    const portrait =
      portraitResult
        .rows[0];

    if (
      portrait.participantStatus !==
      "QA_PENDING"
    ) {
      throw new Error(
        "Le participant n'est pas en attente de QA."
      );
    }

    if (
      !portrait.styleId
    ) {
      throw new Error(
        "Aucun style associé à cette campagne."
      );
    }

    /*
     * =====================================================
     * 2. PHOTOS SOURCE ACCEPTÉES
     * =====================================================
     */
    const photosResult =
      await db.query(
        `
        SELECT
          id,

          participant_id
            AS "participantId",

          storage_provider
            AS "storageProvider",

          storage_key
            AS "storageKey",

          original_filename
            AS "originalFilename",

          mime_type
            AS "mimeType"

        FROM input_photos

        WHERE
          participant_id = $1

          AND status =
            'ACCEPTED'

        ORDER BY
          created_at ASC
        `,
        [
          portrait.participantId,
        ]
      );

    const acceptedPhotos =
      photosResult.rows;

    if (
      acceptedPhotos.length <
      MIN_ACCEPTED_PHOTOS
    ) {
      throw new Error(
        `Minimum ${MIN_ACCEPTED_PHOTOS} photos acceptées requis.`
      );
    }

    /*
     * =====================================================
     * 3. PAYLOAD
     * =====================================================
     */
    const generationPayload = {
      participant: {
        id:
          portrait.participantId,

        firstName:
          portrait.firstName,

        lastName:
          portrait.lastName,
      },

      company: {
        id:
          portrait.companyId,
      },

      campaign: {
        id:
          portrait.campaignId,

        name:
          portrait.campaignName,
      },

      style: {
        id:
          portrait.styleId,

        name:
          portrait.styleName,

        slug:
          portrait.styleSlug,

        description:
          portrait.styleDescription,

        promptTemplate:
          portrait.promptTemplate,
      },

      photos:
        acceptedPhotos.map(
          (photo) => ({
            id:
              photo.id,

            storageProvider:
              photo.storageProvider,

            storageKey:
              photo.storageKey,

            originalFilename:
              photo.originalFilename,

            mimeType:
              photo.mimeType,
          })
        ),
    };

    /*
     * =====================================================
     * 4. GENERATION JOB
     * =====================================================
     */
    const jobResult =
      await db.query(
        `
        INSERT INTO generation_jobs (
          campaign_id,
          participant_id,
          style_id,
          provider,
          status,
          started_at,
          request_payload
        )

        VALUES (
          $1,
          $2,
          $3,
          'GEMINI',
          'PROCESSING',
          NOW(),
          $4::jsonb
        )

        RETURNING
          id
        `,
        [
          portrait.campaignId,

          portrait.participantId,

          portrait.styleId,

          JSON.stringify({
            type:
              "REGENERATION",

            replacedPortraitId:
              portraitId,

            requestedPortraits:
              1,

            sourcePhotoIds:
              acceptedPhotos.map(
                (photo) =>
                  photo.id
              ),
          }),
        ]
      );

    generationJobId =
      jobResult
        .rows[0]
        .id;

    /*
     * =====================================================
     * 5. GENERATE ONE PORTRAIT
     * =====================================================
     */
    const generated =
      await generatePortraitsWithGemini(
        generationPayload,
        {
          portraitCount:
            1,
        }
      );

    if (
      !Array.isArray(
        generated
      ) ||
      generated.length !==
        1
    ) {
      throw new Error(
        "La régénération n'a produit aucun portrait."
      );
    }

    const generatedPortrait =
      generated[0];

    /*
     * =====================================================
     * 6. NEW PORTRAIT
     * =====================================================
     */
    const insertedResult =
      await db.query(
        `
        INSERT INTO generated_portraits (
          participant_id,
          generation_job_id,
          storage_provider,
          storage_key,
          status,
          is_gallery_visible,
          is_selected_by_participant
        )

        VALUES (
          $1,
          $2,
          'SUPABASE',
          $3,
          'QA_PENDING',
          FALSE,
          FALSE
        )

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

          created_at
            AS "createdAt"
        `,
        [
          portrait.participantId,

          generationJobId,

          generatedPortrait
            .storageKey,
        ]
      );

    const newPortrait =
      insertedResult
        .rows[0];

    /*
     * =====================================================
     * 7. OLD PORTRAIT -> REJECTED
     * =====================================================
     */
    await db.query(
      `
      UPDATE generated_portraits

      SET
        status =
          'QA_REJECTED',

        is_gallery_visible =
          FALSE

      WHERE
        id = $1
      `,
      [
        portraitId,
      ]
    );

    /*
     * =====================================================
     * 8. QA REVIEW HISTORY
     * =====================================================
     */
    await db.query(
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
        'REGENERATE',
        $3
      )
      `,
      [
        portraitId,

        reviewerUserId,

        notes,
      ]
    );

    /*
     * =====================================================
     * 9. JOB SUCCESS
     * =====================================================
     */
    await db.query(
      `
      UPDATE generation_jobs

      SET
        status =
          'SUCCEEDED',

        completed_at =
          NOW(),

        response_payload =
          $2::jsonb

      WHERE
        id = $1
      `,
      [
        generationJobId,

        JSON.stringify({
          type:
            "REGENERATION",

          replacedPortraitId:
            portraitId,

          newPortraitId:
            newPortrait.id,

          storageKey:
            newPortrait.storageKey,
        }),
      ]
    );

    /*
     * Participant reste QA_PENDING.
     */

    return {
      oldPortraitId:
        portraitId,

      newPortrait,

      generationJobId,
    };
  };

module.exports = {
  regeneratePortrait,
};