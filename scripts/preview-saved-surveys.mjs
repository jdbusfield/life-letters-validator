// Local visual QA only. Memory data, no production credentials, and loopback binding.
import express from "express";
import { fileURLToPath } from "node:url";
import { memoryDatabase } from "../test/survey-fixture.js";
import { createSurveyRouter } from "../routes/surveys.js";
import apiRoutes from "../routes/api.js";
const db = memoryDatabase();
process.env.PUBLIC_BASE_URL = "http://127.0.0.1:8770";
process.env.REQUIRE_SURVEY_ACCESS = "true";
const app = express().use(express.json()).use((req, _res, next) => { req.session = { isAdmin: req.path.startsWith("/api/admin/") }; next(); });
app.get("/api/admin/check", (_req, res) => res.json({ authenticated: true }));
app.get("/api/admin/orders", (_req, res) => res.json({ orders: db.tables.orders, total: db.tables.orders.length }));
app.use(createSurveyRouter({ db, generatePDF: async () => {}, validate: async entries => Object.fromEntries(entries.map(entry => [entry.letter, { valid: true }])) }));
app.use(apiRoutes);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
app.get("/admin", (_req, res) => res.sendFile(fileURLToPath(new URL("../public/admin.html", import.meta.url))));
app.listen(8770, "127.0.0.1", () => console.log("Saved-survey QA at http://127.0.0.1:8770/admin (sample data only)"));
