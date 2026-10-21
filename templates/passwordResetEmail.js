
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const passwordResetEmail = ({ resetUrl }) => {
  const safeUrl = escapeHtml(resetUrl);

  return `
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <title>Réinitialisation du mot de passe</title>
      </head>

      <body style="
        margin:0;
        padding:40px 16px;
        background:#f7f5fa;
        font-family:Arial,Helvetica,sans-serif;
        color:#241b31;
      ">
        <table
          role="presentation"
          cellpadding="0"
          cellspacing="0"
          style="
            width:100%;
            max-width:560px;
            margin:0 auto;
            background:#ffffff;
            border-radius:16px;
          "
        >
          <tr>
            <td style="padding:38px 34px;">
              <div style="
                font-size:25px;
                font-weight:800;
                color:#56319a;
                margin-bottom:30px;
              ">
                Portrélia
              </div>

              <h1 style="
                font-size:23px;
                line-height:1.35;
                margin:0 0 17px;
                color:#241b31;
              ">
                Réinitialisez votre mot de passe
              </h1>

              <p style="
                font-size:14px;
                line-height:1.8;
                color:#655e70;
                margin:0 0 15px;
              ">
                Bonjour,
              </p>

              <p style="
                font-size:14px;
                line-height:1.8;
                color:#655e70;
                margin:0 0 22px;
              ">
                Vous avez demandé à réinitialiser
                le mot de passe de votre compte Portrélia.
              </p>

              <table
                role="presentation"
                cellpadding="0"
                cellspacing="0"
                style="margin:28px 0;"
              >
                <tr>
                  <td style="
                    background:#56319a;
                    border-radius:10px;
                  ">
                    <a
                      href="${safeUrl}"
                      style="
                        display:inline-block;
                        padding:15px 23px;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:14px;
                        font-weight:700;
                      "
                    >
                      Réinitialiser mon mot de passe
                    </a>
                  </td>
                </tr>
              </table>

              <p style="
                font-size:13px;
                line-height:1.8;
                color:#655e70;
              ">
                Ce lien expire dans
                <strong>30 minutes</strong>
                et ne peut être utilisé qu'une seule fois.
              </p>

              <p style="
                font-size:13px;
                line-height:1.8;
                color:#655e70;
                margin-top:23px;
              ">
                Si vous n'avez pas demandé ce changement,
                ignorez cet e-mail.
                Votre mot de passe restera inchangé.
              </p>

              <div style="
                border-top:1px solid #eee9f3;
                padding-top:22px;
                margin-top:30px;
                color:#938a9e;
                font-size:12px;
              ">
                Portrélia — La photographie professionnelle,
                simplifiée.
              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

module.exports = {
  passwordResetEmail,
};
