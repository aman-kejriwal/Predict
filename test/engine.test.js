import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIP, analyze, contributions, isActive, levers, logit, nextQuestion, pathTo, posterior,
  questionValue, remainingFactors, sigmoid, simulate, validateModel, verdict, waterfall,
} from '../src/engine/core.js';
import { LIBRARY, genericModel, matchLibrary } from '../src/engine/library.js';
import { offlineNarrative } from '../src/engine/narrative.js';

const toy = () =>
  validateModel({
    title: 'Toy',
    baseRate: 0.2,
    dependence: 0,
    factors: [
      { id: 'a', question: 'A?', controllable: true, options: [{ label: 'good', logLR: 1 }, { label: 'bad', logLR: -1 }] },
      { id: 'b', question: 'B?', options: [{ label: 'meh', logLR: 0.1 }, { label: 'meh2', logLR: -0.1 }] },
      { id: 'c', question: 'C?', askIf: { factorId: 'a', optionIndexes: [0] }, options: [{ label: 'x', logLR: 0.5 }, { label: 'y', logLR: -0.5 }] },
    ],
  });

test('logit and sigmoid are inverses', () => {
  for (const p of [0.01, 0.2, 0.5, 0.93]) assert.ok(Math.abs(sigmoid(logit(p)) - p) < 1e-12);
});

test('no answers returns the base rate', () => {
  assert.ok(Math.abs(posterior(toy()).p - 0.2) < 1e-9);
});

test('evidence moves the posterior by exactly the likelihood ratio when independent', () => {
  const p = posterior(toy(), { a: 0 }).p;
  const expected = sigmoid(logit(0.2) + 1);
  assert.ok(Math.abs(p - expected) < 1e-9);
});

test('skipped questions contribute nothing', () => {
  assert.ok(Math.abs(posterior(toy(), { a: SKIP }).p - 0.2) < 1e-9);
});

test('correlation shrink reduces combined evidence', () => {
  const m = validateModel({ ...toy(), dependence: 0.5 });
  const indep = posterior(toy(), { a: 0, b: 0 }).p;
  const corr = posterior(m, { a: 0, b: 0 }).p;
  assert.ok(corr < indep && corr > 0.2);
});

test('conditional questions only activate for matching parent answers', () => {
  const m = toy();
  const c = m.factors.find((f) => f.id === 'c');
  assert.equal(isActive(c, {}, m), false);
  assert.equal(isActive(c, { a: 1 }, m), false);
  assert.equal(isActive(c, { a: 0 }, m), true);
  assert.deepEqual(remainingFactors(m, { a: 1, b: 0 }), []);
});

test('nextQuestion asks the most informative question first', () => {
  const nq = nextQuestion(toy(), {});
  assert.equal(nq.factor.id, 'a');
  assert.ok(questionValue(toy(), {}, nq.factor).expectedShift > questionValue(toy(), {}, toy().factors[1]).expectedShift);
});

test('prior questions always come first and set the base rate', () => {
  const m = validateModel(genericModel('Will I win the lottery?'));
  assert.equal(nextQuestion(m, {}).factor.kind, 'prior');
  const p = posterior(m, { reference: 5 }).p; // ≈2%
  assert.ok(Math.abs(p - 0.02) < 1e-9);
});

