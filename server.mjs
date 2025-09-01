// server.mjs
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { OpenAI } from "openai";

// ----- Env -----
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Upstash (memory)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// ----- App -----
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // if you serve any static files

// ---------- Helpers ----------
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ?? null;
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  try {
    const res = await fetch(
      `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Memory API ----------
app.get("/memory/get", async (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.json({ ok: true, memory: {} });

  const raw = (await redisGet(`mem:${userId}`)) || "{}";
  let memory = {};
  try {
    memory = JSON.parse(raw);
  } catch {}
  return res.json({ ok: true, memory });
});

app.get("/memory/set", async (req, res) => {
  const userId = (req.query.userId || "").trim();
  const key = (req.query.key || "").trim();
  const value = (req.query.value || "").trim();
  if (!userId || !key) return res.json({ ok: false, saved: false });

  const raw = (await redisGet(`mem:${userId}`)) || "{}";
  let memory = {};
  try {
    memory = JSON.parse(raw);
  } catch {}
  memory[key] = value;

  const saved = await redisSet(`mem:${userId}`, JSON.stringify(memory));
  return res.json({ ok: saved, saved });
});

// ---------- Session (OpenAI Realtime) ----------
app.post("/session", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // user id can be in body or query (page sends query)
    const userIdRaw = (req.query.userId || req.body?.userId || "anon").toString();

    // IMPORTANT: sanitize ONLY for the OpenAI "user" tag (pattern-safe, <=64)
    const userTag = userIdRaw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // (Optional) pull memory and send as session instructions prefix
    let memoryNote = "";
    const memRaw = (await redisGet(`mem:${userIdRaw}`)) || "{}";
    try {
      const mem = JSON.parse(memRaw);
      const parts = [];
      if (mem.name) parts.push(`User name: ${mem.name}`);
      if (mem.kids) parts.push(`Kids: ${mem.kids}`);
      if (mem.tone) parts.push(`Preferred tone: ${mem.tone}`);
      if (mem.persona) parts.push(`Persona: ${mem.persona}`);
      if (parts.length) {
        memoryNote =
          "\n\n[Memory]\n" +
          parts.join("\n") +
          "\n[/Memory]\n";
      }
    } catch {}

    const session = await client.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
      instructions:
        "You are Dummy, a concise, friendly voice assistant. Keep replies short unless asked. Speak when the user addresses you." +
        memoryNote,
      user: userTag, // <- safe string
    });

    // Return just what the client needs
    return res.json({
      client_secret: session.client_secret, // { type, value, expires_at } object
    });
  } catch (err) {
    console.error("session error:", err);
    return res.status(400).json({ error: "session_create_failed" });
  }
});

// ---------- Root (serves client.html in repo root) ----------
app.get("/", (req, res) => {
  // If your client.html is at repo root:
  res.sendFile(process.cwd() + "/client.html");
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server on :${PORT}`);
});
