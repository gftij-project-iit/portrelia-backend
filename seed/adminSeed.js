const bcrypt = require("bcrypt");
const { db } = require("../config/db");


const seedAdmin = async () => {
  try {
    const email = "admin@portrelia.fr";
    const password = "Admin123";

    const existingAdmin = await db.query(
      `
      SELECT id
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (existingAdmin.rows.length > 0) {
      console.log("Admin déjà existant");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `
      INSERT INTO users (
        first_name,
        last_name,
        email,
        password_hash,
        role,
        company_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        first_name,
        last_name,
        email,
        role,
        created_at
      `,
      [
        "Rabah",
        "Maouche",
        email,
        passwordHash,
        "ADMIN",
        null,
      ]
    );

    console.log("Admin créé :");
    console.log(result.rows[0]);

    console.log("Email :", email);
    console.log("Mot de passe :", password);

    process.exit(0);
  } catch (error) {
    console.error("Erreur seed admin :", error);
    process.exit(1);
  }
};

seedAdmin();