// server.mjs — minimal token server + static client delivery

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

// Basic CORS for the client page + fetches
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(express.json());

// Resolve local file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the client at both "/" and "/client.html"
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'client.html')));
app.get('/client.html', (_req, res) => res.sendFile(path.join(__dirname, 'client.html')));

// Token/session endpoint called by the browser
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
        input_audio_transcription: { model: 'gpt-4o-transcribe' },
        tools: [
          {
            type: 'function',
            name: 'create_reminder',
            description: 'Create a reminder with natural language time',
            parameters: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                when: { type: 'string' }
              },
              required: ['text', 'when']
            }
          }
        ],
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200,
          create_response: true,
          interrupt_response: true
        }
      })
    });

    const json = await r.json();
    if (!r.ok) return res.status(r.status).json(json);
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Render provides PORT; default to 8080 locally
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Session server on http://localhost:${port}`);
});








