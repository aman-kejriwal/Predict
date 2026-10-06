import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { createServer } = await import('../src/server/server.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('status reports offline mode without a key', async () => {
  const s = await (await fetch(`${base}/api/status`)).json();
  assert.equal(s.ai, false);
  assert.ok(s.library.length >= 5);
});

test('model endpoint returns a library model offline', async () => {
  const res = await post('/api/model', { question: 'Will I be rich in the future?' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.source, 'library');
  assert.equal(data.model.id, 'wealth');
});

test('model endpoint rejects empty questions', async () => {
  const res = await post('/api/model', { question: '' });
  assert.equal(res.status, 400);
});

test('narrative endpoint works offline and ignores bogus answers', async () => {
  const { model } = await (await post('/api/model', { question: 'Will my startup succeed?' })).json();
  const res = await post('/api/narrative', { model, answers: { traction: 3, team: 99, nope: 1 } });
  const n = await res.json();
  assert.equal(n.source, 'offline');
  assert.ok(n.headline.length > 5);
});

test('static files and engine modules are served; traversal is blocked', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  const js = await fetch(`${base}/engine/core.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const evil = await fetch(`${base}/engine/..%2f..%2fpackage.json`);
  assert.notEqual(evil.status, 200);
});

test('unknown api routes 404', async () => {
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});
