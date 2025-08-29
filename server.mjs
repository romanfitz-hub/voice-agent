// server.mjs — complete working server for the Realtime demo

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Basic CORS so the page works anywhere
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Serve static files from this repo root (so /client.html works)
app.use(express.static(__dirname));

// Redirect root to the demo page for convenience
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// ---- Realtime session endpoint ----
// Accept BOTH GET and POST so the client can't 404.
app.all('/session', async (_req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server' });
    }

    const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        // you can tweak these defaults if you like
        voice: 'verse'
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    return res.json(data);
  } catch (err) {
    console.error('SESSION ERROR:', err);
    res.status(500).json({ error: err?.message || 'server error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server up on :${PORT}`));
