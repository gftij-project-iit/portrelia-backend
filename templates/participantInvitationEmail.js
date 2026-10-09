const participantInvitationEmail = ({
  firstName,
  campaignName,
  companyName,
  invitationUrl,
  deadline,
}) => {
  return `
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f7f7f9;
          font-family:Arial,sans-serif;
          color:#111827;
        "
      >
        <div
          style="
            max-width:600px;
            margin:0 auto;
            padding:40px 20px;
          "
        >
          <div
            style="
              background:#ffffff;
              border-radius:14px;
              padding:32px;
              border:1px solid #e5e7eb;
            "
          >
            <h1
              style="
                margin:0 0 20px;
                font-size:24px;
              "
            >
              Bonjour ${firstName},
            </h1>

            <p
              style="
                font-size:15px;
                line-height:1.6;
              "
            >
              ${companyName} vous invite à participer à la campagne
              <strong>${campaignName}</strong> sur Portrélia.
            </p>

            <p
              style="
                font-size:15px;
                line-height:1.6;
              "
            >
              Vous pourrez suivre les instructions,
              déposer vos photos et accéder à votre parcours
              personnel grâce au lien sécurisé ci-dessous.
            </p>

            ${
              deadline
                ? `
                  <p
                    style="
                      font-size:14px;
                      color:#667085;
                    "
                  >
                    Date limite de participation :
                    <strong>${deadline}</strong>
                  </p>
                `
                : ""
            }

            <div
              style="
                margin:28px 0;
              "
            >
              <a
                href="${invitationUrl}"
                style="
                  display:inline-block;
                  padding:13px 20px;
                  background:#4f2e94;
                  color:#ffffff;
                  text-decoration:none;
                  border-radius:8px;
                  font-size:14px;
                  font-weight:700;
                "
              >
                Accéder à mon invitation
              </a>
            </div>

            <p
              style="
                margin-top:28px;
                color:#98a2b3;
                font-size:12px;
                line-height:1.5;
              "
            >
              Ce lien est personnel. Ne le partagez pas avec une
              autre personne.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
};

module.exports = {
  participantInvitationEmail,
};