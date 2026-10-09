const accountActivationEmail = ({
  firstName,
  companyName,
  activationUrl,
}) => {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
      <h2>Bienvenue sur Portrélia</h2>

      <p>Bonjour ${firstName},</p>

      <p>
        Votre demande pour
        <strong>${companyName}</strong>
        a été acceptée.
      </p>

      <p>
        Votre espace entreprise est maintenant prêt.
        Il vous reste simplement à créer votre mot de passe.
      </p>

      <p style="margin:28px 0;">
        <a
          href="${activationUrl}"
          style="
            display:inline-block;
            padding:12px 20px;
            background:#4f2e94;
            color:#ffffff;
            text-decoration:none;
            border-radius:8px;
            font-weight:600;
          "
        >
          Créer mon mot de passe
        </a>
      </p>

      <p>
        Ce lien est valable pendant 24 heures.
      </p>

      <p>
        L’équipe Portrélia
      </p>
    </div>
  `;
};

module.exports = {
  accountActivationEmail,
};