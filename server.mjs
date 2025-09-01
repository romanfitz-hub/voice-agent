// server.mjs — Realtime token server + simple memory (Upstash Redis REST)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CORS (allow your page to call these endpoints)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Static files (serve client.html etc.)
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'client.html')));

/* -------------------- Memory store (Upstash REST) -------------------- */
const UURL = process.env.UPSTASH_REDIS_REST_URL;
const UTOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const okKV = !!(UURL && UTOKEN);

async function kvGet(key) {
  if (!okKV) return null;
  const r = await fetch(`${UURL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UTOKEN}` },
    cache: 'no-store'
  });
  const j = await r.json().catch(() => ({}));
  // Upstash returns: { result: "string or null" }
  if (!('result' in j) || j.result === null) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}

async function kvSet(key, val) {
  if (!okKV) return false;
  const value = encodeURIComponent(typeof val === 'string' ? val : JSON.stringify(val));
  const r = await fetch(`${UURL}/set/${encodeURIComponent(key)}/${value}`, {
    headers: { Authorization: `Bearer ${UTOKEN}` }
  });
  const j = await r.json().catch(() => ({}));
  return j.result === 'OK';
}

function userKey(userId) { return `dummy:mem:${userId}`; }

/* Basic schema we’ll store:
{
  profile: { name: "Your Name", kids: ["Ava", "Ben", "Chris"] },
  prefs:   { tone: "witty/concise", persona: "friendly coach" },
  notes:   ["freeform facts..."]
}
*/

// Merge helper
function deepMerge(base = {}, patch = {}) {
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
      out[k] = deepMerge(base[k] || {}, patch[k]);
    } else {
      out[k] = patch[k];
    }
  }
  return out;
}

/* -------------------- Memory API -------------------- */
// POST /mem/get { user_id }
app.post('/mem/get', async (req, res) => {
  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const mem = (await kvGet(userKey(user_id))) || {};
    res.json({ ok: true, memory: mem, persisted: !!okKV });
  } catch (e) {
    res.status(500).json({ error: e.message || 'mem/get error' });
  }
});

// POST /mem/put { user_id, patch }
app.post('/mem/put', async (req, res) => {
  try {
    const { user_id, patch } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object required' });

    const current = (await kvGet(userKey(user_id))) || {};
    const merged = deepMerge(current, patch);
    const ok = await kvSet(userKey(user_id), merged);
    res.json({ ok, memory: merged });
  } catch (e) {
    res.status(500).json({ error: e.message || 'mem/put error' });
  }
});

/* -------------------- Realtime session token -------------------- */
// Builds a short instruction from memory
function memoryToInstruction(mem = {}) {
  const parts = [];
  if (mem.profile?.name) parts.push(`User name: ${mem.profile.name}.`);
  if (mem.profile?.kids?.length) parts.push(`User has ${mem.profile.kids.length} kids: ${mem.profile.kids.join(', ')}.`);
  if (mem.prefs?.tone) parts.push(`Use this tone: ${mem.prefs.tone}.`);
  if (mem.prefs?.persona) parts.push(`Adopt this persona: ${mem.prefs.persona}.`);
  if (mem.notes?.length) parts.push(`Known facts: ${mem.notes.slice(-5).join(' ; ')}.`);
  if (!parts.length) return '';
  return `\n\nPERSONAL MEMORY:\n${parts.join(' ')}\nUse these details to personalize responses and remember updates when the user tells you new facts.`;
}

// POST /session  (optionally body: { user_id })
app.all('/session', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const userId = req.body?.user_id || req.query?.u || null;
    const mem = userId ? (await kvGet(userKey(userId))) || {} : {};
    const memInstr = memoryToInstruction(mem);

    const sessionConfig = {
      model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'verse',
      // Base instructions + memory summary
      instructions:
        "You are Dummy, a concise, friendly voice assistant. Keep replies short unless asked. Speak when the user addresses you." +
        memInstr,
      turn_detection: {
        type: 'server_vad',
        threshold: 0.75,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: true,
        interrupt_response: true
      }
      // tools/tool_choice omitted for simplicity; we can add later (save_memory calls)
    };

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sessionConfig)
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('SESSION ERROR:', err);
    res.status(500).json({ error: err?.message || 'server error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server up on :${PORT}`));
