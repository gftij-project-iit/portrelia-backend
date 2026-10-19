const crypto =
  require("crypto");

const {
  supabase,
} = require(
  "../../config/supabase"
);

/*
 * =========================================================
 * CONFIG
 * =========================================================
 */

const SOURCE_BUCKET =
  process.env
    .SUPABASE_STORAGE_BUCKET;

const GENERATED_BUCKET =
  process.env
    .SUPABASE_GENERATED_BUCKET ||
  SOURCE_BUCKET;

const GEMINI_MODEL =
  process.env
    .GEMINI_IMAGE_MODEL ||
  "gemini-nano-banana-2.1";

const PORTRAIT_COUNT =
  Math.max(
    1,
    Math.min(
      Number(
        process.env
          .GEMINI_PORTRAIT_COUNT ||
          4
      ),
      8
    )
  );

const IMAGE_SIZE =
  process.env
    .GEMINI_IMAGE_SIZE ||
  "2K";

const ASPECT_RATIO =
  process.env
    .GEMINI_ASPECT_RATIO ||
  "1:1";

/*
 * =========================================================
 * GET GEMINI CLIENT
 * =========================================================
 */

const getGeminiClient =
  async () => {
    const apiKey =
      process.env
        .GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY absente."
      );
    }

    const {
      GoogleGenAI,
    } =
      await import(
        "@google/genai"
      );

    const ai =
      new GoogleGenAI({
        apiKey,
      });

    return ai;
  };

/*
 * =========================================================
 * DOWNLOAD SOURCE PHOTO
 * =========================================================
 */

const downloadSourcePhoto =
  async (photo) => {
    if (
      !photo.storageKey
    ) {
      throw new Error(
        `storageKey absente pour la photo ${photo.id}.`
      );
    }

    console.log(
      "[GEMINI] Téléchargement photo :",
      {
        photoId:
          photo.id,

        storageKey:
          photo.storageKey,
      }
    );

    const {
      data,
      error,
    } =
      await supabase.storage
        .from(
          SOURCE_BUCKET
        )
        .download(
          photo.storageKey
        );

    if (error) {
      throw new Error(
        `Impossible de télécharger la photo ${photo.id} : ${error.message}`
      );
    }

    if (!data) {
      throw new Error(
        `Photo ${photo.id} vide.`
      );
    }

    const arrayBuffer =
      await data.arrayBuffer();

    const buffer =
      Buffer.from(
        arrayBuffer
      );

    if (
      buffer.length === 0
    ) {
      throw new Error(
        `Photo ${photo.id} vide après téléchargement.`
      );
    }

    console.log(
      "[GEMINI] Photo chargée :",
      {
        photoId:
          photo.id,

        bytes:
          buffer.length,

        mimeType:
          photo.mimeType,
      }
    );

    return {
      id:
        photo.id,

      buffer,

      base64:
        buffer.toString(
          "base64"
        ),

      mimeType:
        photo.mimeType ||
        "image/jpeg",
    };
  };

/*
 * =========================================================
 * BUILD PROMPT
 * =========================================================
 */

