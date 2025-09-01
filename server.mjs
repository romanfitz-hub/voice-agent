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

// Render/Node 18+ has global fetch.
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Upstash Redis REST (for memory)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL; // e.g. https://us1-shiny-12345.upstash.io
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// A small helper to call Upstash REST
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json(); // { result: "value" }
  return data.result ?? null;
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(
      value
    )}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
  return res.ok;
}

// Build instruction text from saved memory
function memoryToInstructions(mem) {
  if (!mem) return "";
  const bits = [];
  if (mem.name) bits.push(`User's name is ${mem.name}. Address them by name.`);
  if (Array.isArray(mem.kids) && mem.kids.length) {
    bits.push(`User has children: ${mem.kids.join(", ")}.`);
  }
  if (mem.tone)
    bits.push(`Use this tone with the user: ${mem.tone}.`);
  if (mem.persona)
    bits.push(`Adopt this persona: ${mem.persona}.`);
  if (Array.isArray(mem.notes) && mem.notes.length) {
    bits.push(`Keep in mind: ${mem.notes.join(" | ")}.`);
  }
  return bits.join(" ");
}

// ---------- Memory API ----------
// GET /memory/get?userId=abc
app.get("/memory/get", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const raw = await redisGet(`mem:${userId}`);
    const mem = raw ? JSON.parse(raw) : {};
    return res.json({ ok: true, memory: mem });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /memory/set
// body: { userId, name?, kids? (string or array), tone?, persona?, note? (single note to add) }
app.post("/memory/set", async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Load current memory
    const raw = await redisGet(`mem:${userId}`);
    const current = raw ? JSON.parse(raw) : {};

    // Merge updates
    const next = { ...current };
    if (typeof req.body.name === "string") next.name = req.body.name.trim();

    if (Array.isArray(req.body.kids)) {
      next.kids = req.body.kids.map((k) => String(k).trim()).filter(Boolean);
    } else if (typeof req.body.kids === "string") {
      next.kids = req.body.kids
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    }

    if (typeof req.body.tone === "string") next.tone = req.body.tone.trim();
    if (typeof req.body.persona === "string")
      next.persona = req.body.persona.trim();

    if (typeof req.body.note === "string" && req.body.note.trim()) {
      next.notes = Array.isArray(next.notes) ? next.notes : [];
      next.notes.push(req.body.note.trim());
    }

    await redisSet(`mem:${userId}`, JSON.stringify(next));
    return res.json({ ok: true, memory: next });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Realtime session token endpoint ----------
// The client calls this to get a short-lived client_secret for WebRTC
app.post("/session", async (req, res) => {
  try {
    const { userId } = req.body || {};
    // Look up memory for this user and blend into instructions
    let mem = null;
    if (userId) {
      const raw = await redisGet(`mem:${userId}`);
      mem = raw ? JSON.parse(raw) : null;
    }

    const memoryText = memoryToInstructions(mem);

    const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        // Your base agent settings:
        voice: "verse",
        modalities: ["audio", "text"],
        turn_detection: {
          type: "server_vad",
          threshold: 0.75,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
          create_response: false,
          interrupt_response: true,
        },
        // Fold memory into the system instructions:
        instructions:
          "You are Dummy, a concise, friendly voice assistant. Keep replies short unless asked. Speak when the user addresses you. " +
          (memoryText ? `Personalization: ${memoryText}` : ""),
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: `OpenAI error: ${text}` });
    }

    const data = await resp.json();
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ---------- Static files ----------
app.use(express.static(__dirname)); // serve client.html and assets from repo root

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
