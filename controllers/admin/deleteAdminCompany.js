const { db } = require("../../config/db");

const deleteAdminCompany = async (req, res) => {
  const client = await db.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const companyResult = await client.query(
      `
      SELECT id, name
      FROM companies
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [id]
    );

    if (companyResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Entreprise introuvable",
      });
    }

    const company = companyResult.rows[0];

    // Supprime les utilisateurs de l'entreprise
    await client.query(
      `
      DELETE FROM users
      WHERE company_id = $1
      `,
      [id]
    );

    // Supprime les campagnes de l'entreprise
    await client.query(
      `
      DELETE FROM campaigns
      WHERE company_id = $1
      `,
      [id]
    );

    // Supprime l'entreprise
    await client.query(
      `
      DELETE FROM companies
      WHERE id = $1
      `,
      [id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Entreprise supprimée définitivement",
      data: {
        id: company.id,
        name: company.name,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // transaction déjà terminée
    }

    console.error(
      "Erreur deleteAdminCompany :",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Impossible de supprimer l'entreprise",
    });
  } finally {
    client.release();
  }
};

module.exports = {
  deleteAdminCompany,
};