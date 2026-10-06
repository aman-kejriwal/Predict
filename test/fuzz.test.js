// Property-based stress tests: thousands of random (often hostile) models and
// answer sets, checked against invariants that must always hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIP, analyze, cleanAnswers, contributions, isActive, levers, logit, mulberry32, nextQuestion,
  pathTo, posterior, sigmoid, simulate, validateModel, waterfall,
} from '../src/engine/core.js';
import { matchLibrary } from '../src/engine/library.js';
import { offlineNarrative } from '../src/engine/narrative.js';
import { calibrationStudy, tuneDependence } from '../src/engine/calibration.js';

const ROUNDS = Number(process.env.FUZZ_ROUNDS) || 400;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

function randomModel(rand) {
  const r = (a, b) => a + rand() * (b - a);
  const ri = (a, b) => Math.floor(r(a, b + 1));
  const junk = [null, undefined, NaN, Infinity, -Infinity, '', 'abc', {}, [], true, 1e308, -1e308];
  const pickJunk = () => junk[ri(0, junk.length - 1)];
  const nf = ri(1, 14);
  const factors = [];
  for (let i = 0; i < nf; i++) {
    const kind = rand() < 0.1 ? 'prior' : rand() < 0.03 ? pickJunk() : 'evidence';
    const no = ri(rand() < 0.05 ? 0 : 2, 8);
    const options = [];
    for (let j = 0; j < no; j++) {
      options.push({
        label: rand() < 0.04 ? pickJunk() : `opt ${j} ${'<b>&"\''.slice(0, ri(0, 5))}`,
        logLR: rand() < 0.08 ? pickJunk() : r(-6, 6),
        prior: rand() < 0.08 ? pickJunk() : r(-1, 5),
        p: rand() < 0.1 ? pickJunk() : r(-0.5, 1.5),
      });
    }
    const f = {
      id: rand() < 0.15 ? 'dup' : rand() < 0.05 ? pickJunk() : `f${i}`,
      kind,
      label: rand() < 0.05 ? pickJunk() : `Factor ${i}`,
      question: `Question ${i}?`,
      type: ['choice', 'scale', 'yesno', 'weird', null][ri(0, 4)],
      controllable: rand() < 0.5,
      options,
    };
    if (i > 0 && rand() < 0.3) f.askIf = { factorId: rand() < 0.8 ? `f${ri(0, i - 1)}` : 'nope', optionIndexes: [ri(-1, 4), ri(0, 3)] };
    factors.push(rand() < 0.03 ? pickJunk() : f);
  }
  return {
    title: rand() < 0.1 ? pickJunk() : 'Random',
    baseRate: rand() < 0.1 ? pickJunk() : r(-0.2, 1.2),
    dependence: rand() < 0.1 ? pickJunk() : r(-1, 2),
    overlap: rand() < 0.1 ? pickJunk() : r(-1, 2),
    baseRateUncertainty: rand() < 0.1 ? pickJunk() : r(-1, 3),
    factors,
  };
}

function randomAnswers(rand, model) {
  const a = {};
  for (const f of model.factors) {
    const x = rand();
    if (x < 0.25) continue;
    a[f.id] = x < 0.35 ? SKIP : Math.floor(rand() * f.options.length);
  }
  if (rand() < 0.2) Object.assign(a, { nope: 1, constructor: 0, toString: 2 });
  if (rand() < 0.2 && model.factors[0]) a[model.factors[0].id] = ['1', 1.5, -7, 99, null, {}][Math.floor(rand() * 6)];
  return a;
}

function* cases(seed) {
  const rand = mulberry32(seed);
  for (let i = 0; i < ROUNDS; i++) {
    const raw = randomModel(rand);
    let model;
    try {
      model = validateModel(raw);
    } catch (err) {
      assert.ok(err instanceof Error && /factor|object/i.test(err.message), `unexpected validation error: ${err.message}`);
      continue;
    }
    yield { rand, raw, model, answers: cleanAnswers(model, randomAnswers(rand, model)) };
  }
}

