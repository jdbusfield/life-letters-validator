import express from "express";
import session from "express-session";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import multer from "multer";

import apiRoutes from "./routes/api.js";
import uploadRoutes from "./routes/upload.js";
import adminRoutes from "./routes/admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the project directory
dotenv.config({ path: join(__dirname, ".env") });

const app = express();

// Middleware
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "life-letters-default-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Static files
app.use(express.static(join(__dirname, "public")));

// Routes
app.use(apiRoutes);
app.use(uploadRoutes);
app.use(adminRoutes);

// Multer error handler
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ error: "File too large. Maximum size is 10 MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(
    `\n  Life Letters running at http://localhost:${PORT}\n`
  );
});
