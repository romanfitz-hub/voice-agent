// server.mjs — minimal cloud server for OpenAI Realtime
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());

// Serve static files (client.html) from this folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// Health check
app.get('/', (_req, res) => res.type('text/plain').send('ok'));

// Issue an ephemeral client secret for the browser to open a WebRTC session
app.post('/session', async (_req, res) => {
  try {
    const body = {
      model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
      voice: 'alloy',
      modalities: ['audio', 'text'],
      output_audio_format: 'pcm16',
      input_audio_format: 'pcm16',
      input_audio_transcription: { model: 'gpt-4o-transcribe' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        silence_duration_ms: 200,
        create_response: true,
        interrupt_response: true
      },
      instructions: `You are Roman's fast, friendly voice assistant. Be concise and helpful.`
    };

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const j = await r.json();
    if (!r.ok) {
      console.error('OpenAI session error:', j);
      return res.status(500).json(j);
    }
    res.json(j);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 8090;
app.listen(port, () => console.log(`Session server running on http://localhost:${port}`));