const buildPrompt =
  (
    generationPayload,
    portraitIndex
  ) => {
    const style =
      generationPayload
        .style;

    const customPrompt =
      style
        ?.promptTemplate
        ?.trim();

    if (customPrompt) {
      return `
${customPrompt}

IMPORTANT:
The supplied reference images all show the same real person.

Create professional portrait variation ${portraitIndex}.

IDENTITY REQUIREMENTS:
- preserve the person's identity faithfully;
- preserve recognizable facial structure;
- preserve natural skin tone;
- preserve approximate age;
- preserve distinctive facial characteristics;
- do not beautify excessively;
- do not change ethnicity;
- do not invent facial features;
- do not merge the subject with another person.

PROFESSIONAL PORTRAIT REQUIREMENTS:
- single person only;
- realistic professional photography;
- natural facial proportions;
- clean high quality image;
- natural skin texture;
- sharp eyes;
- professional clothing;
- professional posture;
- no text;
- no watermark;
- no logo;
- no extra people;
- no distorted facial features.

The final portrait must clearly look like the same real person shown in the reference photographs.
      `.trim();
    }

    return `
Create a highly realistic professional portrait using all supplied reference photographs.

All reference images show the SAME PERSON.

Portrait variation:
${portraitIndex}

Selected campaign style:
${style?.name || "Professional portrait"}

Style description:
${style?.description || "Professional, realistic and natural portrait."}

IDENTITY:
- preserve the person's identity faithfully;
- preserve recognizable facial structure;
- preserve natural skin tone;
- preserve approximate age;
- preserve distinctive facial characteristics;
- do not change ethnicity;
- do not invent a different person;
- do not merge several faces;
- do not excessively beautify or retouch the subject.

COMPOSITION:
- one person only;
- professional head-and-shoulders portrait;
- face clearly visible;
- natural expression;
- realistic skin texture;
- professional posture;
- appropriate corporate clothing;
- clean composition.

LIGHTING:
- soft professional studio lighting;
- balanced exposure;
- natural skin rendering;
- no harsh shadows.

BACKGROUND:
- neutral professional studio background;
- subtle depth;
- no distracting objects.

QUALITY:
- photorealistic;
- professional photography;
- sharp eyes;
- realistic proportions;
- no artifacts;
- no text;
- no watermark;
- no logos.

The result must clearly represent the SAME real person from the supplied reference photos.
    `.trim();
  };

/*
 * =========================================================
 * EXTRACT GENERATED IMAGE
 * =========================================================
 */

const extractGeneratedImage =
  (interaction) => {
    /*
     * Format direct.
     */
    if (
      interaction
        ?.output_image
        ?.data
    ) {
      return {
        data:
          interaction
            .output_image
            .data,

        mimeType:
          interaction
            .output_image
            .mime_type ||
          "image/jpeg",
      };
    }

    /*
     * Recherche dans les steps.
     */
    for (
      const step of
      interaction?.steps ||
      []
    ) {
      if (
        step.type !==
        "model_output"
      ) {
        continue;
      }

      for (
        const block of
        step.content ||
        []
      ) {
        if (
          block.type ===
            "image" &&
          block.data
        ) {
          return {
            data:
              block.data,

            mimeType:
              block.mime_type ||
              "image/jpeg",
          };
        }
      }
    }

    return null;
  };

/*
 * =========================================================
 * GENERATE ONE PORTRAIT
 * =========================================================
 */

