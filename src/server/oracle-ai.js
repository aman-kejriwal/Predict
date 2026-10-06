// Claude-powered model builder. Claude acts as a superforecaster that designs a
// bespoke forecasting model for any question (outcome definition, reference-
// class base rate, factors, calibrated evidence weights). The arithmetic is
// then done by the transparent engine in src/engine/core.js, so every number
// the user sees can be traced and challenged.

import Anthropic from '@anthropic-ai/sdk';
import { validateModel, slugify, SKIP } from '../engine/core.js';

// Read lazily so a .env file loaded at startup is honoured.
const modelId = () => process.env.ORACLE_MODEL || 'claude-opus-5-5';
const defaultEffort = () => process.env.ORACLE_EFFORT || 'medium';

let client = null;

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: 120_000 });
  return client;
}

export class RefusalError extends Error {}

// ---------------------------------------------------------------------------
// Schemas (structured outputs)
// ---------------------------------------------------------------------------

const optionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'logLR', 'prior', 'p'],
  properties: {
    label: { type: 'string', description: 'Short answer text shown on a button.' },
    logLR: {
      type: 'number',
      description:
        'Evidence weight: natural log of P(answer | outcome happens) / P(answer | it does not). ±0.2 weak, ±0.5 moderate, ±1.0 strong, ±2.0 near-decisive. 0 for neutral answers and for all options of a prior factor.',
    },
    prior: { type: 'number', description: 'Relative frequency of this answer among people asking this question (any positive number).' },
    p: { type: 'number', description: 'Only for kind="prior" factors: the base rate this answer implies (0-1). Use 0 for evidence factors.' },
  },
};

const factorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'label', 'question', 'why', 'type', 'controllable', 'askIfFactorId', 'askIfOptionIndexes', 'presetAnswer', 'options'],
  properties: {
    id: { type: 'string', description: 'snake_case identifier, unique.' },
    kind: { type: 'string', enum: ['evidence', 'prior'] },
    label: { type: 'string', description: '1-3 word factor name, e.g. "Savings rate".' },
    question: { type: 'string', description: 'The question asked to the user, in second person, plain language.' },
    why: { type: 'string', description: 'One or two sentences on why this factor matters, citing research or reasoning where possible.' },
    type: { type: 'string', enum: ['choice', 'scale', 'yesno'], description: 'scale = options are ordered low→high; yesno = exactly two options Yes/No.' },
    controllable: { type: 'boolean', description: 'True if the user can realistically change this answer through their own actions.' },
    askIfFactorId: { type: 'string', description: 'If this is a follow-up that only makes sense for certain answers to an EARLIER factor, that factor id; otherwise "".' },
    askIfOptionIndexes: { type: 'array', items: { type: 'integer' }, description: 'Option indexes of askIfFactorId that trigger this question; [] if none.' },
    presetAnswer: { type: 'integer', description: 'If the user’s context already answers this question, the option index; otherwise -1.' },
    options: { type: 'array', items: optionSchema },
  },
};

const modelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'outcome', 'horizon', 'domain', 'interpretation', 'baseRate', 'baseRateNote', 'baseRateUncertainty', 'overlap', 'caveat', 'factors'],
  properties: {
    title: { type: 'string', description: 'Short, punchy title for the prediction (max ~8 words).' },
    outcome: { type: 'string', description: 'Precise, resolvable definition of YES. Someone should be able to check it later without arguing.' },
    horizon: { type: 'string', description: 'The time frame, e.g. "By age 50" or "Within 12 months".' },
    domain: { type: 'string', description: 'One word: finance, career, health, relationships, education, business, sports, personal, world, etc.' },
    interpretation: { type: 'string', description: 'If you had to interpret or reframe the question to make it forecastable, explain how in one sentence; otherwise "".' },
    baseRate: { type: 'number', description: 'Probability of YES for the reference class BEFORE knowing anything specific about this person (0-1).' },
    baseRateNote: { type: 'string', description: 'The reference class and where the base rate comes from, in 1-2 sentences.' },
    baseRateUncertainty: { type: 'number', description: 'Your uncertainty about the base rate as a standard deviation in log-odds (0.1 confident ... 1.0 very unsure).' },
    overlap: { type: 'number', description: 'Share of the factors\' predictive signal that comes from a common underlying trait rather than independent information (0 = fully independent factors, 0.3 = typical, 0.6+ = factors mostly measure the same thing). Oracle uses this to tune its correlation correction by simulation.' },
    caveat: { type: 'string', description: 'One sentence of honest limitation or safety note (e.g. not medical advice); "" if none needed.' },
    factors: { type: 'array', items: factorSchema },
  },
};

const followUpSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['note', 'factors'],
  properties: {
    note: { type: 'string', description: 'One sentence telling the user why you want to dig deeper, referencing what they said.' },
    factors: { type: 'array', items: factorSchema },
  },
};

const narrativeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'insight', 'plan', 'signposts', 'caveat'],
  properties: {
    headline: { type: 'string', description: 'One vivid sentence capturing the forecast. Must agree with the computed probability.' },
    summary: { type: 'string', description: '3-5 sentences explaining the forecast in plain language: base rate, what moved it, and the uncertainty.' },
    insight: { type: 'string', description: 'The single most non-obvious, useful insight from this person’s answers.' },
    plan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'impact'],
        properties: {
          action: { type: 'string', description: 'A concrete, specific action for the next 30-90 days.' },
          impact: { type: 'string', description: 'Expected effect, using the computed lever numbers where available.' },
        },
      },
    },
    signposts: { type: 'array', items: { type: 'string' }, description: '2-4 early warning signs or milestones that would tell the user the forecast is changing.' },
    caveat: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM = `You are Oracle, a world-class superforecaster and decision scientist. People ask you to predict things about their lives or the world. You never just guess: you design an explicit, quantitative forecasting model and interview the person to fill it in.

How you build a model:
1. Turn the question into a precise, resolvable outcome with a time horizon. If the question is vague ("will I be rich?"), choose the most sensible concrete reading and state it in "interpretation". Questions asking for a number become a threshold question that captures what the person cares about.
2. Take the outside view first: pick the right reference class and give an honest, research-informed base rate. Do not inflate it to be encouraging.
3. Choose 7-12 factors that most strongly separate YES from NO for this reference class. Prefer factors with real predictive evidence behind them. Include both things the person controls and things they don't. Order them roughly from most to least informative.
4. If the base rate depends heavily on details you cannot know (e.g. which exam, which sport, which company), make the FIRST factor kind="prior": its options each set a base rate via "p" (logLR 0), and set the top-level baseRate to a sensible default.
5. Write each question so it is quick to answer with buttons: 2-6 mutually exclusive, exhaustive options. Use concrete ranges and plain language. Avoid asking for information that is sensitive without a strong predictive reason.
6. Calibrate evidence (logLR) carefully. Most options should sit between -1 and +1. Reserve |logLR| > 1.5 for near-decisive evidence. Neutral/typical answers should be near 0. Options' "prior" should reflect how common each answer is.
7. You may add up to 2 conditional follow-up factors using askIfFactorId/askIfOptionIndexes that only appear for relevant earlier answers.

Be warm but honest. Never refuse to forecast something just because it is uncertain — uncertainty is what the model quantifies. If a question is about harming someone, or about a specific private person's health, death or secrets, reframe it toward what the asker can know and influence, and say so in "interpretation".`;

