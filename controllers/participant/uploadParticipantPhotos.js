const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { db } = require("../../config/db");

const MIN_PHOTOS = 6;
const MAX_PHOTOS = 12;

/*
 * =========================================================
 * DOSSIER LOCAL DES PHOTOS
 * =========================================================
 */
const UPLOAD_ROOT = path.resolve(
  __dirname,
  "../../uploads/participants"
);

/*
 * =========================================================
 * VÉRIFICATION DU VRAI CONTENU IMAGE
 * =========================================================
 */
const isValidImageBuffer = (buffer, mimetype) => {
  if (!buffer || buffer.length < 12) {
    return false;
  }

  if (mimetype === "image/jpeg") {
    return (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (mimetype === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  if (mimetype === "image/webp") {
    return (
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP"
    );
  }

  return false;
};

/*
 * =========================================================
 * EXTENSION SELON LE MIMETYPE
 * =========================================================
 */
const getExtension = (mimetype) => {
  if (mimetype === "image/jpeg") {
    return ".jpg";
  }

  if (mimetype === "image/png") {
    return ".png";
  }

  if (mimetype === "image/webp") {
    return ".webp";
  }

  return null;
};

/*
 * =========================================================
 * UPLOAD DES PHOTOS PARTICIPANT
 * =========================================================
 */
const uploadParticipantPhotos = async (req, res) => {
  const client = await db.connect();
  const writtenFiles = [];

  /*
   * =========================================================
   * DEBUG MULTER
   * =========================================================
   *
   * Ces logs permettent de vérifier si Multer
   * a réellement reçu et parsé les fichiers.
   */
  console.log("\n================ PHOTO UPLOAD ================");
  console.log("CONTENT-TYPE :", req.headers["content-type"]);
  console.log("PARAM TOKEN :", req.params?.token);
  console.log("PARTICIPANT ACCESS :", req.participantAccess);
  console.log("REQ BODY :", req.body);
  console.log("REQ FILES EXISTS :", Boolean(req.files));
  console.log("REQ FILES TYPE :", typeof req.files);
  console.log(
    "REQ FILES COUNT :",
    Array.isArray(req.files)
      ? req.files.length
      : "NOT ARRAY"
  );

  if (Array.isArray(req.files)) {
    req.files.forEach((file, index) => {
      console.log(`FILE ${index + 1} :`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        hasBuffer: Boolean(file.buffer),
        bufferLength: file.buffer?.length,
      });
    });
  }

  console.log("==============================================\n");

  try {
    const access = req.participantAccess;
    const files = Array.isArray(req.files)
      ? req.files
      : [];

    /*
     * Si ceci arrive, le problème est avant
     * le controller : Multer n'a pas injecté
     * les fichiers dans req.files.
     */
    if (files.length === 0) {
      console.error(
        "UPLOAD STOPPED : aucun fichier présent dans req.files"
      );

      return res.status(400).json({
        success: false,
        message: "Aucune photo reçue",
        debug: {
          contentType:
            req.headers["content-type"] || null,
          filesDefined:
            req.files !== undefined,
          filesCount: files.length,
        },
      });
    }

    if (!access) {
      console.error(
        "UPLOAD STOPPED : req.participantAccess absent"
      );

      return res.status(401).json({
        success: false,
        message:
          "Accès participant introuvable",
      });
    }

    console.log(
      "PARTICIPANT STATUS :",
      access.participant_status
    );

    /*
     * Une fois les photos soumises,
     * le participant ne peut plus
     * modifier son dossier.
     */
    if (
      ![
        "INVITED",
        "CONSENT_PENDING",
        "PHOTOS_PENDING",
      ].includes(access.participant_status)
    ) {
      console.error(
        "UPLOAD BLOCKED BY STATUS :",
        access.participant_status
      );

      return res.status(409).json({
        success: false,
        message:
          "Vos photos ont déjà été soumises et ne peuvent plus être modifiées",
      });
    }

    await client.query("BEGIN");

    console.log(
      "TRANSACTION BEGIN"
    );

    /*
     * Nombre de photos déjà présentes.
     */
    const countResult = await client.query(
      `
      SELECT
        COUNT(*)::INTEGER AS count
      FROM input_photos
      WHERE participant_id = $1
      `,
      [access.participant_id]
    );

    const existingCount =
      countResult.rows[0].count;

    console.log(
      "EXISTING PHOTOS COUNT :",
      existingCount
    );

    console.log(
      "NEW FILES COUNT :",
      files.length
    );

    console.log(
      "TOTAL AFTER UPLOAD :",
      existingCount + files.length
    );

    if (
      existingCount + files.length >
      MAX_PHOTOS
    ) {
      await client.query("ROLLBACK");

      console.error(
        "UPLOAD BLOCKED : maximum photos dépassé"
      );

      return res.status(400).json({
        success: false,
        message:
          `Vous pouvez enregistrer ${MAX_PHOTOS} photos maximum`,
      });
    }

    /*
     * =========================================================
     * DOSSIER DU PARTICIPANT
     * =========================================================
     */
    const participantDirectory = path.join(
      UPLOAD_ROOT,
      String(access.participant_id)
    );

    console.log(
      "PARTICIPANT DIRECTORY :",
      participantDirectory
    );

    await fs.mkdir(
      participantDirectory,
      {
        recursive: true,
      }
    );

    console.log(
      "PARTICIPANT DIRECTORY READY"
    );

    const createdPhotos = [];

    /*
     * =========================================================
     * ENREGISTREMENT DE CHAQUE PHOTO
     * =========================================================
     */
    for (const file of files) {
      console.log(
        "PROCESSING FILE :",
        file.originalname
      );

      /*
       * Vérification réelle
       * du contenu du fichier.
       */
      const validImage =
        isValidImageBuffer(
          file.buffer,
          file.mimetype
        );

      console.log(
        "IMAGE BUFFER VALID :",
        validImage
      );

      if (!validImage) {
        throw new Error(
          `Le fichier "${file.originalname}" n'est pas une image valide`
        );
      }

      const extension =
        getExtension(
          file.mimetype
        );

      console.log(
        "FILE EXTENSION :",
        extension
      );

      if (!extension) {
        throw new Error(
          "Format de fichier non supporté"
        );
      }

      /*
       * Nom physique sécurisé.
       */
      const fileName =
        `${crypto.randomUUID()}${extension}`;

      const absolutePath =
        path.join(
          participantDirectory,
          fileName
        );

      const storageKey =
        path
          .join(
            "uploads",
            "participants",
            String(
              access.participant_id
            ),
            fileName
          )
          .replace(/\\/g, "/");

      console.log(
        "FILE GENERATED NAME :",
        fileName
      );

      console.log(
        "FILE ABSOLUTE PATH :",
        absolutePath
      );

      console.log(
        "FILE STORAGE KEY :",
        storageKey
      );

      /*
       * =========================================================
       * ÉCRITURE PHYSIQUE
       * =========================================================
       */
      await fs.writeFile(
        absolutePath,
        file.buffer
      );

      writtenFiles.push(
        absolutePath
      );

      console.log(
        "FILE WRITTEN SUCCESSFULLY :",
        absolutePath
      );

      /*
       * =========================================================
       * INSERT POSTGRESQL
       * =========================================================
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
            'LOCAL',
            $2,
            $3,
            $4,
            $5,
            'UPLOADED'
          )
          RETURNING
            id,
            participant_id AS "participantId",
            storage_provider AS "storageProvider",
            storage_key AS "storageKey",
            original_filename AS "originalFilename",
            mime_type AS "mimeType",
            size_bytes AS "sizeBytes",
            status,
            created_at AS "createdAt"
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

      console.log(
        "DB PHOTO CREATED :",
        createdPhoto
      );

      createdPhotos.push(
        createdPhoto
      );
    }

    /*
     * =========================================================
     * STATUT PARTICIPANT
     * =========================================================
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

    console.log(
      "PARTICIPANT UPDATED :",
      participantResult.rows[0]
    );

    /*
     * =========================================================
     * COMMIT
     * =========================================================
     */
    await client.query("COMMIT");

    console.log(
      "UPLOAD COMMIT SUCCESS"
    );

    console.log(
      "CREATED PHOTOS :",
      createdPhotos
    );

    console.log(
      "PHOTO UPLOAD COMPLETED\n"
    );

    return res.status(201).json({
      success: true,
      message:
        createdPhotos.length === 1
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
      },
    });
  } catch (error) {
    /*
     * =========================================================
     * ROLLBACK DB
     * =========================================================
     */
    try {
      await client.query(
        "ROLLBACK"
      );

      console.log(
        "UPLOAD ROLLBACK SUCCESS"
      );
    } catch (
      rollbackError
    ) {
      console.error(
        "UPLOAD ROLLBACK ERROR :",
        rollbackError
      );
    }

    /*
     * =========================================================
     * NETTOYAGE DES FICHIERS
     * =========================================================
     *
     * Si PostgreSQL échoue après
     * l'écriture physique, on supprime
     * les fichiers créés pendant
     * cette requête.
     */
    for (
      const filePath
      of writtenFiles
    ) {
      try {
        await fs.unlink(
          filePath
        );

        console.log(
          "ROLLBACK FILE DELETED :",
          filePath
        );
      } catch (
        fileError
      ) {
        if (
          fileError.code !==
          "ENOENT"
        ) {
          console.error(
            "ROLLBACK FILE DELETE ERROR :",
            fileError
          );
        }
      }
    }

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