// server.mjs
// A single-file Express server for your Voice Agent
// - Serves client.html
// - Creates short-lived OpenAI Realtime sessions (/session)
// - Simple Upstash-Redis memory via REST (/memory/get, /memory/set)

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

// Render/Node 18+ has global fetch.
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Upstash Redis REST (for memory)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL; // e.g. https://us1-shiny-12345.upstash.io
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Small helper to call Upstash REST
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json(); // { result: "value" }
  try {
    return data.result ? JSON.parse(data.result) : null;
  } catch {
    return data.result ?? null;
  }
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(
      JSON.stringify(value)
    )}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return res.ok;
}

// ---------- Health ----------
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- Serve client ----------
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "client.html"))
);
app.get("/client.html", (_req, res) =>
  res.sendFile(path.join(__dirname, "client.html"))
);

// ---------- OpenAI Realtime session ----------
app.post("/session", async (_req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const sessionRes = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          modalities: ["audio", "text"],
          // These defaults are safe; the client can still set VAD/params.
          voice: "verse",
          output_audio_format: "pcm16",
          tool_choice: "auto",
          temperature: 0.8,
          max_response_output_tokens: "inf",
          // Keep the assistant brief unless asked:
          instructions:
            "You are Dummy, a concise, friendly voice assistant. Keep replies short unless asked. Speak when the user addresses you.",
        }),
      }
    );

    if (!sessionRes.ok) {
      const text = await sessionRes.text();
      return res.status(sessionRes.status).send(text);
    }

    const json = await sessionRes.json();
    // Should include client_secret.value and expires_at
    return res.json(json);
  } catch (e) {
    console.error("POST /session error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ---------- Memory (simple GET endpoints for Safari & the panel) ----------
app.get("/memory/get", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const key = `memory:${userId}`;
    const value = (await redisGet(key)) ?? {};
    return res.json({ ok: true, memory: value });
  } catch (e) {
    console.error("GET /memory/get error:", e);
    return res.status(500).json({ error: e.message });
  }
});

app.get("/memory/set", async (req, res) => {
  try {
    const { userId, name, kids, tone, persona, note } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const key = `memory:${userId}`;
    const current = (await redisGet(key)) ?? {};

    if (name) current.name = name;
    if (kids)
      current.kids = kids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (tone) current.tone = tone;
    if (persona) current.persona = persona;
    if (note) {
      current.notes = Array.isArray(current.notes) ? current.notes : [];
      current.notes.push(note);
    }

    await redisSet(key, current);
    return res.json({ ok: true, memory: current });
  } catch (e) {
    console.error("GET /memory/set error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Voice Agent server listening on http://localhost:${PORT}`);
});
