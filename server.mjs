// server.mjs — complete file

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Lightweight CORS so the demo UI works anywhere
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Serve static files from the repo root (so /client.html works)
app.use(express.static(__dirname));

// Token endpoint: gets a short-lived client_secret from OpenAI
app.get('/session', async (_req, res) => {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: 'alloy',
        modalities: ['audio', 'text'],
        input_audio_transcription: { model: 'gpt-4o-transcribe' }
      })
    });

    const data = await r.json();
    if (!r.ok) {
      // Bubble up OpenAI error details to the browser
      res.status(r.status).json(data);
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Optional convenience: open root path to the UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// Render sets PORT in env; default to 8080 locally
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Session server on :${port}`);
});