const generateOnePortrait =
  async ({
    ai,
    generationPayload,
    sourceImages,
    portraitIndex,
  }) => {
    const prompt =
      buildPrompt(
        generationPayload,
        portraitIndex
      );

    console.log(
      "\n------------------------------------------"
    );

    console.log(
      "[GEMINI] Génération portrait",
      portraitIndex
    );

    console.log(
      "[GEMINI] Model :",
      GEMINI_MODEL
    );

    console.log(
      "[GEMINI] Photos référence :",
      sourceImages.length
    );

    console.log(
      "[GEMINI] Style :",
      generationPayload
        .style
        ?.name
    );

    console.log(
      "[GEMINI] Format sortie : image/jpeg"
    );

    console.log(
      "[GEMINI] Taille :",
      IMAGE_SIZE
    );

    console.log(
      "[GEMINI] Ratio :",
      ASPECT_RATIO
    );

    console.log(
      "------------------------------------------\n"
    );

    /*
     * =====================================================
     * INPUT
     * =====================================================
     */

    const input = [
      {
        type:
          "text",

        text:
          prompt,
      },

      ...sourceImages.map(
        (image) => ({
          type:
            "image",

          mime_type:
            image.mimeType,

          data:
            image.base64,
        })
      ),
    ];

    /*
     * =====================================================
     * REAL GEMINI CALL
     * =====================================================
     */

    const interaction =
      await ai.interactions.create({
        model:
          GEMINI_MODEL,

        input,

        response_format: {
          type:
            "image",

          /*
           * IMPORTANT :
           *
           * Gemini refuse image/png
           * sur cet endpoint.
           */
          mime_type:
            "image/jpeg",

          aspect_ratio:
            ASPECT_RATIO,

          image_size:
            IMAGE_SIZE,
        },
      });

    console.log(
      "[GEMINI] Réponse reçue pour portrait",
      portraitIndex
    );

    /*
     * =====================================================
     * EXTRACT IMAGE
     * =====================================================
     */

    const generated =
      extractGeneratedImage(
        interaction
      );

    if (!generated) {
      console.error(
        "[GEMINI] Réponse sans image :",
        {
          portraitIndex,

          interactionKeys:
            interaction
              ? Object.keys(
                  interaction
                )
              : [],
        }
      );

      throw new Error(
        `Gemini n'a retourné aucune image pour la variation ${portraitIndex}.`
      );
    }

    /*
     * =====================================================
     * BUFFER
     * =====================================================
     */

    const buffer =
      Buffer.from(
        generated.data,
        "base64"
      );

    if (
      buffer.length === 0
    ) {
      throw new Error(
        `Image Gemini vide pour la variation ${portraitIndex}.`
      );
    }

    console.log(
      "[GEMINI] Portrait généré :",
      {
        portraitIndex,

        bytes:
          buffer.length,

        mimeType:
          generated.mimeType,
      }
    );

    return {
      buffer,

      /*
       * On force JPEG,
       * puisqu'il s'agit du format
       * demandé à Gemini.
       */
      mimeType:
        "image/jpeg",

      portraitIndex,
    };
  };

/*
 * =========================================================
 * UPLOAD GENERATED PORTRAIT
 * =========================================================
 */

const uploadGeneratedPortrait =
  async ({
    participantId,
    generatedPortrait,
  }) => {
    /*
     * Les portraits Gemini sont
     * maintenant toujours en JPEG.
     */
    const extension =
      "jpg";

    /*
     * Les photos source restent dans :
     *
     * participants/:participantId/
     *
     * Les portraits générés vont dans :
     *
     * generated/participants/:participantId/
     */
    const storageKey =
      `generated/participants/${participantId}/${crypto.randomUUID()}.${extension}`;

    console.log(
      "[GEMINI] Upload portrait généré :",
      {
        participantId,

        bucket:
          GENERATED_BUCKET,

        storageKey,

        mimeType:
          generatedPortrait
            .mimeType,

        bytes:
          generatedPortrait
            .buffer.length,
      }
    );

    const {
      data,
      error,
    } =
      await supabase.storage
        .from(
          GENERATED_BUCKET
        )
        .upload(
          storageKey,

          generatedPortrait
            .buffer,

          {
            contentType:
              "image/jpeg",

            upsert:
              false,

            cacheControl:
              "3600",
          }
        );

    if (error) {
      throw new Error(
        `Upload portrait généré impossible : ${error.message}`
      );
    }

    console.log(
      "[GEMINI] Portrait uploadé avec succès :",
      {
        bucket:
          GENERATED_BUCKET,

        storageKey,

        storageData:
          data,
      }
    );

    return {
      storageProvider:
        "SUPABASE",

      storageKey,

      mimeType:
        "image/jpeg",

      portraitIndex:
        generatedPortrait
          .portraitIndex,
    };
  };

/*
 * =========================================================
 * GENERATE PORTRAITS WITH GEMINI
 * =========================================================
 *
 * Utilisation normale :
 *
 * generatePortraitsWithGemini(
 *   generationPayload
 * )
 *
 * => utilise GEMINI_PORTRAIT_COUNT
 *    donc 4 par défaut
 *
 *
 * Régénération :
 *
 * generatePortraitsWithGemini(
 *   generationPayload,
 *   {
 *     portraitCount: 1,
 *   }
 * )
 *
 * => génère seulement 1 portrait
 */
