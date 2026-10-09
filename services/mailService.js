require("dotenv").config();
const sendMail = async ({
  to,
  subject,
  html,
}) => {
  console.log(
    "BREVO KEY LOADED:",
    !!process.env.BREVO_API_KEY
  );

  console.log(
    "BREVO URL:",
    process.env.BREVO_API_URL
  );

  console.log(
    "BREVO SENDER:",
    process.env.BREVO_SENDER_EMAIL
  );

  const response = await fetch(
    process.env.BREVO_API_URL,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name:
            process.env.BREVO_SENDER_NAME,
          email:
            process.env.BREVO_SENDER_EMAIL,
        },
        to: [
          {
            email: to,
          },
        ],
        subject,
        htmlContent: html,
      }),
    }
  );

  if (!response.ok) {
    const error =
      await response.json();

    console.error(
      "Erreur Brevo :",
      error
    );

    throw new Error(
      error.message ||
        "Erreur envoi email Brevo"
    );
  }

  return response.json();
};

module.exports = {
  sendMail,
};