function describeAnswers(model, answers) {
  const lines = [];
  for (const f of model.factors) {
    if (!(f.id in answers)) continue;
    const idx = answers[f.id];
    lines.push(`- ${f.question} → ${idx === SKIP ? '(skipped / not sure)' : f.options[idx]?.label}`);
  }
  return lines.join('\n') || '(no answers yet)';
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

async function callJSON({ system, prompt, schema, effort = defaultEffort(), maxTokens = 16000 }) {
  const response = await getClient().beta.messages.create({
    model: modelId(),
    max_tokens: maxTokens,
    // If a safety classifier declines, retry server-side on Anthropic's
    // recommended fallback model instead of failing the request.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new RefusalError(response.stop_details?.explanation || 'Oracle declined to forecast this question.');
  }
  if (response.stop_reason === 'max_tokens') throw new Error('The model response was cut off. Please try again.');

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Could not parse the model response. Please try again.');
  }
}

function toEngineFactor(f) {
  return {
    ...f,
    askIf: f.askIfFactorId ? { factorId: f.askIfFactorId, optionIndexes: f.askIfOptionIndexes || [] } : null,
  };
}

/** Build a bespoke model. Returns { model, presets, interpretation }. */
export async function buildModel(question, context = '') {
  const prompt = [
    `Question to forecast: ${question}`,
    context ? `\nWhat the person already told you about themselves:\n${context}\n\nFor every factor this context clearly answers, set presetAnswer to the matching option index. Still include the factor.` : '',
    `\nToday's date: ${new Date().toISOString().slice(0, 10)}.`,
    '\nDesign the forecasting model now.',
  ].join('');

  const raw = await callJSON({ system: SYSTEM, prompt, schema: modelSchema });
  const model = validateModel({
    ...raw,
    question,
    source: 'claude',
    factors: (raw.factors || []).map(toEngineFactor),
  });

  const presets = {};
  // Presets only make sense when the user actually told us something.
  for (const f of context ? raw.factors || [] : []) {
    const engineFactor = model.factors.find((m) => m.id === slugify(f.id || f.label || f.question));
    const idx = Number(f.presetAnswer);
    if (engineFactor && Number.isInteger(idx) && idx >= 0 && idx < engineFactor.options.length) {
      presets[engineFactor.id] = idx;
    }
  }
  return { model, presets, interpretation: String(raw.interpretation || '') };
}

/** Ask Claude for up to three personalised follow-up questions. */
export async function followUps(model, answers) {
  const prompt = `Forecast: ${model.title}
Outcome: ${model.outcome} (${model.horizon})
Base rate: ${Math.round(model.baseRate * 100)}% — ${model.baseRateNote}

Existing factors (do not repeat these): ${model.factors.map((f) => f.id).join(', ')}

The person answered:
${describeAnswers(model, answers)}

Based on these specific answers, propose 0-3 NEW follow-up questions that would most change the forecast for THIS person — the things a sharp human expert would now want to dig into. Use new unique ids, kind "evidence", no askIf, presetAnswer -1. If nothing important is missing, return an empty list.`;

  const raw = await callJSON({ system: SYSTEM, prompt, schema: followUpSchema, effort: 'low' });
  const existing = new Set(model.factors.map((f) => f.id));
  const extra = (raw.factors || []).slice(0, 3).map((f) => ({ ...toEngineFactor(f), askIf: null, kind: 'evidence' }));
  const merged = validateModel({ ...model, factors: [...model.factors, ...extra] });
  const added = merged.factors.filter((f) => !existing.has(f.id));
  return { factors: added, note: String(raw.note || '') };
}

/** Personalised write-up of a finished forecast. */
export async function narrate(model, answers, result) {
  const pct = (p) => `${Math.round(p * 100)}%`;
  const prompt = `Write the forecast reading for this person.

Forecast: ${model.title}
Outcome: ${model.outcome} (${model.horizon})
Base rate: ${pct(result.baseRate)} — ${model.baseRateNote}
FINAL PROBABILITY (computed, do not change): ${pct(result.p)} (80% interval ${pct(result.interval.low)}–${pct(result.interval.high)})

Their answers:
${describeAnswers(model, answers)}

Biggest drivers (leave-one-out, probability points):
${result.contributions.slice(0, 6).map((c) => `- ${c.label} = "${c.answer}": ${c.delta >= 0 ? '+' : ''}${Math.round(c.delta * 100)}`).join('\n') || '- none'}

Best levers (changing one answer):
${result.levers.slice(0, 5).map((l) => `- ${l.label}: "${l.from}" → "${l.to}" gives ${pct(l.p)} (+${Math.round(l.delta * 100)})`).join('\n') || '- none'}

Speak directly to the person ("you"). Be specific to their answers, honest about bad news, and genuinely useful. Plan: 3-5 concrete actions ordered by impact. Keep the headline consistent with ${pct(result.p)}.`;

  return callJSON({ system: SYSTEM, prompt, schema: narrativeSchema, effort: 'low' });
}
