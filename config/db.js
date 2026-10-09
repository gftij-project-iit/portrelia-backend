const { Pool } = require("pg");
require("dotenv").config();

const db = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const dbConnect = async () => {
  try {
    await db.query("SELECT 1");
    console.log("PostgreSQL connecté");
  } catch (error) {
    console.error("Erreur connexion PostgreSQL :", error);
    process.exit(1);
  }
};

module.exports = {
  db,
  dbConnect,
};