

const express = require("express")
const cors = require("cors")
const cookieParser = require("cookie-parser");
const { dbConnect } = require("./config/db");
const router = require("./routes/routes");




require("dotenv").config();

const app = express()

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(cookieParser())

dbConnect();



// Public + auth
app.use("/api/v1", router);

// Admin
app.use("/api/v1/admin", require("./routes/adminRoutes"));

// Entreprise
app.use("/api/v1/company", require("./routes/companyRoutes"));

// Participant
app.use("/api/v1/participant",require("./routes/participantRoutes"));
const start = async () => {
  try {
    
    app.listen(process.env.PORT, () => {
  console.log(`Auth service running on http://localhost:${process.env.PORT}   ` )
})

  } catch (err) {
    console.error("❌ Auth service failed:", err);
    process.exit(1);
  }
};

start();

