// server.mjs
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { OpenAI } from "openai";

const PORT = process.env.PORT || 3000;

// === Required envs ===
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// --- Express ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Serve client.html at root
app.get("/", (req, res) => res.sendFile(process.cwd() + "/client.html"));

// ------------ Upstash helpers ------------
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.result ?? null;
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  try {
    const r = await fetch(
      `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(
        value
      )}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
    );
    return r.ok;
  } catch {
    return false;
  }
}

// ------------ Memory API ------------
app.get("/memory/get", async (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.json({ ok: true, memory: {} });

  const raw = (await redisGet(`mem:${userId}`)) || "{}";
  let memory = {};
  try {
    memory = JSON.parse(raw);
  } catch {}
  res.json({ ok: true, memory });
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
  res.json({ ok: saved, saved });
});

// ------------ Session (OpenAI Realtime) ------------
async function createSession(req, res) {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const userId = (req.query.userId || req.body?.userId || "anon").toString();

    // Pull memory and include it in instructions
    let memoryNote = "";
    const raw = (await redisGet(`mem:${userId}`)) || "{}";
    try {
      const mem = JSON.parse(raw);
      const parts = [];
      if (mem.name) parts.push(`User name: ${mem.name}`);
      if (mem.kids) parts.push(`Kids: ${mem.kids}`);
      if (mem.tone) parts.push(`Preferred tone: ${mem.tone}`);
      if (mem.persona) parts.push(`Persona: ${mem.persona}`);
      if (parts.length) {
        memoryNote = "\n\n[Memory]\n" + parts.join("\n") + "\n[/Memory]\n";
      }
    } catch {}

    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // IMPORTANT: do NOT send 'user' field at all (avoids any pattern checks)
    const session = await client.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
      instructions:
        "You are Dummy, a concise, friendly voice assistant. Keep replies short unless asked. Speak when the user addresses you." +
        memoryNote,
    });

    // Return only what the client needs
    res.json({
      client_secret: session.client_secret, // { type, value, expires_at }
    });
  } catch (e) {
    console.error("SESSION ERROR:", e);
    // Echo a helpful error to the browser so we can see it if needed
    res.status(400).json({ error: "session_create_failed", detail: String(e) });
  }
}

// Accept both GET and POST so we can test in the browser
app.get("/session", createSession);
app.post("/session", createSession);

// ---------- Start ----------
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
