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

// ---------------------------------------------------------------------------
// Rough input
// ---------------------------------------------------------------------------

const raw = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

test('malformed and non-object JSON bodies get 400, never 500', async () => {
  for (const body of ['{', 'not json', 'null', '[]', '42', '"str"', '{"question":']) {
    const res = await raw('/api/model', body);
    assert.equal(res.status, 400, `body ${body}`);
    assert.ok((await res.json()).error);
  }
});

test('wrong types in fields are handled', async () => {
  for (const question of [null, 42, {}, [], true, '  ', 'ab']) {
    const res = await post('/api/model', { question });
    assert.equal(res.status, 400, `question ${JSON.stringify(question)}`);
  }
  const res = await post('/api/model', { question: 'Will I be rich?', context: { evil: true } });
  assert.equal(res.status, 200);
});

test('oversized bodies are rejected with 413', async () => {
  const res = await raw('/api/model', JSON.stringify({ question: 'x'.repeat(400_000) })).catch((e) => e);
  if (res instanceof Error) return; // server may reset the socket mid-upload, which is also a rejection
  assert.equal(res.status, 413);
});

test('very long questions are truncated, not rejected', async () => {
  const res = await post('/api/model', { question: `Will I be rich ${'very '.repeat(2000)}?` });
  assert.equal(res.status, 200);
  const { model } = await res.json();
  assert.ok(model.question.length <= 300);
});

test('garbage models get 400; hostile answers are ignored', async () => {
  for (const model of [null, 'x', [], {}, { factors: 'no' }, { factors: [{ options: [] }] }]) {
    const res = await post('/api/narrative', { model, answers: {} });
    assert.equal(res.status, 400, `model ${JSON.stringify(model)}`);
  }
  const { model } = await (await post('/api/model', { question: 'Will I be rich?' })).json();
  const res = await raw('/api/narrative', `{"model": ${JSON.stringify(model)}, "answers": {"__proto__": {"x": 1}, "income": "3", "age": 999, "constructor": 1}}`);
  assert.equal(res.status, 200);
  assert.equal({}.x, undefined);
});

test('a client cannot inject out-of-range weights', async () => {
  const model = { baseRate: 5, factors: [{ id: 'a', question: 'A', options: [{ label: 'x', logLR: 1e9 }, { label: 'y', logLR: -1e9 }] }] };
  const res = await post('/api/narrative', { model, answers: { a: 0 } });
  assert.equal(res.status, 200);
  const n = await res.json();
  assert.ok(n.summary.includes('%'));
});

test('path traversal and malformed URLs are refused', async () => {
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/engine/..%2f..%2f.env', '/engine/%2e%2e%2fserver%2fserver.js', '/%E0%A4%A', '/engine/%00']) {
    const res = await fetch(base + p);
    const text = await res.text();
    assert.ok(!text.includes('"dependencies"') && !text.includes('createServer'), `leaked via ${p}`);
  }
});

test('unknown pages fall back to the app; wrong methods are refused', async () => {
  const res = await fetch(`${base}/some/deep/link`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>Oracle/);
  assert.equal((await fetch(`${base}/index.html`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/api/model`)).status, 404);
});

test('handles 100 concurrent requests', async () => {
  const qs = ['Will I be rich?', 'Will my startup succeed?', 'Will I live to 90?', 'Will it rain?'];
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => post('/api/model', { question: qs[i % 4] }).then((r) => r.status)));
  assert.ok(results.every((s) => s === 200));
});

test('models from the API are tuned and coherent', async () => {
  const { model } = await (await post('/api/model', { question: 'Will I be rich in the future?' })).json();
  assert.equal(model.dependenceTuned, true);
  assert.ok(model.dependence < 0.3);
});
