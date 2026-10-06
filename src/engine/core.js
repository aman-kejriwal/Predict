// Oracle forecasting engine.
//
// A "model" describes one prediction: a clearly resolvable outcome, a base rate
// for the reference class, and a set of factors. Each factor is a question whose
// answers carry evidence expressed as natural-log likelihood ratios (logLR).
//
// The engine is deliberately transparent: the probability is
//
//   logit(p) = logit(baseRate) + shrink(n) * Σ logLR(answer_i)
//
// where shrink(n) = 1 / sqrt(1 + ρ(n - 1)) corrects naive-Bayes overconfidence
// for correlated factors (ρ = model.dependence). Uncertainty comes from a Monte
// Carlo simulation over the base rate, the evidence weights and the questions
// that are still unanswered.
//
// This module is isomorphic: it runs unchanged in Node and in the browser.

export const SKIP = -1;

const MAX_LOG_LR = 3;
const MAX_FACTORS = 24;
const MAX_OPTIONS = 8;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const logit = (p) => Math.log(p / (1 - p));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Binary entropy in bits. */
export function entropy(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/** Deterministic PRNG so the same answers always give the same interval. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function slugify(text, fallback = 'item') {
  const s = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return s || fallback;
}

// ---------------------------------------------------------------------------
// Model validation / normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a model from any source (built-in library, Claude, a saved file).
 * Never trusts its input: clamps every number, de-duplicates ids, drops broken
 * factors, and repairs conditional references.
 */
export function validateModel(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Model must be an object');
  const factorsIn = Array.isArray(raw.factors) ? raw.factors.slice(0, MAX_FACTORS) : [];
  const usedIds = new Set();
  const factors = [];

  for (const f of factorsIn) {
    if (!f || typeof f !== 'object') continue;
    const kind = f.kind === 'prior' ? 'prior' : 'evidence';
    const options = (Array.isArray(f.options) ? f.options : [])
      .slice(0, MAX_OPTIONS)
      .filter((o) => o && String(o.label ?? '').trim())
      .map((o) => {
        const opt = {
          label: String(o.label).trim().slice(0, 140),
          logLR: kind === 'prior' ? 0 : clamp(Number.isFinite(Number(o.logLR)) ? Number(o.logLR) : 0, -MAX_LOG_LR, MAX_LOG_LR),
          prior: Number.isFinite(Number(o.prior)) && Number(o.prior) > 0 ? Math.min(Number(o.prior), 1e6) : 1,
        };
        if (kind === 'prior') opt.p = clamp(Number(o.p) || 0.5, 0.001, 0.999);
        else if (Number.isFinite(Number(o.rawLogLR)) && o.rawLogLR !== null) opt.rawLogLR = clamp(Number(o.rawLogLR), -MAX_LOG_LR, MAX_LOG_LR);
        return opt;
      });
    if (options.length < 2) continue;

    let id = slugify(f.id || f.label || f.question, `factor_${factors.length + 1}`);
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);

    const total = options.reduce((s, o) => s + o.prior, 0);
    options.forEach((o) => (o.prior = o.prior / total));

    const type = ['choice', 'scale', 'yesno'].includes(f.type) ? f.type : 'choice';
    factors.push({
      id,
      kind,
      label: String(f.label || f.question || id).trim().slice(0, 80),
      question: String(f.question || f.label || id).trim().slice(0, 300),
      why: String(f.why || '').trim().slice(0, 400),
      type,
      controllable: Boolean(f.controllable),
      options,
      askIf: f.askIf && typeof f.askIf === 'object' ? { ...f.askIf } : null,
    });
  }

  if (!factors.length) throw new Error('Model has no usable factors');

  // Conditional questions may only depend on an earlier factor.
  const seen = new Map();
  for (const f of factors) {
    if (f.askIf) {
      const parent = seen.get(slugify(f.askIf.factorId ?? f.askIf.factor ?? ''));
      const idx = (Array.isArray(f.askIf.optionIndexes) ? f.askIf.optionIndexes : [])
        .map(Number)
        .filter((i) => parent && Number.isInteger(i) && i >= 0 && i < parent.options.length);
      f.askIf = parent && idx.length ? { factorId: parent.id, optionIndexes: idx } : null;
    }
    seen.set(f.id, f);
  }

  const baseRate = clamp(Number(raw.baseRate) || 0.5, 0.001, 0.999);
  for (const f of factors) if (f.kind === 'evidence') makeCoherent(f.options, baseRate);
  return {
    id: slugify(raw.id || raw.title || raw.question, 'prediction'),
    title: String(raw.title || raw.question || 'Prediction').trim().slice(0, 120),
    question: String(raw.question || raw.title || '').trim().slice(0, 300),
    outcome: String(raw.outcome || raw.question || '').trim().slice(0, 400),
    horizon: String(raw.horizon || '').trim().slice(0, 120),
    domain: String(raw.domain || 'general').trim().slice(0, 40),
    baseRate,
    baseRateNote: String(raw.baseRateNote || '').trim().slice(0, 500),
    baseRateUncertainty: clamp(Number(raw.baseRateUncertainty) || 0.35, 0.05, 1.5),
    // How much the questions share the same underlying signal (0..0.8), as
    // judged by the model's author. tuneDependence() turns it into ρ.
    overlap: clamp(raw.overlap === undefined ? 0.35 : Number(raw.overlap) || 0, 0, 0.8),
    dependence: clamp(raw.dependence === undefined ? 0.1 : Number(raw.dependence) || 0, 0, 0.8),
    dependenceTuned: Boolean(raw.dependenceTuned),
    caveat: String(raw.caveat || '').trim().slice(0, 400),
    source: String(raw.source || 'custom'),
    factors,
  };
}

