const crypto = require("crypto");

const { db } = require("../../config/db");
const { supabase } = require("../../config/supabase");

const MIN_PHOTOS = 6;
const MAX_PHOTOS = 12;

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET;


/*
 * =========================================================
 * VÉRIFICATION CONFIGURATION STORAGE
 * =========================================================
 */
if (!STORAGE_BUCKET) {
  throw new Error(
    "SUPABASE_STORAGE_BUCKET manquant dans le .env"
  );
}


/*
 * =========================================================
 * VÉRIFICATION DU CONTENU RÉEL DE L'IMAGE
 * =========================================================
 */
const isValidImageBuffer = (
  buffer,
  mimetype
) => {
  if (
    !buffer ||
    !Buffer.isBuffer(buffer) ||
    buffer.length < 12
  ) {
    return false;
  }

  /*
   * JPEG
   */
  if (mimetype === "image/jpeg") {
    return (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  /*
   * PNG
   */
  if (mimetype === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  /*
   * WEBP
   */
  if (mimetype === "image/webp") {
    return (
      buffer
        .subarray(0, 4)
        .toString() === "RIFF" &&
      buffer
        .subarray(8, 12)
        .toString() === "WEBP"
    );
  }

  return false;
};


/*
 * =========================================================
 * EXTENSION SÉCURISÉE SELON LE MIME TYPE
 * =========================================================
 */
const getExtension = (mimetype) => {
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };

  return extensions[mimetype] || null;
};


/*
 * =========================================================
 * SUPPRESSION STORAGE EN CAS DE ROLLBACK
 * =========================================================
 */
const cleanupSupabaseFiles = async (
  storageKeys
) => {
  if (
    !Array.isArray(storageKeys) ||
    storageKeys.length === 0
  ) {
    return;
  }

  try {
    const { error } =
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(storageKeys);

    if (error) {
      console.error(
        "SUPABASE STORAGE CLEANUP ERROR :",
        error
      );

      return;
    }

    console.log(
      "SUPABASE STORAGE CLEANUP SUCCESS :",
      storageKeys.length,
      "fichier(s)"
    );
  } catch (error) {
    console.error(
      "SUPABASE STORAGE CLEANUP EXCEPTION :",
      error
    );
  }
};


/*
 * =========================================================
 * UPLOAD PHOTOS PARTICIPANT
 * =========================================================
 *
 * POST
 * /api/v1/participant/invitations/:token/photos
 *
 * Multer doit avoir exécuté :
 *
 * upload.array("photos", 12)
 *
 * avec :
 *
 * multer.memoryStorage()
 *
 * Les fichiers sont donc disponibles dans :
 *
 * req.files
 *
 * et leur contenu dans :
 *
 * file.buffer
 */
const uploadParticipantPhotos = async (
  req,
  res
) => {
  const client = await db.connect();

  /*
   * Liste des fichiers réellement créés
   * dans Supabase pendant cette requête.
   *
   * Si PostgreSQL échoue ensuite,
   * on pourra les supprimer.
   */
  const uploadedStorageKeys = [];

  let transactionStarted = false;

  try {
    const access =
      req.participantAccess;

    const files = Array.isArray(
      req.files
    )
      ? req.files
      : [];

    console.log(
      "\n=============== PHOTO UPLOAD ==============="
    );

    console.log(
      "CONTENT-TYPE :",
      req.headers["content-type"]
    );

    console.log(
      "PARTICIPANT ID :",
      access?.participant_id
    );

    console.log(
      "PARTICIPANT STATUS :",
      access?.participant_status
    );

    console.log(
      "FILES COUNT :",
      files.length
    );

    /*
     * =====================================================
     * 1. ACCÈS PARTICIPANT
     * =====================================================
     */
    if (!access) {
      return res.status(401).json({
        success: false,
        message:
          "Accès participant introuvable",
      });
    }

    /*
     * =====================================================
     * 2. FICHIERS MULTER
     * =====================================================
     */
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Aucune photo reçue",
      });
    }

    /*
     * Vérification supplémentaire :
     * avec memoryStorage, chaque fichier
     * doit avoir un Buffer.
     */
    const missingBuffer =
      files.some(
        (file) =>
          !Buffer.isBuffer(
            file.buffer
          )
      );

    if (missingBuffer) {
      console.error(
        "MULTER ERROR : buffer manquant"
      );

      return res.status(500).json({
        success: false,
        message:
          "Configuration upload invalide",
      });
    }

    /*
     * =====================================================
     * 3. STATUT PARTICIPANT
     * =====================================================
     */
    const allowedStatuses = [
      "INVITED",
      "CONSENT_PENDING",
      "PHOTOS_PENDING",
    ];

    if (
      !allowedStatuses.includes(
        access.participant_status
      )
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Vos photos ont déjà été soumises et ne peuvent plus être modifiées",
      });
    }

    /*
     * =====================================================
     * 4. TRANSACTION POSTGRESQL
     * =====================================================
     */
    await client.query("BEGIN");

    transactionStarted = true;

    /*
     * =====================================================
     * 5. COMPTER LES PHOTOS EXISTANTES
     * =====================================================
     */
    const countResult =
      await client.query(
        `
        SELECT
          COUNT(*)::INTEGER AS count
        FROM input_photos
        WHERE participant_id = $1
        `,
        [
          access.participant_id,
        ]
      );

    const existingCount =
      Number(
        countResult.rows[0]
          ?.count || 0
      );

    const totalAfterUpload =
      existingCount +
      files.length;

    console.log(
      "EXISTING PHOTOS :",
      existingCount
    );

    console.log(
      "NEW PHOTOS :",
      files.length
    );

    console.log(
      "TOTAL AFTER UPLOAD :",
      totalAfterUpload
    );

    /*
     * =====================================================
     * 6. MAXIMUM 12 PHOTOS
     * =====================================================
     */
    if (
      totalAfterUpload >
      MAX_PHOTOS
    ) {
      await client.query(
        "ROLLBACK"
      );

      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message:
          `Vous pouvez enregistrer ${MAX_PHOTOS} photos maximum`,
      });
    }

    const createdPhotos = [];

    /*
     * =====================================================
     * 7. TRAITEMENT DES FICHIERS
     * =====================================================
     */
    for (const file of files) {
      console.log(
        "PROCESSING FILE :",
        file.originalname
      );

      /*
       * Validation du contenu réel.
       */
      const validImage =
        isValidImageBuffer(
          file.buffer,
          file.mimetype
        );

      if (!validImage) {
        throw new Error(
          `Le fichier "${file.originalname}" n'est pas une image valide`
        );
      }

      /*
       * Extension basée sur le MIME,
       * pas sur le nom envoyé par
       * l'utilisateur.
       */
      const extension =
        getExtension(
          file.mimetype
        );

      if (!extension) {
        throw new Error(
          `Format non supporté pour "${file.originalname}"`
        );
      }

      /*
       * Nom généré côté serveur.
       */
      const fileName =
        `${crypto.randomUUID()}${extension}`;

      /*
       * Le bucket s'appelle :
       *
       * participant-photos
       *
       * Donc storageKey ne doit PAS
       * contenir le nom du bucket.
       *
       * Résultat :
       *
       * participants/2/uuid.png
       */
      const storageKey =
        [
          "participants",
          String(
            access.participant_id
          ),
          fileName,
        ].join("/");

      console.log(
        "SUPABASE STORAGE KEY :",
        storageKey
      );

      /*
       * ===================================================
       * 8. UPLOAD SUPABASE STORAGE
       * ===================================================
       */
      const {
        data: storageData,
        error: storageError,
      } =
        await supabase.storage
          .from(
            STORAGE_BUCKET
          )
          .upload(
            storageKey,
            file.buffer,
            {
              contentType:
                file.mimetype,

              /*
               * Ne jamais écraser une
               * photo existante.
               */
              upsert: false,

              /*
               * Cache navigateur/CDN.
               */
              cacheControl:
                "3600",
            }
          );

      if (storageError) {
        console.error(
          "SUPABASE STORAGE UPLOAD ERROR :",
          storageError
        );

        throw new Error(
          `Impossible de stocker "${file.originalname}"`
        );
      }

      uploadedStorageKeys.push(
        storageKey
      );

      console.log(
        "SUPABASE STORAGE UPLOAD SUCCESS :",
        storageData?.path ||
          storageKey
      );

      /*
       * ===================================================
       * 9. INSERT POSTGRESQL
       * ===================================================
       */
      const photoResult =
        await client.query(
          `
          INSERT INTO input_photos (
            participant_id,
            storage_provider,
            storage_key,
            original_filename,
            mime_type,
            size_bytes,
            status
          )

          VALUES (
            $1,
            'SUPABASE',
            $2,
            $3,
            $4,
            $5,
            'UPLOADED'
          )

          RETURNING
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
              AS "mimeType",

            size_bytes
              AS "sizeBytes",

            status,

            created_at
              AS "createdAt"
          `,
          [
            access.participant_id,
            storageKey,
            file.originalname,
            file.mimetype,
            file.size,
          ]
        );

      const createdPhoto =
        photoResult.rows[0];

      createdPhotos.push(
        createdPhoto
      );

      console.log(
        "DB PHOTO CREATED :",
        {
          id:
            createdPhoto.id,

          provider:
            createdPhoto.storageProvider,

          storageKey:
            createdPhoto.storageKey,
        }
      );
    }

    /*
     * =====================================================
     * 10. MISE À JOUR DU PARTICIPANT
     * =====================================================
     */
    const participantResult =
      await client.query(
        `
        UPDATE participants

        SET
          status =
            CASE
              WHEN status IN (
                'INVITED',
                'CONSENT_PENDING'
              )

              THEN 'PHOTOS_PENDING'

              ELSE status
            END

        WHERE id = $1

        RETURNING
          id,
          status
        `,
        [
          access.participant_id,
        ]
      );

    /*
     * =====================================================
     * 11. COMMIT DB
     * =====================================================
     */
    await client.query(
      "COMMIT"
    );

    transactionStarted = false;

    console.log(
      "UPLOAD COMMIT SUCCESS"
    );

    console.log(
      "PARTICIPANT STATUS :",
      participantResult.rows[0]
        ?.status
    );

    console.log(
      "=============== UPLOAD SUCCESS ===============\n"
    );

    /*
     * =====================================================
     * 12. RÉPONSE
     * =====================================================
     */
    return res.status(201).json({
      success: true,

      message:
        createdPhotos.length ===
        1
          ? "Photo enregistrée avec succès"
          : "Photos enregistrées avec succès",

      data: {
        photos:
          createdPhotos,

        total:
          existingCount +
          createdPhotos.length,

        minimum:
          MIN_PHOTOS,

        maximum:
          MAX_PHOTOS,

        participantStatus:
          participantResult.rows[0]
            ?.status,
      },
    });
  } catch (error) {
    /*
     * =====================================================
     * 13. ROLLBACK POSTGRESQL
     * =====================================================
     */
    if (transactionStarted) {
      try {
        await client.query(
          "ROLLBACK"
        );

        console.log(
          "DB ROLLBACK SUCCESS"
        );
      } catch (
        rollbackError
      ) {
        console.error(
          "DB ROLLBACK ERROR :",
          rollbackError
        );
      }
    }

    /*
     * =====================================================
     * 14. ROLLBACK SUPABASE STORAGE
     * =====================================================
     *
     * Si par exemple :
     *
     * - 3 photos sont uploadées
     * - la 4e échoue
     *
     * on supprime les 3 premières.
     *
     * La requête reste atomique
     * fonctionnellement.
     */
    await cleanupSupabaseFiles(
      uploadedStorageKeys
    );

    console.error(
      "UPLOAD PARTICIPANT PHOTOS ERROR :",
      {
        message:
          error.message,

        code:
          error.code,

        stack:
          error.stack,
      }
    );

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Impossible d'enregistrer les photos",
    });
  } finally {
    client.release();

    console.log(
      "DB CLIENT RELEASED"
    );
  }
};


module.exports = {
  uploadParticipantPhotos,
};