// server.mjs — Memory + Realtime + Profile + Notes + Snapshot (hardened)
import express from "express";
import path from "path";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

// ---------- Setup ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Upstash Redis REST (for memory)
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ---------- Static UI ----------
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "client.html")));
app.get("/client.html", (_, res) => res.sendFile(path.join(__dirname, "client.html")));

// ---------- Redis helpers ----------
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? data.value ?? null;
}
async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return res.ok;
}
async function redisLPush(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(
    `${UPSTASH_URL}/lpush/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return res.ok;
}
async function redisLRange(key, start = 0, stop = -1) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return [];
  const res = await fetch(
    `${UPSTASH_URL}/lrange/${encodeURIComponent(key)}/${start}/${stop}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.result ?? [];
}
async function redisDel(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.ok;
}

// ---------- Keys ----------
const profileKey = (userId) => `mem:${userId}:profile`;
const notesKey   = (userId) => `mem:${userId}:notes`;

// ---------- Profile Memory API ----------
app.get("/memory/get", async (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.json({ ok: true, memory: {} });
  const raw = await redisGet(profileKey(userId));
  let profile = {};
  try { profile = raw ? JSON.parse(raw) : {}; } catch { profile = {}; }
  return res.json({ ok: true, memory: profile });
});

app.all("/memory/set", async (req, res) => {
  const userId = (req.query.userId || req.body.userId || "").trim();
  const key    = (req.query.key    || req.body.key    || "").trim();
  const value  = (req.query.value  || req.body.value  || "").trim();
  if (!userId || !key) return res.json({ ok: false, saved: false, error: "missing_user_or_key" });

  const raw = await redisGet(profileKey(userId));
  let profile = {};
  try { profile = raw ? JSON.parse(raw) : {}; } catch { profile = {}; }
  profile[key] = value;

  const ok = await redisSet(profileKey(userId), JSON.stringify(profile));
  return res.json({ ok, saved: ok, profile });
});

// ---------- Notes API ----------
app.post("/memory/notes/add", async (req, res) => {
  const { userId, text } = req.body || {};
  if (!userId || !text) return res.json({ ok: false, saved: false, error: "missing_user_or_text" });

  const ok = await redisLPush(notesKey(userId), text);
  // Best-effort trim to last 200 items
  try {
    await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["LTRIM", notesKey(userId), 0, 199])
    });
  } catch {}
  return res.json({ ok, saved: ok });
});

app.get("/memory/notes/list", async (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.json({ ok: true, notes: [] });
  const items = await redisLRange(notesKey(userId), 0, 19);
  return res.json({ ok: true, notes: items });
});

// Clear ONLY notes (keeps profile)
app.post("/memory/notes/clear", async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.json({ ok: false, cleared: false, error: "missing_user" });
  const ok = await redisDel(notesKey(userId));
  return res.json({ ok, cleared: ok });
});

// Legacy: clear both profile and notes
app.post("/memory/clea