/**
 * Enforce the law of total probability on one factor.
 *
 * Each option has a population frequency m (its prior) and a likelihood ratio
 * L. For the factor to be coherent with base rate b, averaging the posterior
 * over the population must give b back:  Σ m·P(yes | option) = b.
 * Hand-set or LLM-set weights rarely satisfy this, which silently biases
 * every forecast up or down. We fix it with the unique scale λ such that the
 * implied P(option | no) = m / (b·λL + 1 − b) sums to 1, and use λL as the
 * effective likelihood ratio. Relative evidence between options is unchanged.
 * Idempotent: coherent weights give λ = 1.
 */
export function makeCoherent(options, b) {
  // The ±MAX_LOG_LR cap is applied inside the solve, so the capped weights
  // are themselves coherent and re-validating a model never changes it.
  const total = (shift) =>
    options.reduce((s, o) => s + o.prior / (b * Math.exp(clamp(o.logLR + shift, -MAX_LOG_LR, MAX_LOG_LR)) + 1 - b), 0);
  // total() is continuous and decreasing, > 1 at shift −30 and < 1 at +30,
  // so bisection finds the root.
  let lo = -30;
  let hi = 30;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > 1) lo = mid;
    else hi = mid;
  }
  const shift = (lo + hi) / 2;
  for (const o of options) {
    o.rawLogLR = o.rawLogLR ?? o.logLR;
    o.logLR = clamp(o.logLR + shift, -MAX_LOG_LR, MAX_LOG_LR);
  }
  return shift;
}

/**
 * Keep only answers that refer to a real factor and a real option (or SKIP).
 * Anything else — strings, prototype keys, out-of-range indexes — is dropped.
 */
