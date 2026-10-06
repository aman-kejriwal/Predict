#!/usr/bin/env node
// Oracle in the terminal: `npm run cli -- "Will I be rich in the future?"`
// Add --offline to skip Claude even when ANTHROPIC_API_KEY is set.

import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { SKIP, analyze, nextQuestion, posterior, validateModel } from './engine/core.js';
import { matchLibrary } from './engine/library.js';
import { offlineNarrative } from './engine/narrative.js';
import { aiAvailable, buildModel, followUps, narrate } from './server/oracle-ai.js';

// Load .env if present (Node 20.12+); real environment variables win.
try {
  process.loadEnvFile?.();
} catch {}

const args = process.argv.slice(2);
const offline = args.includes('--offline') || !aiAvailable();
const color = output.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c('1');
const dim = c('2');
const violet = c('38;5;141');
const cyan = c('38;5;87');
const green = c('38;5;84');
const red = c('38;5;204');
const pct = (p) => `${Math.round(p * 100)}%`;

function bar(p, width = 30) {
  const n = Math.round(p * width);
  return violet('█'.repeat(n)) + dim('░'.repeat(width - n));
}

async function main() {
  const rl = readline.createInterface({ input, output, terminal: output.isTTY });
  // Read lines through one iterator so piped input isn't dropped between prompts.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt) => {
    output.write(prompt);
    const { value, done } = await lines.next();
    if (done) return null;
    if (!output.isTTY) output.write(`${value}\n`);
    return value;
  };
  try {
    console.log(`\n  ${violet('◉')} ${bold('ORACLE')} ${dim('— predict anything')}  ${offline ? dim('[offline models]') : cyan('[Claude]')}\n`);
    let question = args.filter((a) => !a.startsWith('--')).join(' ').trim();
    while (question.length < 3) {
      const line = await ask(`  ${bold('What do you want to predict?')} `);
      if (line === null) return;
      question = line.trim();
    }

    let model;
    let presets = {};
    if (offline) {
      model = validateModel(matchLibrary(question).model);
    } else {
      console.log(dim('\n  Claude is designing your forecasting model…'));
      try {
        ({ model, presets } = await buildModel(question));
      } catch (err) {
        console.log(red(`  Claude unavailable (${err.message}); using built-in model.`));
        model = validateModel(matchLibrary(question).model);
      }
    }

    console.log(`\n  ${bold(model.title)}`);
    console.log(`  ${dim('Resolves YES if:')} ${model.outcome}`);
    if (model.horizon) console.log(`  ${dim('Horizon:')} ${model.horizon}`);
    console.log(`  ${dim('Base rate:')} ${pct(model.baseRate)} ${dim('— ' + model.baseRateNote)}\n`);
    console.log(dim('  Answer with the option number. 0 = not sure, q = reveal now.\n'));

    const answers = { ...presets };
    let asked = 0;
    let followed = offline;
    for (;;) {
      const next = nextQuestion(model, answers);
      if (!next || (asked >= 6 && next.value.maxShift < 0.01 && next.factor.kind !== 'prior')) {
        if (!followed && asked >= 3) {
          followed = true;
          console.log(dim('  Reviewing your answers for follow-ups…'));
          try {
            const extra = await followUps(model, answers);
            if (extra.factors.length) {
              model = validateModel({ ...model, factors: [...model.factors, ...extra.factors] });
              console.log(cyan(`  ✦ ${extra.note}\n`));
              continue;
            }
          } catch {}
        }
        break;
      }
      const f = next.factor;
      asked++;
      console.log(`  ${cyan(`Q${asked}`)} ${bold(f.question)}`);
      f.options.forEach((o, i) => console.log(`     ${dim(`${i + 1}.`)} ${o.label}`));
      let choice;
      for (;;) {
        const line = await ask(`     ${dim('›')} `);
        const raw = (line ?? 'q').trim().toLowerCase();
        if (raw === 'q') break;
        const n = Number(raw);
        if (raw === '0' || raw === '') {
          choice = SKIP;
          break;
        }
        if (Number.isInteger(n) && n >= 1 && n <= f.options.length) {
          choice = n - 1;
          break;
        }
      }
      if (choice === undefined) break;
      answers[f.id] = choice;
      const p = posterior(model, answers).p;
      console.log(`     ${bar(p, 20)} ${bold(pct(p))}\n`);
    }

    const r = analyze(model, answers);
    console.log(`\n  ${'─'.repeat(56)}`);
    console.log(`  ${bold('FORECAST')}  ${bar(r.p)}  ${bold(pct(r.p))}  ${cyan(r.verdict.label)}`);
    console.log(`  ${dim(`80% range ${pct(r.interval.low)}–${pct(r.interval.high)} · base rate ${pct(r.baseRate)} · confidence ${pct(r.confidence)}`)}`);
    console.log(`  ${'─'.repeat(56)}\n`);

    if (r.contributions.length) {
      console.log(`  ${bold('What drives it')}`);
      for (const ctr of r.contributions.slice(0, 6)) {
        const d = `${ctr.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(ctr.delta * 100))}`.padStart(4);
        console.log(`   ${ctr.delta >= 0 ? green(d) : red(d)} pts  ${ctr.label} ${dim(`(${ctr.answer})`)}`);
      }
      console.log('');
    }
    if (r.levers.length) {
      console.log(`  ${bold('Your biggest levers')}`);
      for (const l of r.levers.slice(0, 4)) console.log(`   ${green(`+${Math.round(l.delta * 100)}`.padStart(4))} pts  ${l.label}: ${dim(l.from)} → ${l.to}`);
      console.log('');
    }
    console.log(`  ${bold('Scenarios')}  pessimistic ${pct(r.scenarios.pessimistic)} · expected ${pct(r.scenarios.expected)} · optimistic ${pct(r.scenarios.optimistic)} · full potential ${pct(r.scenarios.fullPotential)}\n`);

    let n = offlineNarrative(model, r);
    if (!offline) {
      try {
        n = await narrate(model, answers, r);
      } catch {}
    }
    console.log(`  ${violet('✦')} ${bold(n.headline)}`);
    console.log(`  ${n.summary}\n`);
    console.log(`  ${cyan('Insight:')} ${n.insight}\n`);
    if (n.plan?.length) {
      console.log(`  ${bold('Action plan')}`);
      n.plan.forEach((p, i) => console.log(`   ${i + 1}. ${p.action} ${dim(p.impact || '')}`));
      console.log('');
    }
    if (n.caveat) console.log(dim(`  ⚠ ${n.caveat}\n`));
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
