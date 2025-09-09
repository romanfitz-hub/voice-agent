// server.mjs
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

// Render/Node has global fetch.
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Upstash Redis REST (for memory)
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;   // e.g. https://grand-swine-49302.upstash.io
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN; // long token

// ----- Upstash helpers (simple REST) -----
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
  const data = await res.json(); // { result: [ ... ] }
  return data.result ?? [];
}
async function redisDel(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.ok;
}

// ---------- Memory keys ----------
const profileKey = (userId) => `mem:${userId}:profile`;
const notesKey   = (userId) => `mem:${userId}:notes`;

// ---------- Static UI ----------
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "client.html")));

// ---------- Memory API ----------
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

app.post("/memory/notes/add", async (req, res) => {
  const { userId, text } = req.body || {};
  if (!userId || !text) return res.json({ ok: false, saved: false, error: "missing_user_or_text" });

  const ok = await redisLPush(notesKey(userId), text);
  // optional best-effort trim to last 200
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
  const items = await redisLRange(notesKey(userId), 0, -1);
  return res.json({ ok: true, notes: items });
});

app.post("/memory/clear", async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.json({ ok: false, cleared: false, error: "missing_user" });
  const ok1 = await redisDel(profileKey(userId));
  const ok2 = await redisDel(notesKey(userId));
  return res.json({ ok: ok1 && ok2, cleared: ok1 && ok2 });
});

// ---------- Realtime session (explicit HTTP call w/ Beta header) ----------
app.get("/session", async (req, res) => {
  try {
    const userId = (req.query.userId || "").trim();

    // Load profile + notes to personalize instructions
    let profile = {};
    try {
      const raw = userId ? await redisGet(profileKey(userId)) : null;
      profile = raw ? JSON.parse(raw) : {};
    } catch { profile = {}; }

    const notes = userId ? await redisLRange(notesKey(userId), 0, 19) : [];
    const notesBlurb = notes.length
      ? "Known facts about the user:\n- " + notes.slice(0, 20).join("\n- ")
      : "";

    const name    = profile.name || "there";
    const tone    = profile.tone || "friendly, concise";
    const persona = profile.persona || "helpful buddy";
    const kids    = profile.kids || "";

    const instructions = [
      `You are Dummy, a concise, friendly voice assistant.`,
      `Greet the user by name (${name}) when it fits.`,
      `Tone: ${tone}. Persona: ${persona}.`,
      kids ? `Kids: ${kids}.` : null,
      notesBlurb
    ].filter(Boolean).join("\n");

    // Call the Realtime Sessions HTTP endpoint directly
    const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "verse",
        instructions
      })
    });

    const session = await resp.json();
    if (!resp.ok) {
      console.error("SESSION CREATE FAILED:", session);
      return res.status(500).json({ error: "session_create_failed", detail: session });
    }
    // Must include client_secret for the browser to connect
    if (!session.client_secret || !session.client_secret.value) {
      console.error("SESSION MISSING client_secret:", session);
      return res.status(500).json({ error: "session_missing_client_secret", detail: session });
    }

    res.json(session);
  } catch (err) {
    console.error("SESSION ERROR:", err);
    res.status(500).json({ error: "session_create_failed", detail: String(err) });
  }
});

// ---------- Start ----------
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
