#!/usr/bin/env node
// Oracle web server: static front end + a small JSON API. No framework needed.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateModel, analyze } from '../engine/core.js';
import { matchLibrary, LIBRARY } from '../engine/library.js';
import { offlineNarrative } from '../engine/narrative.js';
import { aiAvailable, buildModel, followUps, narrate, RefusalError } from './oracle-ai.js';

// Load .env if present (Node 20.12+); real environment variables win.
try {
  process.loadEnvFile?.();
} catch {}

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const STATIC = {
  '/engine/': path.join(ROOT, 'src/engine'),
  '/': path.join(ROOT, 'public'),
};
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  const isJSON = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJSON ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isJSON ? JSON.stringify(body) : body);
}

async function readJSON(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function cleanAnswers(model, answers) {
  const out = {};
  if (!answers || typeof answers !== 'object') return out;
  for (const f of model.factors) {
    const v = Number(answers[f.id]);
    if (f.id in answers && Number.isInteger(v) && v >= -1 && v < f.options.length) out[f.id] = v;
  }
  return out;
}

function offlineModel(question) {
  const { model, score } = matchLibrary(question);
  return { model: validateModel(model), presets: {}, interpretation: '', source: score ? 'library' : 'generic' };
}

const routes = {
  'GET /api/status': async () => ({
    ai: aiAvailable(),
    model: aiAvailable() ? process.env.ORACLE_MODEL || 'claude-opus-5-5' : null,
    library: LIBRARY.map((m) => ({ id: m.id, title: m.title, question: m.question })),
  }),

  'POST /api/model': async (body) => {
    const question = String(body.question || '').trim().slice(0, 300);
    const context = String(body.context || '').trim().slice(0, 1500);
    if (question.length < 3) throw Object.assign(new Error('Please ask a question.'), { status: 400 });

    if (body.mode !== 'offline' && aiAvailable()) {
      try {
        const built = await buildModel(question, context);
        return { ...built, source: 'claude' };
      } catch (err) {
        if (err instanceof RefusalError) throw Object.assign(err, { status: 422 });
        console.error('[oracle] AI model build failed, using offline model:', err.message);
        return { ...offlineModel(question), warning: 'Claude was unavailable, so Oracle used its built-in model.' };
      }
    }
    return offlineModel(question);
  },

  'POST /api/followups': async (body) => {
    const model = validateModel(body.model);
    if (!aiAvailable()) return { factors: [], note: '' };
    try {
      return await followUps(model, cleanAnswers(model, body.answers));
    } catch (err) {
      console.error('[oracle] follow-up generation failed:', err.message);
      return { factors: [], note: '' };
    }
  },

  'POST /api/narrative': async (body) => {
    const model = validateModel(body.model);
    const answers = cleanAnswers(model, body.answers);
    const result = analyze(model, answers);
    if (aiAvailable() && body.mode !== 'offline') {
      try {
        return { ...(await narrate(model, answers, result)), source: 'claude' };
      } catch (err) {
        console.error('[oracle] narrative failed, using offline narrative:', err.message);
      }
    }
    return { ...offlineNarrative(model, result), source: 'offline' };
  },
};

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of Object.entries(STATIC)) {
    if (!pathname.startsWith(prefix)) continue;
    let file;
    try {
      file = path.resolve(dir, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html');
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (!file.startsWith(dir + path.sep) && file !== dir) return send(res, 403, 'Forbidden');
    try {
      const info = await stat(file);
      const target = info.isDirectory() ? path.join(file, 'index.html') : file;
      const data = await readFile(target);
      return send(res, 200, data, {
        'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
    } catch {
      if (prefix === '/') {
        // Single-page app: unknown routes fall back to index.html.
        const data = await readFile(path.join(dir, 'index.html'));
        return send(res, 200, data, { 'Content-Type': MIME['.html'] });
      }
      return send(res, 404, 'Not found');
    }
  }
  return send(res, 404, 'Not found');
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const handler = routes[`${req.method} ${pathname}`];
    if (handler) {
      try {
        const body = req.method === 'POST' ? await readJSON(req) : {};
        send(res, 200, await handler(body));
      } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error('[oracle]', err);
        send(res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
      }
      return;
    }
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, pathname);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`\n  🔮 Oracle is listening on http://localhost:${PORT}`);
    console.log(
      aiAvailable()
        ? `     Claude mode: ON (${process.env.ORACLE_MODEL || 'claude-opus-5-5'}) — any question gets a bespoke model.`
        : '     Offline mode: built-in models. Set ANTHROPIC_API_KEY to let Claude build a model for any question.',
    );
    console.log('');
  });
}