const generatePortraitsWithGemini =
  async (
    generationPayload,
    options = {}
  ) => {
    /*
     * =====================================================
     * PORTRAIT COUNT
     * =====================================================
     *
     * IMPORTANT :
     *
     * Si aucun portraitCount n'est donné,
     * on garde exactement le comportement
     * actuel utilisé par generationService.
     */
    const requestedPortraitCount =
      Math.max(
        1,
        Math.min(
          Number(
            options
              ?.portraitCount ??
            PORTRAIT_COUNT
          ) ||
            PORTRAIT_COUNT,
          8
        )
      );

    console.log(
      "\n=========================================="
    );

    console.log(
      "[GEMINI] DÉMARRAGE GÉNÉRATION RÉELLE"
    );

    console.log(
      "[GEMINI] Participant :",
      generationPayload
        .participant
        .id
    );

    console.log(
      "[GEMINI] Nombre de portraits :",
      requestedPortraitCount
    );

    console.log(
      "[GEMINI] Source bucket :",
      SOURCE_BUCKET
    );

    console.log(
      "[GEMINI] Generated bucket :",
      GENERATED_BUCKET
    );

    console.log(
      "==========================================\n"
    );

    /*
     * =====================================================
     * STORAGE CONFIG
     * =====================================================
     */

    if (
      !SOURCE_BUCKET
    ) {
      throw new Error(
        "SUPABASE_STORAGE_BUCKET absente."
      );
    }

    if (
      !GENERATED_BUCKET
    ) {
      throw new Error(
        "Bucket de stockage des portraits générés absent."
      );
    }

    /*
     * =====================================================
     * GEMINI CLIENT
     * =====================================================
     */

    const ai =
      await getGeminiClient();

    console.log(
      "[GEMINI] Client Gemini initialisé"
    );

    /*
     * =====================================================
     * DOWNLOAD REFERENCES
     * =====================================================
     */

    const sourceImages =
      [];

    for (
      const photo of
      generationPayload.photos
    ) {
      const sourceImage =
        await downloadSourcePhoto(
          photo
        );

      sourceImages.push(
        sourceImage
      );
    }

    if (
      sourceImages.length ===
      0
    ) {
      throw new Error(
        "Aucune image de référence disponible."
      );
    }

    console.log(
      "[GEMINI] Toutes les références chargées :",
      sourceImages.length
    );

    /*
     * =====================================================
     * GENERATION
     * =====================================================
     */

    const uploadedPortraits =
      [];

    for (
      let index = 1;
      index <=
      requestedPortraitCount;
      index += 1
    ) {
      console.log(
        `\n[GEMINI] ===== Portrait ${index}/${requestedPortraitCount} =====`
      );

      /*
       * Génération Gemini
       */
      const generatedPortrait =
        await generateOnePortrait({
          ai,

          generationPayload,

          sourceImages,

          portraitIndex:
            index,
        });

      /*
       * Upload Supabase
       */
      const uploadedPortrait =
        await uploadGeneratedPortrait({
          participantId:
            generationPayload
              .participant.id,

          generatedPortrait,
        });

      uploadedPortraits.push(
        uploadedPortrait
      );

      console.log(
        `[GEMINI] Portrait ${index}/${requestedPortraitCount} terminé`
      );
    }

    /*
     * =====================================================
     * END
     * =====================================================
     */

    console.log(
      "\n=========================================="
    );

    console.log(
      "[GEMINI] GÉNÉRATION TERMINÉE"
    );

    console.log(
      "[GEMINI] Portraits créés :",
      uploadedPortraits.length
    );

    console.log(
      "[GEMINI] Portraits stockés :",
      uploadedPortraits.map(
        (portrait) =>
          portrait.storageKey
      )
    );

    console.log(
      "==========================================\n"
    );

    return uploadedPortraits;
  };

module.exports = {
  generatePortraitsWithGemini,
};