// server.mjs — full file (replace everything with this)

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Optional Supabase (memory). Safe if not configured.
let supabase = null;
try {
  const { createClient } = await import('@supabase/supabase-js');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
} catch { /* ignore if package not present */ }

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- CORS (simple & permissive for browser UI) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// --- Health check FIRST so it always works ---
app.get('/', (_req, res) => res.type('text/plain').send('ok'));

// --- Serve UI explicitly ---
app.get('/client.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// Also serve any other static files from this folder (favicon, images, etc.)
app.use(express.static(__dirname));

// --- OpenAI Realtime session token endpoint ---
app.get('/session', async (_req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

    const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        voice: 'alloy',
        modalities: ['audio', 'text'],
        // Audio in/out format your client.html expects:
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'gpt-4o-transcribe' },
        // Simple tool example (safe to leave here)
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

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(r.status).send(t || 'session create failed');
    }

    const session = await r.json();
    return res.json(session);
  } catch (err) {
    console.error('SESSION ERROR:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// --- Tiny TTS test (optional) ---
// GET /tts?text=Hello
app.get('/tts', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).send('OPENAI_API_KEY not set');

    const text = (req.query.text ?? 'Hello from your hosted agent').toString();

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: text,
        format: 'mp3'
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(r.status).send(t || 'tts failed');
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (err) {
    console.error('TTS ERROR:', err);
    res.status(500).send(String(err?.message || err));
  }
});

// --- Memory endpoints (safe no-ops if Supabase not configured) ---
app.get('/memory', async (_req, res) => {
  try {
    if (!supabase) return res.json({ ok: true, configured: false, items: [] });
    const userId = process.env.DEFAULT_USER_ID || 'roman';
    const { data, error } = await supabase
      .from('memory')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ ok: true, configured: true, items: data ?? [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.post('/memory', async (req, res) => {
  try {
    if (!supabase) return res.json({ ok: true, configured: false });
    const userId = process.env.DEFAULT_USER_ID || 'roman';
    const item = {
      user_id: userId,
      type: req.body?.type || 'note',
      content: req.body?.content || '',
      meta: req.body?.meta || null
    };
    const { data, error } = await supabase.from('memory').insert(item).select().single();
    if (error) throw error;
    res.json({ ok: true, configured: true, item: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// --- Start server ---
const port = process.env.PORT || 8090;
app.listen(port, () => {
  console.log(`Session server running on http://localhost:${port}`);
});






