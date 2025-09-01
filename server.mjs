// server.mjs
import express from "express";
import cors from "cors";
import path from "path";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

// ------------ setup ------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Render/Node 18+ has global fetch.
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Upstash Redis REST (for memory)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;   // e.g. https://us1-shiny-12345.upstash.io
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// --- Upstash helpers ---
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json(); // { result: "value" }
  return data.result ?? null;
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return res.ok;
}

// -------- Memory API --------
// GET /memory/get?userId=...
app.get("/memory/get", async (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const key = `mem:${userId}`;
  const raw = await redisGet(key);
  let memory = {};
  try { if (raw) memory = JSON.parse(raw); } catch {}
  res.json({ ok: true, memory });
});

// POST /memory/set { userId, patch }  OR  { userId, key, value }
app.post("/memory/set", async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  // Accept either {key,value} or {patch:{...}}
  let patch = {};
  if (req.body && typeof req.body === "object") {
    if (req.body.patch && typeof req.body.patch === "object") patch = req.body.patch;
    if (req.body.key) patch[req.body.key] = req.body.value;
  }

  // Normalize a few fields
  if (typeof patch.kids === "string") {
    patch.kids = patch.kids.split(",").map(s => s.trim()).filter(Boolean);
  }

  const key = `mem:${userId}`;
  const raw = await redisGet(key);
  let current = {};
  try { if (raw) current = JSON.parse(raw); } catch {}

  const next = { ...current, ...patch };
  await redisSet(key, JSON.stringify(next));

  res.json({ ok: true, memory: next });
});

// -------- Static UI --------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

// health
app.get("/healthz", (_, res) => res.json({ ok: true }));

// start
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