test('simulation is deterministic and brackets the point estimate', () => {
  const m = toy();
  const s1 = simulate(m, { a: 0 }, { n: 3000 });
  const s2 = simulate(m, { a: 0 }, { n: 3000 });
  assert.deepEqual(s1, s2);
  const p = posterior(m, { a: 0 }).p;
  assert.ok(s1.p10 < p && p < s1.p90);
  assert.ok(Math.abs(s1.histogram.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('answering questions narrows the uncertainty interval', () => {
  const m = validateModel(LIBRARY.find((x) => x.id === 'wealth'));
  const wide = simulate(m, {});
  const answers = {};
  for (const f of m.factors) if (!f.askIf) answers[f.id] = 0;
  const narrow = simulate(m, answers);
  assert.ok(narrow.p90 - narrow.p10 < wide.p90 - wide.p10);
});

test('levers find better answers for controllable factors only', () => {
  const m = toy();
  const ls = levers(m, { a: 1, b: 1 });
  assert.equal(ls.length, 1);
  assert.equal(ls[0].id, 'a');
  assert.equal(ls[0].toIndex, 0);
  assert.ok(ls[0].delta > 0);
});

test('pathTo reaches a reachable target', () => {
  const r = pathTo(toy(), { a: 1 }, 0.3);
  assert.ok(r.reached);
  assert.equal(r.steps[0].id, 'a');
});

test('waterfall ends at the posterior', () => {
  const m = toy();
  const answers = { a: 0, b: 1, c: 0 };
  const steps = waterfall(m, answers);
  assert.ok(Math.abs(steps.at(-1).p - posterior(m, answers).rawP) < 1e-9);
});

test('contributions are signed correctly', () => {
  const cs = contributions(toy(), { a: 0, b: 1 });
  assert.ok(cs.find((c) => c.id === 'a').delta > 0);
  assert.ok(cs.find((c) => c.id === 'b').delta < 0);
});

test('verdict bands', () => {
  assert.equal(verdict(0.01).label, 'Very unlikely');
  assert.equal(verdict(0.5).label, 'Toss-up');
  assert.equal(verdict(0.99).label, 'Very likely');
});

test('validateModel sanitises hostile input', () => {
  const m = validateModel({
    baseRate: 7,
    dependence: -3,
    factors: [
      { id: 'x', question: 'X', options: [{ label: 'a', logLR: 99 }, { label: 'b', logLR: 'nope' }, { label: '' }] },
      { id: 'x', question: 'dup id', options: [{ label: 'a' }, { label: 'b' }] },
      { id: 'bad', question: 'one option', options: [{ label: 'a' }] },
      { id: 'orphan', question: 'Orphan', askIf: { factorId: 'missing', optionIndexes: [0] }, options: [{ label: 'a' }, { label: 'b' }] },
      null,
    ],
  });
  assert.equal(m.baseRate, 0.999);
  assert.equal(m.dependence, 0);
  assert.equal(m.factors.length, 3);
  assert.equal(m.factors[0].options.length, 2);
  assert.equal(m.factors[0].options[0].logLR, 3);
  assert.equal(m.factors[0].options[1].logLR, 0);
  assert.notEqual(m.factors[0].id, m.factors[1].id);
  assert.equal(m.factors[2].askIf, null);
  assert.throws(() => validateModel({ factors: [] }));
});

test('every library model is valid and fully answerable', () => {
  for (const raw of [...LIBRARY, genericModel('Anything?')]) {
    const m = validateModel(raw);
    assert.equal(m.factors.length, raw.factors.length, `${raw.id} lost factors in validation`);
    const answers = {};
    let guard = 0;
    for (let nq = nextQuestion(m, answers); nq && guard < 50; nq = nextQuestion(m, answers), guard++) {
      answers[nq.factor.id] = 0;
    }
    assert.ok(guard < 50);
    const r = analyze(m, answers);
    assert.ok(r.p > 0 && r.p < 1, `${raw.id} produced p=${r.p}`);
    assert.ok(r.interval.low <= r.p + 0.05 && r.interval.high >= r.p - 0.05);
    const n = offlineNarrative(m, r);
    assert.ok(n.headline && n.summary && n.insight);
  }
});

test('matchLibrary routes questions to the right model', () => {
  assert.equal(matchLibrary('Will I be rich in the future?').model.id, 'wealth');
  assert.equal(matchLibrary('Will I become a millionaire by 40').model.id, 'wealth');
  assert.equal(matchLibrary('Will my startup succeed?').model.id, 'startup');
  assert.equal(matchLibrary('Will I live to 90?').model.id, 'longevity');
  assert.equal(matchLibrary('Will my marriage last?').model.id, 'marriage');
  assert.equal(matchLibrary('Will I get a job at Google?').model.id, 'job');
  assert.equal(matchLibrary('Will I crack the JEE exam').model.id, 'exam');
  assert.equal(matchLibrary('Will I lose weight this year').model.id, 'fitness');
  assert.equal(matchLibrary('Will it rain on Mars tomorrow?').model.id, 'generic');
});

test('analyze returns a complete bundle', () => {
  const m = validateModel(LIBRARY[0]);
  const r = analyze(m, { age: 1, income: 3, savings_rate: 3 });
  for (const k of ['p', 'interval', 'confidence', 'contributions', 'waterfall', 'levers', 'path', 'scenarios', 'simulation']) {
    assert.ok(k in r, `missing ${k}`);
  }
  assert.ok(r.scenarios.fullPotential >= r.p);
});
