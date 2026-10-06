// Calibration study: does "30%" really mean 30%?
//
// We simulate a population from a model's own generative story: each person
// has an outcome y ~ Bernoulli(baseRate) and answers every question with
// probability P(answer | y), derived from the (coherent) likelihood ratios and
// answer frequencies. To mimic real life, where questions overlap (income and
// savings rate both reflect the same underlying earning power), a fraction
// `overlap` of answers is driven by a shared hidden trait instead of by y
// directly. Naive Bayes double-counts that shared signal; Oracle's
// correlation shrink is meant to correct it.
//
// This tests the engine's internal consistency under its own assumptions. It
// does not prove the weights match the real world — only outcome data can.

import { isActive, mulberry32, posterior } from './core.js';

function pick(rand, probs) {
  let r = rand();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

/** P(option | yes) and P(option | no) implied by coherent weights. */
function conditionals(factor, b) {
  const no = factor.options.map((o) => o.prior / (b * Math.exp(o.logLR) + 1 - b));
  const yes = factor.options.map((o, i) => no[i] * Math.exp(o.logLR));
  const norm = (arr) => {
    const s = arr.reduce((a, v) => a + v, 0);
    return arr.map((v) => v / s);
  };
  return { yes: norm(yes), no: norm(no) };
}

/**
 * Generate a synthetic population.
 * overlap: share of answers driven by a shared hidden trait (0 = independent).
 * traitFidelity: how often the hidden trait agrees with the true outcome.
 */
export function syntheticPopulation(model, { n = 5000, overlap = 0, traitFidelity = 0.8, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const b = model.baseRate;
  const cond = new Map(model.factors.filter((f) => f.kind === 'evidence').map((f) => [f.id, conditionals(f, b)]));
  const people = [];
  for (let k = 0; k < n; k++) {
    const y = rand() < b;
    const trait = rand() < traitFidelity ? y : !y;
    const answers = {};
    for (const f of model.factors) {
      if (f.kind !== 'evidence' || !isActive(f, answers, model)) continue;
      const driver = rand() < overlap ? trait : y;
      const c = cond.get(f.id);
      answers[f.id] = pick(rand, driver ? c.yes : c.no);
    }
    people.push({ y, answers });
  }
  return people;
}

function score(preds) {
  let brier = 0;
  let logLoss = 0;
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, hits: 0 }));
  for (const { p, y } of preds) {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
    brier += (p - (y ? 1 : 0)) ** 2;
    logLoss -= y ? Math.log(q) : Math.log(1 - q);
    const bkt = buckets[Math.min(9, Math.floor(p * 10))];
    bkt.n++;
    bkt.sumP += p;
    bkt.hits += y ? 1 : 0;
  }
  const n = preds.length;
  const reliability = buckets
    .filter((x) => x.n)
    .map((x) => ({ predicted: x.sumP / x.n, actual: x.hits / x.n, n: x.n }));
  // Expected calibration error: average gap between predicted and observed.
  const ece = reliability.reduce((s, r) => s + (r.n / n) * Math.abs(r.predicted - r.actual), 0);
  return { brier: brier / n, logLoss: logLoss / n, ece, reliability };
}

/**
 * Score Oracle (with its correlation correction) against naive Bayes and the
 * base rate alone on a synthetic population.
 */
export function calibrationStudy(model, opts = {}) {
  const people = syntheticPopulation(model, opts);
  const naiveModel = { ...model, dependence: 0 };
  const oracle = [];
  const naive = [];
  const base = [];
  for (const { y, answers } of people) {
    oracle.push({ p: posterior(model, answers).rawP, y });
    naive.push({ p: posterior(naiveModel, answers).rawP, y });
    base.push({ p: model.baseRate, y });
  }
  return { n: people.length, overlap: opts.overlap ?? 0, oracle: score(oracle), naive: score(naive), baseRate: score(base) };
}

/**
 * The dependence ρ that best calibrates a model for a given overlap level,
 * found by grid search on log loss. Used to sanity-check default ρ values.
 */
export function bestDependence(model, opts = {}) {
  const people = syntheticPopulation(model, opts);
  let best = null;
  for (let rho = 0; rho <= 0.8001; rho += 0.05) {
    const m = { ...model, dependence: rho };
    const s = score(people.map(({ y, answers }) => ({ p: posterior(m, answers).rawP, y })));
    if (!best || s.logLoss < best.logLoss) best = { dependence: Math.round(rho * 100) / 100, logLoss: s.logLoss };
  }
  return best;
}


/**
 * Turn the model's overlap estimate into a calibrated correlation correction:
 * simulate a population with that much shared signal and pick the ρ whose
 * forecasts score best. Deterministic (fixed seed), ~50ms.
 */
export function tuneDependence(model, { n = 3000 } = {}) {
  const { dependence } = bestDependence(model, { n, overlap: model.overlap, seed: 11 });
  return { ...model, dependence, dependenceTuned: true };
}
