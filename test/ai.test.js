// Exercises the Claude integration against a local fake Messages API, so the
// request shape and response handling are tested without a real API key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];
let reply = null;

const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(reply()));
});

const message = (obj, stop = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_details: null,
  content: stop === 'refusal' ? [] : [{ type: 'text', text: JSON.stringify(obj) }],
  usage: { input_tokens: 10, output_tokens: 10 },
});

const MODEL = {
  title: 'Becoming a famous YouTuber',
  outcome: 'Reach 1M subscribers',
  horizon: 'Within 5 years',
  domain: 'creator',
  interpretation: 'Read "famous" as 1M subscribers.',
  baseRate: 0.01,
  baseRateNote: 'Few channels reach 1M.',
  baseRateUncertainty: 0.5,
  dependence: 0.2,
  caveat: '',
  factors: [
    { id: 'consistency', kind: 'evidence', label: 'Consistency', question: 'How often do you upload?', why: 'Volume matters.', type: 'scale', controllable: true,
      askIfFactorId: '', askIfOptionIndexes: [], presetAnswer: 2,
      options: [{ label: 'Rarely', logLR: -0.8, prior: 2, p: 0 }, { label: 'Monthly', logLR: 0, prior: 2, p: 0 }, { label: 'Weekly+', logLR: 0.9, prior: 1, p: 0 }] },
    { id: 'growth', kind: 'evidence', label: 'Growth', question: 'Growth rate?', why: 'Trajectory.', type: 'choice', controllable: false,
      askIfFactorId: 'consistency', askIfOptionIndexes: [2], presetAnswer: -1,
      options: [{ label: 'Flat', logLR: -0.5, prior: 1, p: 0 }, { label: 'Fast', logLR: 1.2, prior: 1, p: 0 }] },
  ],
};

let ai;
before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  ai = await import('../src/server/oracle-ai.js');
});
after(() => fake.close());

test('buildModel sends a structured-output request and maps presets and conditionals', async () => {
  reply = () => message(MODEL);
  const { model, presets, interpretation } = await ai.buildModel('Will I become a famous YouTuber?', 'I upload every week');
  const req = requests.at(-1);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.thinking, undefined);
  assert.match(req.body.messages[0].content, /I upload every week/);

  assert.equal(model.source, 'claude');
  assert.equal(model.factors.length, 2);
  assert.deepEqual(model.factors[1].askIf, { factorId: 'consistency', optionIndexes: [2] });
  assert.deepEqual(presets, { consistency: 2 });
  assert.match(interpretation, /1M/);
});

test('followUps returns only new, validated factors', async () => {
  reply = () => message(MODEL);
  const { model } = await ai.buildModel('x?');
  reply = () => message({
    note: 'You upload weekly, so retention matters most.',
    factors: [{ ...MODEL.factors[0], id: 'retention', question: 'Average view duration?', askIfFactorId: 'consistency', askIfOptionIndexes: [1], presetAnswer: -1 }],
  });
  const res = await ai.followUps(model, { consistency: 2 });
  assert.equal(res.factors.length, 1);
  assert.equal(res.factors[0].id, 'retention');
  assert.equal(res.factors[0].askIf, null);
  assert.match(res.note, /retention/);
});

test('refusals surface as RefusalError', async () => {
  reply = () => message(null, 'refusal');
  await assert.rejects(() => ai.buildModel('something'), ai.RefusalError);
});
