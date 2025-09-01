// server.mjs
import express from "express";
import path from "path";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

// ----- setup paths -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Render/Node has global fetch
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Upstash Redis REST (for memory)
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;   // e.g. https://us1-shiny-12345.upstash.io
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN; // Bearer token

// --- tiny helpers to call Upstash REST ---
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json(); // { result: "value" }
  return data?.result ?? null;
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return res.ok;
}

const userKey = (userId, field) => `user:${userId}:${field}`;

// ---- Memory API ----

// GET /memory/get?userId=UUID
app.get("/memory/get", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const name    = await redisGet(userKey(userId, "name"));
  const kids    = await redisGet(userKey(userId, "kids"));
  const tone    = await redisGet(userKey(userId, "tone"));
  const persona = await redisGet(userKey(userId, "persona"));

  const memory = {};
  if (name) memory.name = name;
  if (kids) memory.kids = kids;
  if (tone) memory.tone = tone;
  if (persona) memory.persona = persona;

  return res.json({ ok: true, memory });
});

// POST /memory/set  { userId, key, value }
app.post("/memory/set", async (req, res) => {
  const { userId, key, value } = req.body || {};
  if (!userId || !key) return res.status(400).json({ error: "Missing userId or key" });
  const ok = await redisSet(userKey(userId, key), String(value ?? ""));
  return res.json({ ok, saved: ok });
});

// NEW: GET version for easy testing
// /memory/set?userId=UUID&key=name&value=Roman
app.get("/memory/set", async (req, res) => {
  const { userId, key, value } = req.query || {};
  if (!userId || !key) return res.status(400).json({ error: "Missing userId or key" });
  const ok = await redisSet(userKey(userId, key), String(value ?? ""));
  return res.json({ ok, saved: ok });
});

// serve client
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

app.listen(PORT, () => {
  console.log(`Voice agent server on :${PORT}`);
});
