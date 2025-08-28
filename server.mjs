// server.mjs — minimal token server + static hosting

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// Simple CORS so the demo UI works from anywhere
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Serve static files from the repo root (so /client.html works)
app.use(express.static(__dirname));

/**
 * GET /session  -> returns a short-lived client_secret from OpenAI
 * The browser uses this secret to talk to Realtime.
 */
app.get('/session', async (_req, res) => {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview',
        voice: 'alloy',
        modalities: ['audio', 'text'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'gpt-4o-transcribe' }
      })
    });

    const json = await r.json();
    if (!r.ok) {
      console.error('Session error:', json);
      return res.status(r.status).json(json);
    }
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server up on :${port}`));
