// server.mjs — full file

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

// ---- paths ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- app ----
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---- env ----
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// ---- tiny helpers for Upstash REST (memory) ----
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!r.ok) return null;
  const j = await r.json(); // { result: "..." } or { result: null }
  return j?.result ?? null;
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const r = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return r.ok;
}

// ---- static client ----
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

// ---- memory API ----
// GET /memory/get?userId=...
app.get("/memory/get", async (req, res) => {
  const userId = (req.query.userId || "").toString().trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const raw = await redisGet(`user:${userId}`);
  let memory = {};
  try {
    if (raw) memory = JSON.parse(raw);
  } catch (_) {}
  res.json({ ok: true, memory });
});

// GET /memory/set?userId=...&field=name&value=Roman
app.get("/memory/set", async (req, res) => {
  const userId = (req.query.userId || "").toString().trim();
  const field = (req.query.field || "").toString().trim();
  const value = (req.query.value || "").toString().trim();

  if (!userId) return res.status(400).json({ error: "Missing userId" });
  if (!field) return res.status(400).json({ error: "Missing field" });

  const key = `user:${userId}`;
  let obj = {};
  const existing = await redisGet(key);
  if (existing) {
    try {
      obj = JSON.parse(existing) || {};
    } catch (_) {}
  }
  obj[field] = value;

  const saved = await redisSet(key, JSON.stringify(obj));
  res.json({ ok: saved, saved });
});

// ---- session API (uses REST, not SDK) ----
// GET /session?userId=...
app.get("/session", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const userId = (req.query.userId || "").toString().trim();
    const key = userId ? `user:${userId}` : null;

    // pull memory to personalize the instructions
    let name = "";
    try {
      if (key) {
        const raw = await redisGet(key);
        if (raw) {
          const m = JSON.parse(raw);
          if (m?.name) name = m.name;
        }
      }
    } catch (_) {}

    const instructions = [
      "You are Dummy, a concise, friendly voice assistant.",
      "Keep replies short unless asked.",
      "Speak when the user addresses you.",
      name ? `The user's name is ${name}. Greet them by name.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const body = {
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
      modalities: ["audio", "text"],
      instructions,
      tool_choice: "auto",
      turn_detection: { type: "server_vad", threshold: 0.8 },
      metadata: userId ? { userId } : undefined,
    };

    // Call REST directly — avoids SDK incompat issues
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
      return res
        .status(500)
        .json({ error: "session_create_failed", detail });
    }

    const json = await r.json();
    return res.json(json);
  } catch (err) {
    return res
      .status(500)
      .json({ error: "session_create_failed", detail: String(err) });
  }
});

// ---- start ----
app.listen(PORT, () => {
  console.log(`Dummy server listening on :${PORT}`);
});
