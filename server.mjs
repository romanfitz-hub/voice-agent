// server.mjs — stable token server (auto-reply enabled)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Basic CORS so the browser can call us
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Serve the client file(s) from project root (client.html, etc.)
app.use(express.static(__dirname));

// Convenience: visiting root serves client.html
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'client.html')));

// Create a short-lived Realtime session token for the browser
app.all('/session', async (_req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY (Render → Environment)' });
    }

    // ⬇⬇ IMPORTANT: create_response: true so it will speak when you speak
    const sessionConfig = {
      model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'verse',
      instructions:
        "You are Dummy, a concise, friendly voice assistant. Keep replies short unless asked. Speak when the user addresses you.",
      turn_detection: {
        type: 'server_vad',
        threshold: 0.75,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: true,          // <-- was false; now true
        interrupt_response: true
      }
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
