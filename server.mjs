// server.mjs — stable realtime token server with safer defaults
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Basic CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(__dirname));

// Convenience: hitting root serves client.html
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'client.html')));

// Mint short-lived client_secret for browser
app.all('/session', async (_req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // IMPORTANT: turn_detection.create_response = false to stop babbling
    const body = {
      model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'verse',
      instructions:
        "You are Dummy, a concise, friendly voice assistant. Do not speak unless the user clearly addresses you. Keep replies short unless asked.",
      turn_detection: {
        type: 'server_vad',
        threshold: 0.75,
        silence_duration_ms: 700,
        prefix_padding_ms: 300,
        create_response: false // <-- you only reply when triggered, not on every noise
      }
    };

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
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