test('validateModel: never crashes, always produces a well-formed model, and is idempotent', () => {
  let validated = 0;
  for (const { model } of cases(1)) {
    validated++;
    assert.ok(model.baseRate > 0 && model.baseRate < 1);
    assert.ok(model.dependence >= 0 && model.dependence <= 0.8);
    assert.ok(model.overlap >= 0 && model.overlap <= 0.8);
    const ids = new Set();
    for (const f of model.factors) {
      assert.ok(!ids.has(f.id), 'duplicate id');
      ids.add(f.id);
      assert.ok(f.options.length >= 2 && f.options.length <= 8);
      assert.ok(['choice', 'scale', 'yesno'].includes(f.type));
      assert.ok(Math.abs(f.options.reduce((s, o) => s + o.prior, 0) - 1) < 1e-9);
      for (const o of f.options) {
        assert.ok(finite(o.logLR) && Math.abs(o.logLR) <= 3);
        assert.equal(typeof o.label, 'string');
        assert.ok(o.label.length > 0);
      }
      if (f.askIf) assert.ok(ids.has(f.askIf.factorId) && f.askIf.factorId !== f.id);
    }
    const again = validateModel(JSON.parse(JSON.stringify(model)));
    assert.equal(again.factors.length, model.factors.length);
    again.factors.forEach((f, i) =>
      f.options.forEach((o, j) => assert.ok(Math.abs(o.logLR - model.factors[i].options[j].logLR) < 1e-6, 'not idempotent')),
    );
  }
  assert.ok(validated > ROUNDS / 2, `only ${validated} models validated`);
});