export function cleanAnswers(model, answers) {
  const out = {};
  if (!answers || typeof answers !== 'object') return out;
  for (const f of model.factors) {
    if (!Object.prototype.hasOwnProperty.call(answers, f.id)) continue;
    const v = answers[f.id];
    if (Number.isInteger(v) && v >= SKIP && v < f.options.length) out[f.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const isAnswered = (answers, id) =>
  answers && Object.prototype.hasOwnProperty.call(answers, id) && answers[id] !== undefined && answers[id] !== null;

/** Whether a conditional factor should be asked given the answers so far. */
export function isActive(factor, answers, model) {
  if (!factor.askIf) return true;
  const parentId = factor.askIf.factorId;
  if (!isAnswered(answers, parentId)) return false;
  const parent = model?.factors.find((f) => f.id === parentId);
  if (parent && !isActive(parent, answers, model)) return false;
  return factor.askIf.optionIndexes.includes(answers[parentId]);
}

function activeFactors(model, answers) {
  return model.factors.filter((f) => isActive(f, answers, model));
}

function chosenOption(factor, answers) {
  if (!isAnswered(answers, factor.id)) return null;
  const idx = answers[factor.id];
  if (idx === SKIP) return null;
  return factor.options[idx] ?? null;
}

function effectiveBaseRate(model, answers) {
  for (const f of model.factors) {
    if (f.kind !== 'prior' || !isActive(f, answers, model)) continue;
    const opt = chosenOption(f, answers);
    if (opt) return opt.p;
  }
  return model.baseRate;
}

const shrink = (model, n) => 1 / Math.sqrt(1 + model.dependence * Math.max(0, n - 1));

// ---------------------------------------------------------------------------
// Core inference
// ---------------------------------------------------------------------------

/**
 * Point estimate of the probability, given answers ({factorId: optionIndex}).
 * Unanswered and skipped questions contribute no evidence.
 */
export function posterior(model, answers = {}) {
  const base = effectiveBaseRate(model, answers);
  const evidence = [];
  let answered = 0;
  for (const f of activeFactors(model, answers)) {
    if (f.kind !== 'evidence') continue;
    const opt = chosenOption(f, answers);
    if (!opt) continue;
    // Every answered question counts toward the correlation correction, even a
    // neutral one; otherwise moving off a neutral answer would change the
    // shrink on everything else and could lower the forecast.
    answered++;
    if (opt.logLR !== 0) evidence.push({ factor: f, option: opt, logLR: opt.logLR });
  }
  const k = shrink(model, answered);
  const sum = evidence.reduce((s, e) => s + e.logLR, 0);
  const logOdds = logit(base) + k * sum;
  return {
    p: clamp(sigmoid(logOdds), 0.001, 0.999),
    rawP: sigmoid(logOdds),
    baseRate: base,
    logOdds,
    shrink: k,
    evidence: evidence.map((e) => ({ ...e, scaled: e.logLR * k })),
  };
}

/** Questions that are still open (active, unanswered). */
export function remainingFactors(model, answers = {}) {
  return activeFactors(model, answers).filter((f) => !isAnswered(answers, f.id));
}

/**
 * How much could this question move the forecast? Returns the expected absolute
 * change in probability (in [0, 1]) and the expected information gain in bits,
 * using each option's prior as the predictive answer distribution.
 */
export function questionValue(model, answers, factor) {
  const now = posterior(model, answers).p;
  let expectedShift = 0;
  let expectedEntropy = 0;
  let maxShift = 0;
  for (let i = 0; i < factor.options.length; i++) {
    const p = posterior(model, { ...answers, [factor.id]: i }).p;
    const w = factor.options[i].prior;
    expectedShift += w * Math.abs(p - now);
    expectedEntropy += w * entropy(p);
    maxShift = Math.max(maxShift, Math.abs(p - now));
  }
  return { expectedShift, maxShift, bits: Math.max(0, entropy(now) - expectedEntropy) };
}

/**
 * Adaptive interviewing: pick the open question with the largest expected
 * impact on the forecast. Prior (reference-class) questions always go first,
 * because they reframe every other answer.
 */
export function nextQuestion(model, answers = {}) {
  const open = remainingFactors(model, answers);
  if (!open.length) return null;
  const prior = open.find((f) => f.kind === 'prior');
  if (prior) return { factor: prior, value: { expectedShift: 1, maxShift: 1, bits: 1 } };
  let best = null;
  for (const f of open) {
    const value = questionValue(model, answers, f);
    // Small bonus for controllable factors: they feed the action plan.
    const score = value.expectedShift * (f.controllable ? 1.08 : 1);
    if (!best || score > best.score) best = { factor: f, value, score };
  }
  return best;
}

/**
 * Monte Carlo over epistemic uncertainty:
 *  - the base rate (logit-normal around the chosen value),
 *  - each answered factor's evidence weight (normal, sd grows with |logLR|),
 *  - every unanswered question (answer drawn from its option priors).
 */
export function simulate(model, answers = {}, { n = 4000, seed } = {}) {
  const rand = mulberry32(seed ?? hashString(model.id + JSON.stringify(answers)));
  const base = effectiveBaseRate(model, answers);
  const L0 = logit(base);
  const samples = new Float64Array(n);

  for (let s = 0; s < n; s++) {
    // Resolve the active set per sample, because unanswered parent questions
    // decide which conditional questions exist in that simulated world.
    const world = { ...answers };
    let sum = 0;
    let count = 0;
    for (const f of model.factors) {
      if (!isActive(f, world, model)) continue;
      if (f.kind === 'prior') continue;
      let opt = chosenOption(f, world);
      if (!isAnswered(world, f.id)) {
        let r = rand();
        let idx = f.options.length - 1;
        for (let i = 0; i < f.options.length; i++) {
          r -= f.options[i].prior;
          if (r <= 0) {
            idx = i;
            break;
          }
        }
        world[f.id] = idx;
        opt = f.options[idx];
      }
      if (!opt) continue;
      count++;
      if (opt.logLR === 0) continue;
      const sd = 0.25 * Math.abs(opt.logLR) + 0.08;
      sum += opt.logLR + sd * gaussian(rand);
    }
    const prior = L0 + model.baseRateUncertainty * gaussian(rand);
    samples[s] = sigmoid(prior + shrink(model, count) * sum);
  }

  const sorted = Array.from(samples).sort((a, b) => a - b);
  const bins = new Array(20).fill(0);
  for (const v of sorted) bins[Math.min(19, Math.floor(v * 20))]++;
  return {
    n,
    mean: sorted.reduce((s, v) => s + v, 0) / n,
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    histogram: bins.map((c) => c / n),
  };
}

/** Leave-one-out contribution of each answered factor, in probability points. */
export function contributions(model, answers = {}) {
  const full = posterior(model, answers);
  const out = [];
  for (const e of full.evidence) {
    const without = posterior(model, { ...answers, [e.factor.id]: SKIP }).rawP;
    out.push({
      id: e.factor.id,
      label: e.factor.label,
      answer: e.option.label,
      logLR: e.logLR,
      delta: full.rawP - without,
      controllable: e.factor.controllable,
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * Waterfall from the base rate to the final estimate. Steps are ordered by
 * magnitude and use the final shrink factor so they sum exactly to the result.
 */
export function waterfall(model, answers = {}) {
  const post = posterior(model, answers);
  let lo = logit(post.baseRate);
  const steps = [{ label: 'Base rate', p: post.baseRate, delta: 0 }];
  const ordered = [...post.evidence].sort((a, b) => Math.abs(b.scaled) - Math.abs(a.scaled));
  for (const e of ordered) {
    const before = sigmoid(lo);
    lo += e.scaled;
    const after = sigmoid(lo);
    steps.push({ id: e.factor.id, label: e.factor.label, answer: e.option.label, p: after, delta: after - before });
  }
  return steps;
}

/** For each controllable answered factor, the best alternative answer. */
export function levers(model, answers = {}) {
  // Unclamped probabilities, so levers still show up at extreme odds.
  const now = posterior(model, answers).rawP;
  const out = [];
  for (const f of activeFactors(model, answers)) {
    if (!f.controllable || f.kind !== 'evidence' || !isAnswered(answers, f.id)) continue;
    const current = answers[f.id];
    let best = null;
    f.options.forEach((opt, i) => {
      if (i === current) return;
      const p = posterior(model, { ...answers, [f.id]: i }).rawP;
      if (!best || p > best.p) best = { index: i, option: opt, p };
    });
    if (best && best.p - now > 0.0005) {
      out.push({
        id: f.id,
        label: f.label,
        from: current === SKIP ? 'Not answered' : f.options[current]?.label,
        to: best.option.label,
        toIndex: best.index,
        p: best.p,
        delta: best.p - now,
      });
    }
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/**
 * Greedy "path to yes": the fewest controllable changes that lift the
 * probability past `target`. Returns the steps taken and where they land.
 */
export function pathTo(model, answers = {}, target = 0.5) {
  let current = { ...answers };
  const steps = [];
  let p = posterior(model, current).rawP;
  for (let guard = 0; guard < model.factors.length && p < target; guard++) {
    const [best] = levers(model, current);
    if (!best) break;
    current = { ...current, [best.id]: best.toIndex };
    p = best.p;
    steps.push({ ...best });
  }
  return { reached: p >= target, p, steps, answers: current };
}

const VERDICTS = [
  [0.05, 'Very unlikely', 'very-low'],
  [0.2, 'Unlikely', 'low'],
  [0.4, 'Leaning no', 'mid-low'],
  [0.6, 'Toss-up', 'mid'],
  [0.8, 'Leaning yes', 'mid-high'],
  [0.95, 'Likely', 'high'],
  [1.01, 'Very likely', 'very-high'],
];

export function verdict(p) {
  const [, label, tone] = VERDICTS.find(([max]) => p < max);
  return { label, tone };
}

/** How much of the model's evidence has been collected, 0..1. */
export function coverage(model, answers = {}) {
  let total = 0;
  let got = 0;
  for (const f of activeFactors(model, answers)) {
    if (f.kind !== 'evidence') continue;
    const spread = Math.max(...f.options.map((o) => o.logLR)) - Math.min(...f.options.map((o) => o.logLR));
    total += spread;
    if (isAnswered(answers, f.id) && answers[f.id] !== SKIP) got += spread;
  }
  return total ? got / total : 1;
}

/** Everything the UI needs, in one call. */
export function analyze(model, answers = {}, { target = 0.5, simulations = 4000 } = {}) {
  const post = posterior(model, answers);
  const sim = simulate(model, answers, { n: simulations });
  const cov = coverage(model, answers);
  const allLevers = levers(model, answers);
  const maxed = pathTo(model, answers, 1.01);
  return {
    p: post.p,
    baseRate: post.baseRate,
    verdict: verdict(post.p),
    interval: { low: sim.p10, high: sim.p90 },
    simulation: sim,
    coverage: cov,
    answered: Object.values(answers).filter((v) => v !== SKIP).length,
    contributions: contributions(model, answers),
    waterfall: waterfall(model, answers),
    levers: allLevers,
    path: pathTo(model, answers, Math.max(target, post.p < target ? target : Math.min(0.95, post.p + 0.15))),
    scenarios: {
      pessimistic: sim.p10,
      expected: post.p,
      optimistic: sim.p90,
      fullPotential: maxed.p,
    },
  };
}
