const { db } = require("../config/db");

const {
  createDemoRequestSchema,
} = require("../dto/demoRequest.dto");

const createDemoRequest = async (req, res) => {
  try {
    const { error, value } =
      createDemoRequestSchema.validate(
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

    const {
      companyName,
      firstName,
      lastName,
      email,
      phone,
      teamSize,
      message,
      consent,
    } = value;

    /*
     * Vérifie si une demande existe déjà
     * avec le même email OU la même entreprise.
     */
    const existingRequest =
      await db.query(
        `
        SELECT
          id,
          company_name,
          email,
          status,
          created_at
        FROM demo_requests
        WHERE
          LOWER(TRIM(email)) =
            LOWER(TRIM($1))
          OR
          LOWER(TRIM(company_name)) =
            LOWER(TRIM($2))
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [
          email,
          companyName,
        ]
      );

    if (
      existingRequest.rows.length > 0
    ) {
      const existing =
        existingRequest.rows[0];

      /*
       * Demande déjà refusée.
       */
      if (
        existing.status === "REJECTED"
      ) {
        return res.status(409).json({
          success: false,
          code:
            "DEMO_REQUEST_REJECTED",
          message:
            "Une demande associée à cette adresse email ou à cette entreprise a déjà été refusée. Merci de contacter le service Portrélia pour plus d'informations.",
        });
      }

      /*
       * Demande déjà en attente.
       */
      if (
        existing.status === "PENDING"
      ) {
        return res.status(409).json({
          success: false,
          code:
            "DEMO_REQUEST_PENDING",
          message:
            "Une demande de démo existe déjà pour cette adresse email ou cette entreprise et est actuellement en attente de traitement.",
        });
      }

      /*
       * Prospect déjà contacté.
       */
      if (
        existing.status === "CONTACTED"
      ) {
        return res.status(409).json({
          success: false,
          code:
            "DEMO_REQUEST_CONTACTED",
          message:
            "Votre demande de démo est déjà en cours de traitement par notre équipe.",
        });
      }

      /*
       * Demande déjà acceptée.
       */
      if (
        existing.status === "ACCEPTED"
      ) {
        return res.status(409).json({
          success: false,
          code:
            "DEMO_REQUEST_ACCEPTED",
          message:
            "Cette entreprise possède déjà une demande acceptée. Si votre compte a été activé, vous pouvez vous connecter à votre espace Portrélia.",
        });
      }
    }

    /*
     * Nouvelle demande.
     */
    const query = `
      INSERT INTO demo_requests (
        company_name,
        first_name,
        last_name,
        email,
        phone,
        team_size,
        message,
        consent_to_contact
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
      RETURNING
        id,
        company_name,
        first_name,
        last_name,
        email,
        phone,
        team_size,
        status,
        created_at
    `;

    const values = [
      companyName,
      firstName,
      lastName,
      email,
      phone || null,
      teamSize,
      message || null,
      consent,
    ];

    const result =
      await db.query(
        query,
        values
      );

    console.log(
      "Demo request created:",
      result.rows[0]
    );

    return res.status(201).json({
      success: true,
      message:
        "Demande de démo enregistrée",
      data:
        result.rows[0],
    });
  } catch (error) {
    console.error(
      "Erreur createDemoRequest :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Erreur serveur",
    });
  }
};

module.exports = {
  createDemoRequest,
};