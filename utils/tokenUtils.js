const crypto = require("crypto");

const generateActivationToken = () => {
  return crypto
    .randomBytes(32)
    .toString("hex");
};

const hashToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};

const getActivationTokenExpiration = () => {
  return new Date(
    Date.now() +
      24 * 60 * 60 * 1000
  );
};

module.exports = {
  generateActivationToken,
  hashToken,
  getActivationTokenExpiration,
};