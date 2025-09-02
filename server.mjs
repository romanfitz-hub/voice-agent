// server.mjs — REST only (no SDK). Metadata removed.

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// ---- Upstash helpers (REST)
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!r.ok) return null;
  try { const j = await r.json(); return j?.result ?? null; } catch { return null; }
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const r = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return r.ok;
}

// ---- static client
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

// ---- memory API
app.get("/memory/get", async (req, res) => {
  const userId = (req.query.userId || "").toString().trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  let memory = {};
  const raw = await redisGet(`user:${userId}`);
  if (raw) { try { memory = JSON.parse(raw) || {}; } catch {} }
  res.json({ ok: true, memory });
});

app.get("/memory/set", async (req, res) => {
  const userId = (req.query.userId || "").toString().trim();
  const field = (req.query.field || "").toString().trim();
  const value = (req.query.value || "").toString().trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  if (!field) return res.status(400).json({ error: "Missing field" });

  const key = `user:${userId}`;
  let obj = {};
  const existing = await redisGet(key);
  if (existing) { try { obj = JSON.parse(existing) || {}; } catch {} }
  obj[field] = value;

  const saved = await redisSet(key, JSON.stringify(obj));
  res.json({ ok: saved, saved });
});

// ---- session API (Realtime REST)
app.get("/session", async (req, res) => {
  console.log("SESSION ROUTE: USING_FETCH_FOR_SESSION");
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const userId = (req.query.userId || "").toString().trim();
    let name = "";
    if (userId) {
      const raw = await redisGet(`user:${userId}`);
      if (raw) { try { const m = JSON.parse(raw); if (m?.name) name = m.name; } catch {} }
    }

    const instructions = [
      "You are Dummy, a concise, friendly voice assistant.",
      "Keep replies short unless asked.",
      "Speak when the user addresses you.",
      name ? `The user's name is ${name}. Greet them by name.` : "",
    ].filter(Boolean).join(" ");

    const body = {
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
      modalities: ["audio", "text"],
      instructions,
      tool_choice: "auto",
      turn_detection: { type: "server_vad", threshold: 0.8 }
      // (no metadata — the API rejected it)
    };

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("SESSION CREATE FAILED (REST):", detail);
      return res.status(500).json({ error: "session_create_failed", detail });
    }

    const json = await r.json();
    return res.json(json);
  } catch (err) {
    console.error("SESSION ROUTE ERROR:", err);
    return res.status(500).json({ error: "session_create_failed", detail: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Dummy server listening on :${PORT}`);
});