test('coherence: each factor averages back to the base rate (law of total probability)', () => {
  let checked = 0;
  for (const { model } of cases(2)) {
    const b = model.baseRate;
    for (const f of model.factors) {
      if (f.kind !== 'evidence') continue;
      // Clamping at ±3 can make extreme factors only approximately coherent.
      if (f.options.some((o) => Math.abs(o.logLR) >= 2.999)) continue;
      const avg = f.options.reduce((s, o) => s + o.prior * sigmoid(logit(b) + o.logLR), 0);
      assert.ok(Math.abs(avg - b) < 1e-6, `factor ${f.id}: E[p]=${avg} vs base ${b}`);
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('inference invariants hold for random answers', () => {
  for (const { model, answers } of cases(3)) {
    const post = posterior(model, answers);
    assert.ok(finite(post.p) && post.p >= 0.001 && post.p <= 0.999);
    assert.ok(finite(post.rawP) && finite(post.logOdds));
    assert.ok(post.shrink > 0 && post.shrink <= 1);

    const steps = waterfall(model, answers);
    assert.ok(Math.abs(steps.at(-1).p - post.rawP) < 1e-9, 'waterfall must end at the posterior');

    for (const c of contributions(model, answers)) assert.ok(finite(c.delta));

    const ls = levers(model, answers);
    for (const l of ls) {
      assert.ok(l.delta > 0);
      const after = posterior(model, cleanAnswers(model, { ...answers, [l.id]: l.toIndex })).rawP;
      assert.ok(Math.abs(after - l.p) < 1e-9, 'lever must report the probability it produces');
    }
    for (let i = 1; i < ls.length; i++) assert.ok(ls[i - 1].delta >= ls[i].delta, 'levers sorted');

    const path = pathTo(model, answers, 0.9);
    let prev = post.rawP;
    for (const s of path.steps) {
      assert.ok(s.p > prev - 1e-12, 'path must only go up');
      prev = s.p;
    }
  }
});

test('simulation invariants', () => {
  let i = 0;
  for (const { model, answers } of cases(4)) {
    if (i++ > 120) break;
    const s = simulate(model, answers, { n: 500 });
    assert.ok(s.p10 <= s.p25 && s.p25 <= s.p50 && s.p50 <= s.p75 && s.p75 <= s.p90);
    assert.ok(s.p10 >= 0 && s.p90 <= 1);
    assert.ok(Math.abs(s.histogram.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.ok([s.mean, s.p10, s.p90].every(finite));
  }
});

test('monotonicity: a stronger answer never lowers the forecast', () => {
  for (const { model, answers } of cases(5)) {
    for (const f of model.factors) {
      if (f.kind !== 'evidence' || !isActive(f, answers, model)) continue;
      if (model.factors.some((g) => g.askIf?.factorId === f.id)) continue; // changing it would toggle children
      const order = f.options.map((o, i) => [o.logLR, i]).sort((a, b) => a[0] - b[0]);
      let prev = -Infinity;
      for (const [, idx] of order) {
        const p = posterior(model, { ...answers, [f.id]: idx }).rawP;
        assert.ok(p >= prev - 1e-12, 'non-monotone');
        prev = p;
      }
    }
  }
});

test('adaptive interview always terminates and only asks open, active questions', () => {
  for (const { model, rand } of cases(6)) {
    const answers = {};
    for (let guard = 0; ; guard++) {
      assert.ok(guard <= model.factors.length, 'interview did not terminate');
      const nq = nextQuestion(model, answers);
      if (!nq) break;
      assert.ok(!(nq.factor.id in answers));
      assert.ok(isActive(nq.factor, answers, model));
      assert.ok(finite(nq.value.expectedShift) && finite(nq.value.maxShift));
      answers[nq.factor.id] = rand() < 0.2 ? SKIP : Math.floor(rand() * nq.factor.options.length);
    }
    const r = analyze(model, answers, { simulations: 300 });
    assert.ok(finite(r.p) && finite(r.coverage) && r.coverage >= 0 && r.coverage <= 1 + 1e-9);
    const n = offlineNarrative(model, r);
    assert.ok(typeof n.headline === 'string' && n.headline.length > 0);
  }
});

test('cleanAnswers rejects prototype keys, strings, floats and out-of-range indexes', () => {
  const model = validateModel({ factors: [{ id: 'a', question: 'A', options: [{ label: 'x' }, { label: 'y' }] }] });
  const evil = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": 0, "a": "1"}');
  assert.deepEqual(cleanAnswers(model, evil), {});
  assert.deepEqual(cleanAnswers(model, { a: 1.5 }), {});
  assert.deepEqual(cleanAnswers(model, { a: 2 }), {});
  assert.deepEqual(cleanAnswers(model, { a: -2 }), {});
  assert.deepEqual(cleanAnswers(model, { a: SKIP }), { a: SKIP });
  assert.deepEqual(cleanAnswers(model, { a: 1 }), { a: 1 });
  assert.deepEqual(cleanAnswers(model, null), {});
  assert.equal({}.polluted, undefined);
});

test('matchLibrary survives arbitrary text', () => {
  const rand = mulberry32(9);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ?.*+()[]{}|^$\\/<>"\'😀कखग中文\u0000\n\t';
  for (let i = 0; i < 300; i++) {
    let q = '';
    const len = Math.floor(rand() * 400);
    for (let j = 0; j < len; j++) q += alphabet[Math.floor(rand() * alphabet.length)];
    const { model } = matchLibrary(q);
    assert.ok(validateModel(model).factors.length > 0);
  }
  for (const q of [undefined, null, 42, {}, [], '']) assert.ok(matchLibrary(q).model.factors.length > 0);
});

test('tuned correlation correction beats naive Bayes on overlapping signals', () => {
  const rand = mulberry32(12);
  let wins = 0;
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const factors = Array.from({ length: 8 }, (_, k) => ({
      id: `f${k}`, question: `Q${k}`,
      options: [{ label: 'low', logLR: -0.4 - rand(), prior: 1 }, { label: 'mid', logLR: 0, prior: 1 }, { label: 'high', logLR: 0.4 + rand(), prior: 1 }],
    }));
    const model = tuneDependence(validateModel({ baseRate: 0.1 + rand() * 0.6, overlap: 0.5, factors }));
    const s = calibrationStudy(model, { n: 4000, overlap: 0.5, seed: 100 + i });
    total++;
    if (s.oracle.logLoss <= s.naive.logLoss + 1e-9) wins++;
    assert.ok(s.oracle.logLoss < s.baseRate.logLoss, 'evidence must beat the base rate alone');
  }
  assert.ok(wins >= total - 1, `Oracle beat naive Bayes in only ${wins}/${total} cases`);
});
