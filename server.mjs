// server.mjs — robust static serving + token endpoint for Render

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = express();

// --- CORS so the client can call /session ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(express.json());

// --- Paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from root AND (if present) from /client
app.use(express.static(__dirname));
const clientDir = path.join(__dirname, 'client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

// Resolve where client.html actually is
function resolveClientHtml() {
  const rootClient = path.join(__dirname, 'client.html');
  const nestedClient = path.join(clientDir, 'client.html');
  if (fs.existsSync(rootClient)) return rootClient;
  if (fs.existsSync(nestedClient)) return nestedClient;
  return null;
}

// Serve the UI
app.get(['/', '/client.html'], (_req, res) => {
  const file = resolveClientHtml();
  if (!file) return res.status(404).send('client.html not found in repo');
  res.sendFile(file);
});

// --- Token/session endpoint ---
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

// --- Start ---
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Session server on http://localhost:${port}`);
});








