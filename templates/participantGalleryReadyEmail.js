/*
 * =========================================================
 * PARTICIPANT GALLERY READY EMAIL
 * =========================================================
 */

const escapeHtml =
  (value = "") =>
    String(value)
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );

const participantGalleryReadyEmail =
  ({
    firstName,
    galleryUrl,
    expiresAtLabel,
  }) => {
    const safeFirstName =
      escapeHtml(
        firstName ||
          ""
      );

    const safeGalleryUrl =
      escapeHtml(
        galleryUrl
      );

    const safeExpiresAtLabel =
      escapeHtml(
        expiresAtLabel ||
          ""
      );

    return `
      <!DOCTYPE html>

      <html lang="fr">

        <head>
          <meta charset="UTF-8" />

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />

          <title>
            Vos portraits Portrélia sont prêts
          </title>
        </head>

        <body
          style="
            margin:0;
            padding:0;
            background:#f6f4f7;
            color:#2d2033;
            font-family:Arial, Helvetica, sans-serif;
          "
        >

          <table
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            role="presentation"
          >

            <tr>

              <td
                align="center"
                style="
                  padding:40px 16px;
                "
              >

                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  role="presentation"
                  style="
                    width:100%;
                    max-width:600px;
                    overflow:hidden;
                    border-radius:20px;
                    background:#ffffff;
                    box-shadow:0 14px 35px rgba(55,15,86,0.08);
                  "
                >

                  <!-- HEADER -->

                  <tr>

                    <td
                      style="
                        padding:
                          32px
                          36px
                          22px;
                        background:#370f56;
                      "
                    >

                      <div
                        style="
                          margin-bottom:22px;
                          color:#ffffff;
                          font-size:22px;
                          font-weight:800;
                          letter-spacing:-0.02em;
                        "
                      >
                        Portrélia
                      </div>

                      <div
                        style="
                          margin-bottom:8px;
                          color:#d6c3e8;
                          font-size:11px;
                          font-weight:700;
                          letter-spacing:0.12em;
                          text-transform:uppercase;
                        "
                      >
                        Votre galerie est prête
                      </div>

                      <h1
                        style="
                          margin:0;
                          color:#ffffff;
                          font-size:28px;
                          line-height:1.25;
                          letter-spacing:-0.03em;
                        "
                      >
                        Vos portraits sont prêts.
                      </h1>

                    </td>

                  </tr>

                  <!-- CONTENT -->

                  <tr>

                    <td
                      style="
                        padding:34px 36px;
                      "
                    >

                      <p
                        style="
                          margin:0 0 18px;
                          color:#33283a;
                          font-size:15px;
                          line-height:1.7;
                        "
                      >
                        Bonjour ${
                          safeFirstName ||
                          ""
                        },
                      </p>

                      <p
                        style="
                          margin:0 0 18px;
                          color:#655b6b;
                          font-size:14px;
                          line-height:1.75;
                        "
                      >
                        Bonne nouvelle : notre équipe vient de terminer
                        le contrôle qualité de vos portraits professionnels.
                      </p>

                      <p
                        style="
                          margin:0 0 28px;
                          color:#655b6b;
                          font-size:14px;
                          line-height:1.75;
                        "
                      >
                        Vous pouvez maintenant découvrir les portraits
                        retenus et sélectionner celui que vous préférez.
                      </p>

                      <!-- BUTTON -->

                      <table
                        cellpadding="0"
                        cellspacing="0"
                        border="0"
                        role="presentation"
                        style="
                          margin:0 auto 28px;
                        "
                      >

                        <tr>

                          <td
                            align="center"
                            style="
                              border-radius:12px;
                              background:#5632a8;
                            "
                          >

                            <a
                              href="${safeGalleryUrl}"
                              target="_blank"
                              rel="noopener noreferrer"
                              style="
                                display:inline-block;
                                padding:15px 24px;
                                color:#ffffff;
                                font-size:14px;
                                font-weight:700;
                                text-decoration:none;
                              "
                            >
                              Découvrir mes portraits
                            </a>

                          </td>

                        </tr>

                      </table>

                      <!-- INFO -->

                      <div
                        style="
                          padding:16px 18px;
                          border:1px solid #ebe5f0;
                          border-radius:12px;
                          background:#faf8fc;
                        "
                      >

                        <div
                          style="
                            margin-bottom:5px;
                            color:#3c2c45;
                            font-size:12px;
                            font-weight:700;
                          "
                        >
                          Galerie personnelle et sécurisée
                        </div>

                        <div
                          style="
                            color:#837989;
                            font-size:12px;
                            line-height:1.6;
                          "
                        >
                          Votre galerie reste accessible jusqu'au
                          ${safeExpiresAtLabel}.
                        </div>

                      </div>

                      <p
                        style="
                          margin:26px 0 0;
                          color:#8b818f;
                          font-size:11px;
                          line-height:1.6;
                        "
                      >
                        Si le bouton ne fonctionne pas, vous pouvez
                        copier ce lien dans votre navigateur :
                      </p>

                      <p
                        style="
                          margin:6px 0 0;
                          overflow-wrap:anywhere;
                          color:#5632a8;
                          font-size:11px;
                          line-height:1.5;
                        "
                      >
                        ${safeGalleryUrl}
                      </p>

                    </td>

                  </tr>

                  <!-- FOOTER -->

                  <tr>

                    <td
                      style="
                        padding:
                          20px
                          36px
                          28px;
                        border-top:
                          1px solid
                          #eee9f1;
                      "
                    >

                      <p
                        style="
                          margin:0;
                          color:#9a919e;
                          font-size:10px;
                          line-height:1.6;
                        "
                      >
                        Cet email concerne votre galerie personnelle
                        Portrélia. Ne partagez pas ce lien publiquement.
                      </p>

                    </td>

                  </tr>

                </table>

              </td>

            </tr>

          </table>

        </body>

      </html>
    `;
  };

module.exports = {
  participantGalleryReadyEmail,
};