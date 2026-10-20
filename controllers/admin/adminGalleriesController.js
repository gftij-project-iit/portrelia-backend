const {
  createClient,
} = require("@supabase/supabase-js");

const {
  db,
} = require("../../config/db");

/*
 * =========================================================
 * SUPABASE
 * =========================================================
 */

const supabase =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

const GENERATED_BUCKET =
  process.env.SUPABASE_GENERATED_BUCKET ;

/*
 * =========================================================
 * SIGNED URL
 * =========================================================
 */

const createSignedImageUrl =
  async (
    storageKey
  ) => {
    if (
      !storageKey
    ) {
      return null;
    }

    try {
      const {
        data,
        error,
      } =
        await supabase
          .storage
          .from(
            GENERATED_BUCKET
          )
          .createSignedUrl(
            storageKey,
            60 * 60
          );

      if (
        error
      ) {
        console.error(
          "[ADMIN GALLERIES] SIGNED URL ERROR:",
          error
        );

        return null;
      }

      return (
        data
          ?.signedUrl ||
        null
      );
    } catch (
      error
    ) {
      console.error(
        "[ADMIN GALLERIES] SIGNED URL EXCEPTION:",
        error
      );

      return null;
    }
  };

/*
 * =========================================================
 * GET ADMIN GALLERIES
 * =========================================================
 *
 * GET /api/v1/admin/galleries
 *
 * Retourne :
 *
 * - galerie
 * - participant
 * - campagne
 * - entreprise
 * - statut
 * - dates
 * - portrait final choisi
 */

const getAdminGalleries =
  async (
    req,
    res
  ) => {
    try {
      /*
       * =====================================================
       * GALLERIES
       * =====================================================
       */

      const galleriesResult =
        await db.query(
          `
          SELECT
            g.id,

            g.public_token
              AS "publicToken",

            g.published_at
              AS "publishedAt",

            g.expires_at
              AS "expiresAt",

            g.created_at
              AS "createdAt",

            p.id
              AS "participantId",

            p.first_name
              AS "participantFirstName",

            p.last_name
              AS "participantLastName",

            p.email
              AS "participantEmail",

            p.status
              AS "participantStatus",

            c.id
              AS "campaignId",

            c.name
              AS "campaignName",

            co.id
              AS "companyId",

            co.name
              AS "companyName",

            ps.id
              AS "selectionId",

            ps.portrait_id
              AS "selectedPortraitId",

            ps.created_at
              AS "selectionCreatedAt",

            ps.updated_at
              AS "selectionUpdatedAt",

            gp.storage_key
              AS "selectedPortraitStorageKey",

            gp.status
              AS "selectedPortraitStatus",

            gp.is_selected_by_participant
              AS "isSelectedByParticipant"

          FROM galleries g

          JOIN participants p
            ON p.id =
              g.participant_id

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          JOIN companies co
            ON co.id =
              c.company_id

          LEFT JOIN participant_selections ps
            ON ps.participant_id =
              p.id

            AND ps.is_final_selection =
              TRUE

          LEFT JOIN generated_portraits gp
            ON gp.id =
              ps.portrait_id

          ORDER BY
            g.published_at DESC NULLS LAST,
            g.created_at DESC
          `
        );

      /*
       * =====================================================
       * SIGNED URLS
       * =====================================================
       */

      const galleries =
        await Promise.all(
          galleriesResult
            .rows
            .map(
              async (
                row
              ) => {
                let selectedPortrait =
                  null;

                if (
                  row
                    .selectedPortraitId
                ) {
                  const imageUrl =
                    await createSignedImageUrl(
                      row
                        .selectedPortraitStorageKey
                    );

                  selectedPortrait =
                    {
                      id:
                        row
                          .selectedPortraitId,

                      status:
                        row
                          .selectedPortraitStatus,

                      isSelectedByParticipant:
                        Boolean(
                          row
                            .isSelectedByParticipant
                        ),

                      imageUrl,

                      fileAvailable:
                        Boolean(
                          imageUrl
                        ),

                      selectedAt:
                        row
                          .selectionUpdatedAt ||
                        row
                          .selectionCreatedAt ||
                        null,
                    };
                }

                return {
                  id:
                    row.id,

                  publicToken:
                    row.publicToken,

                  publishedAt:
                    row.publishedAt,

                  expiresAt:
                    row.expiresAt,

                  createdAt:
                    row.createdAt,

                  participantId:
                    row.participantId,

                  participantFirstName:
                    row.participantFirstName,

                  participantLastName:
                    row.participantLastName,

                  participantEmail:
                    row.participantEmail,

                  participantStatus:
                    row.participantStatus,

                  campaignId:
                    row.campaignId,

                  campaignName:
                    row.campaignName,

                  companyId:
                    row.companyId,

                  companyName:
                    row.companyName,

                  participant: {
                    id:
                      row.participantId,

                    firstName:
                      row.participantFirstName,

                    lastName:
                      row.participantLastName,

                    email:
                      row.participantEmail,

                    status:
                      row.participantStatus,
                  },

                  campaign: {
                    id:
                      row.campaignId,

                    name:
                      row.campaignName,
                  },

                  company: {
                    id:
                      row.companyId,

                    name:
                      row.companyName,
                  },

                  selectedPortrait,
                };
              }
            )
        );

      /*
       * =====================================================
       * CAMPAIGNS FILTER
       * =====================================================
       */

      const campaignsResult =
        await db.query(
          `
          SELECT DISTINCT
            c.id,
            c.name,

            co.id
              AS "companyId",

            co.name
              AS "companyName"

          FROM galleries g

          JOIN participants p
            ON p.id =
              g.participant_id

          JOIN campaigns c
            ON c.id =
              p.campaign_id

          JOIN companies co
            ON co.id =
              c.company_id

          ORDER BY
            c.name ASC
          `
        );

      /*
       * =====================================================
       * RESPONSE
       * =====================================================
       */

      return res
        .status(200)
        .json({
          success: true,

          data: {
            galleries,

            campaigns:
              campaignsResult
                .rows,
          },
        });
    } catch (
      error
    ) {
      console.error(
        "[ADMIN GALLERIES] ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            "Impossible de charger les galeries.",
        });
    }
  };

module.exports = {
  getAdminGalleries,
};