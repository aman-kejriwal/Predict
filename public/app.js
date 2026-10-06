import { SKIP, analyze, nextQuestion, posterior, remainingFactors, simulate, contributions, validateModel, isActive, cleanAnswers } from '/engine/core.js';
import { tuneDependence, calibrationStudy } from '/engine/calibration.js';
import { offlineNarrative } from '/engine/narrative.js';
import { matchLibrary } from '/engine/library.js';
import { gauge, sparkline, iconArray, histogram, waterfallChart } from '/viz.js';
import { journal } from '/journal.js';

// ---------------------------------------------------------------------------
// State & helpers
// ---------------------------------------------------------------------------

const S = {
  status: { ai: false, model: null },
  staticMode: false,
  question: '',
  context: '',
  model: null,
  answers: {},
  presets: {},
  order: [],
  trail: [],
  followupsDone: false,
  followupNote: '',
  interpretation: '',
  source: '',
  baseline: null,
  whatIf: null,
  narrative: null,
  journalId: null,
};

const MIN_ANSWERS_TO_REVEAL = 3;
const $ = (id) => document.getElementById(id);
const pct = (p) => `${Math.round(p * 100)}%`;
const signedPts = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EXAMPLES = [
  'Will I be rich in the future?',
  'Will my startup succeed?',
  'Will I live to 90?',
  'Will I land my dream job this year?',
  'Will my relationship last?',
  'Will I crack my entrance exam?',
  'Will I lose 10 kg this year?',
  'Will I stick to learning Spanish?',
  'Will I become a successful YouTuber?',
  'Will I move abroad within 5 years?',
];

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  document.body.dataset.view = view;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function initTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem('oracle.theme');
  } catch {}
  if (!theme) theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('oracle.theme', next);
    } catch {}
  };
}

async function boot() {
  initTheme();
  $('examples').innerHTML = EXAMPLES.map((q) => `<button class="chip" type="button">${esc(q)}</button>`).join('');
  $('examples').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('question').value = chip.textContent;
    startPrediction();
  };
  $('ask-form').onsubmit = (e) => {
    e.preventDefault();
    startPrediction();
  };
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    e.preventDefault();
    if (nav.dataset.nav === 'home') goHome();
    if (nav.dataset.nav === 'journal') renderJournal();
  });
  bindInterview();
  bindResult();
  bindJournal();
  updateJournalCount();

  try {
    S.status = await api('/api/status');
  } catch {
    S.staticMode = true;
  }
  const badge = $('mode-badge');
  if (S.status.ai) {
    badge.textContent = `✦ Claude · ${S.status.model}`;
    badge.classList.add('ai');
    badge.title = 'Claude builds a bespoke forecasting model for every question.';
  } else {
    badge.textContent = 'Offline models';
    badge.title = 'Using built-in models. Start the server with ANTHROPIC_API_KEY set to let Claude model any question.';
  }

  if (location.hash.startsWith('#r=')) {
    try {
      await openShared(location.hash.slice(3));
      return;
    } catch (err) {
      console.error(err);
      toast('That share link could not be opened.');
    }
  }
  show('home');
}

function goHome() {
  history.replaceState(null, '', location.pathname);
  show('home');
  $('question').focus();
}

// ---------------------------------------------------------------------------
// 1. Build the model
// ---------------------------------------------------------------------------

async function startPrediction() {
  const question = $('question').value.trim();
  if (question.length < 3) {
    $('question').focus();
    return;
  }
  S.question = question;
  S.context = $('context').value.trim();
  show('loading');
  $('loading-title').textContent = S.status.ai ? 'Claude is designing your forecasting model…' : 'Loading your forecasting model…';
  const steps = [...$('loading-steps').children];
  steps.forEach((li) => (li.className = ''));
  let i = 0;
  steps[0].className = 'active';
  const stepTimer = setInterval(
    () => {
      if (i < steps.length - 1) {
        steps[i].className = 'done';
        steps[++i].className = 'active';
      }
    },
    S.status.ai ? 2600 : 350,
  );

  const started = Date.now();
  const elapsedTimer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    $('loading-elapsed').textContent = S.status.ai && sec > 3 ? `${sec}s · Claude usually takes 20–60 seconds to design a model` : '';
  }, 1000);
  $('loading-elapsed').textContent = '';
  try {
    let built;
    if (S.staticMode) {
      const { model, score } = matchLibrary(question);
      built = { model: tuneDependence(validateModel(model)), presets: {}, interpretation: '', source: score ? 'library' : 'generic' };
    } else {
      built = await api('/api/model', { question, context: S.context });
    }
    const minWait = S.status.ai ? 0 : 1400;
    await sleep(Math.max(0, minWait - (Date.now() - started)));
    steps.forEach((li) => (li.className = 'done'));
    await sleep(250);

    S.model = validateModel(built.model);
    S.presets = cleanAnswers(S.model, built.presets);
    S.interpretation = built.interpretation || '';
    S.source = built.source;
    S.followupsDone = false;
    S.followupNote = '';
    S.journalId = null;
    if (built.warning) toast(built.warning, 4000);
    renderFraming();
  } catch (err) {
    toast(err.message || 'Something went wrong.', 4500);
    show('home');
  } finally {
    clearInterval(stepTimer);
    clearInterval(elapsedTimer);
  }
}

function renderFraming() {
  const m = S.model;
  const sourceLabel = { claude: '✦ Bespoke model by Claude', library: 'Built-in expert model', generic: 'Universal forecasting model' }[S.source] || 'Forecasting model';
  $('frame-source').textContent = sourceLabel;
  $('frame-title').textContent = m.title;
  $('frame-interp').hidden = !S.interpretation;
  $('frame-interp').textContent = S.interpretation ? `How I read your question: ${S.interpretation}` : '';
  $('frame-outcome').textContent = m.outcome;
  $('frame-horizon').textContent = m.horizon || '—';
  const hasPriorQ = m.factors.some((f) => f.kind === 'prior');
  $('frame-base').textContent = hasPriorQ ? 'Depends on your situation' : `${pct(m.baseRate)} of people like you`;
  $('frame-base-note').textContent = m.baseRateNote;
  iconArray($('frame-icons'), hasPriorQ ? 0 : m.baseRate);
  const presetCount = Object.keys(S.presets).length;
  $('frame-presets').hidden = !presetCount;
  $('frame-presets').textContent = presetCount ? `✓ Your context already answered ${presetCount} question${presetCount > 1 ? 's' : ''}. You can change them in the what-if lab later.` : '';
  const qCount = m.factors.filter((f) => !f.askIf).length - presetCount;
  $('frame-qcount').textContent = `· about ${Math.max(qCount, 1)} questions`;
  show('framing');
}

// ---------------------------------------------------------------------------
// 2. Adaptive interview
// ---------------------------------------------------------------------------

function bindInterview() {
  $('start-interview').onclick = () => {
    S.answers = { ...S.presets };
    S.order = [];
    S.trail = [posterior(S.model, S.answers).p];
    $('followup-note').hidden = true;
    show('interview');
    renderQuestion();
  };
  $('q-back').onclick = goBack;
  $('q-skip').onclick = () => answer(SKIP);
  $('reveal-now').onclick = reveal;
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'interview' || e.target.closest('input, textarea, select')) return;
    if (/^[1-9]$/.test(e.key)) {
      const btn = $('q-options').children[Number(e.key) - 1];
      if (btn) btn.click();
    } else if (e.key === '0' || e.key.toLowerCase() === 's') {
      answer(SKIP);
    } else if (e.key === 'Backspace') {
      goBack();
    }
  });
}

let current = null;

async function renderQuestion() {
  const next = nextQuestion(S.model, S.answers);
  const asked = S.order.length;
  const settled = next && asked >= 6 && next.value.maxShift < 0.01 && next.factor.kind !== 'prior';

  if (!next || settled) {
    if (S.status.ai && !S.followupsDone && asked >= MIN_ANSWERS_TO_REVEAL) {
      await fetchFollowups();
      return renderQuestion();
    }
    return reveal();
  }

  current = next.factor;
  const card = $('qcard');
  card.classList.remove('swap');
  void card.offsetWidth;
  card.classList.add('swap');

  $('q-kicker').textContent = `Question ${asked + 1} · ${current.label}`;
  $('q-text').textContent = current.question;
  $('q-why').textContent = current.why || 'This helps pin down your odds.';
  $('q-value').textContent =
    current.kind === 'prior'
      ? 'This sets the starting point for everything else.'
      : `Depending on your answer, this could move your forecast by up to ${Math.max(1, Math.round(next.value.maxShift * 100))} points.`;
  const opts = $('q-options');
  opts.className = `options ${current.type}`;
  opts.innerHTML = current.options
    .map((o, i) => `<button class="opt${S.answers[current.id] === i ? ' selected' : ''}" data-i="${i}"><span class="key">${i + 1}</span><span>${esc(o.label)}</span></button>`)
    .join('');
  opts.onclick = (e) => {
    const b = e.target.closest('.opt');
    if (b) answer(Number(b.dataset.i));
  };
  $('q-back').style.visibility = S.order.length ? 'visible' : 'hidden';

  const remaining = remainingFactors(S.model, S.answers).length;
  $('progress-bar').style.width = `${Math.round((asked / (asked + remaining)) * 100)}%`;
  updateLive();
}

function answer(i) {
  if (!current) return;
  const id = current.id;
  current = null;
  S.answers[id] = i;
  S.order = S.order.filter((k) => k !== id).concat(id);
  S.trail.push(posterior(S.model, S.answers).p);
  renderQuestion();
}

function goBack() {
  const last = S.order.pop();
  if (!last) return;
  delete S.answers[last];
  // Conditional questions whose parent answer is gone are no longer relevant.
  for (const f of S.model.factors) {
    if (f.id in S.answers && !isActive(f, S.answers, S.model)) {
      delete S.answers[f.id];
      S.order = S.order.filter((k) => k !== f.id);
    }
  }
  S.trail.pop();
  renderQuestion();
}

function updateLive() {
  const post = posterior(S.model, S.answers);
  const sim = simulate(S.model, S.answers, { n: 700 });
  gauge($('live-gauge'), post.p, { size: 200, label: 'chance', band: [sim.p10, sim.p90] });
  sparkline($('live-spark'), S.trail);
  const n = S.order.filter((k) => S.answers[k] !== SKIP).length;
  $('reveal-now').disabled = n < MIN_ANSWERS_TO_REVEAL;
  $('reveal-hint').textContent =
    n < MIN_ANSWERS_TO_REVEAL
      ? `Answer ${MIN_ANSWERS_TO_REVEAL - n} more to unlock`
      : `80% range: ${pct(sim.p10)}–${pct(sim.p90)}. More answers narrow it.`;

  const contribs = contributions(S.model, S.answers);
  $('ledger').innerHTML = contribs.length
    ? contribs
        .map((c) => {
          const cls = Math.abs(c.delta) < 0.005 ? 'zero' : c.delta > 0 ? 'pos' : 'neg';
          return `<li title="${esc(c.answer)}"><span class="l-label">${esc(c.label)}</span><span class="delta ${cls}">${signedPts(c.delta)} pts</span></li>`;
        })
        .join('')
    : '<li class="empty">Your answers will show up here</li>';
}

async function fetchFollowups() {
  S.followupsDone = true;
  $('q-kicker').textContent = 'Thinking…';
  $('q-text').textContent = 'Oracle is reviewing your answers for anything worth digging into…';
  $('q-options').innerHTML = '<div class="skeleton"></div><div class="skeleton short"></div>';
  $('q-value').textContent = '';
  try {
    const res = await api('/api/followups', { model: S.model, answers: S.answers });
    if (res.factors?.length) {
      S.model = tuneDependence(validateModel({ ...S.model, factors: [...S.model.factors, ...res.factors] }));
      S.followupNote = res.note;
      const note = $('followup-note');
      note.hidden = false;
      note.innerHTML = `<p class="kicker">✦ Follow-up questions</p>${esc(res.note || 'A few more questions based on your answers.')}`;
    }
  } catch (err) {
    console.warn('follow-ups unavailable', err);
  }
}

// ---------------------------------------------------------------------------
// 3. Result
// ---------------------------------------------------------------------------

function reveal() {
  current = null;
  S.baseline = { ...S.answers };
  S.whatIf = { ...S.answers };
  S.narrative = null;
  S.journalId = null;
  show('result');
  renderResult();
  loadNarrative();
  history.replaceState(null, '', location.pathname);
}

function bindResult() {
  $('whatif-reset').onclick = () => {
    S.whatIf = { ...S.baseline };
    renderResult();
  };
  $('whatif-grid').onchange = (e) => {
    const sel = e.target.closest('select');
    if (!sel) return;
    const v = Number(sel.value);
    if (v === -2) delete S.whatIf[sel.dataset.id];
    else S.whatIf[sel.dataset.id] = v;
    // Drop answers to conditional questions that are no longer active.
    for (const f of S.model.factors) if (f.id in S.whatIf && !isActive(f, S.whatIf, S.model)) delete S.whatIf[f.id];
    renderResult();
  };
  $('r-levers').onclick = (e) => {
    const b = e.target.closest('[data-try]');
    if (!b) return;
    S.whatIf[b.dataset.try] = Number(b.dataset.to);
    renderResult();
    $('whatif-grid').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Applied in the what-if lab');
  };
  $('save-journal').onclick = openSaveDialog;
  $('share-link').onclick = copyShareLink;
  $('download-card').onclick = downloadCard;
  $('export-json').onclick = () => {
    const blob = new Blob([JSON.stringify({ model: S.model, answers: S.whatIf, result: summary(analyze(S.model, S.whatIf)) }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `oracle-${S.model.id}.json`);
  };
}

function summary(r) {
  return { probability: r.p, interval: r.interval, baseRate: r.baseRate, verdict: r.verdict.label, evidenceGathered: r.coverage };
}

function renderResult() {
  const m = S.model;
  const r = analyze(m, S.whatIf);
  const base = analyze(m, S.baseline);

  gauge($('result-gauge'), r.p, { size: 260, label: r.verdict.label, band: [r.interval.low, r.interval.high], big: true });
  $('r-title').textContent = m.title;
  $('r-outcome').textContent = `${m.outcome}${m.horizon ? ` · ${m.horizon}` : ''}`;
  $('r-interval').textContent = `${pct(r.interval.low)}–${pct(r.interval.high)}`;
  $('r-base').textContent = pct(r.baseRate);
  $('r-confidence').textContent = pct(r.coverage);
  const totalQs = m.factors.filter((f) => isActive(f, S.whatIf, m)).length;
  $('r-answered').textContent = `${r.answered}/${totalQs}`;

  if (!S.narrative) $('r-headline').textContent = offlineNarrative(m, r).headline;

  iconArray($('r-icons'), r.p);
  const n = Math.round(r.p * 100);
  $('r-icons-caption').textContent = `If 100 people gave exactly your answers, about ${n} would see this happen and ${100 - n} would not. Nobody can tell you in advance which group you are in. What you can do is change the odds.`;
  histogram($('r-dist'), r.simulation);
  waterfallChart($('r-waterfall'), r.waterfall, r.p);

  $('r-levers').innerHTML = r.levers.length
    ? r.levers
        .slice(0, 5)
        .map(
          (l) => `<li><div><strong>${esc(l.label)}</strong><div class="l-sub">${esc(l.from)} → ${esc(l.to)}</div></div>
            <button class="btn ghost small" data-try="${esc(l.id)}" data-to="${l.toIndex}" title="Try this in the what-if lab">${signedPts(l.delta)} pts</button></li>`,
        )
        .join('')
    : '<li><div class="muted">No controllable factor would raise your odds further. You are already doing what you can.</div><span></span></li>';
  const path = r.path;
  $('r-path').innerHTML =
    path.steps.length > 1 && path.p > r.p + 0.02
      ? `<strong>Path to ${pct(path.p)}:</strong> ${path.steps.map((s) => esc(s.label)).join(' → ')} <span class="muted">(${path.steps.length} changes)</span>`
      : '';

  const sc = r.scenarios;
  $('r-scenarios').innerHTML = [
    ['Pessimistic', sc.pessimistic, 'Things break against you (10th percentile)'],
    ['Expected', sc.expected, 'Your answers as given'],
    ['Optimistic', sc.optimistic, 'Things break your way (90th percentile)'],
    ['Full potential', sc.fullPotential, 'Every controllable factor at its best', true],
  ]
    .map(([name, p, desc, hl]) => `<div class="scenario${hl ? ' highlight' : ''}"><div class="s-name">${name}</div><div class="s-value">${pct(p)}</div><p class="s-desc">${desc}</p></div>`)
    .join('');

  renderWhatIf(r, base);
  renderMethod(r);
}

function renderWhatIf(r, base) {
  const m = S.model;
  const d = r.p - base.p;
  $('whatif-delta').innerHTML =
    Math.abs(d) < 0.005
      ? '<span class="muted">Original answers</span>'
      : `${pct(base.p)} → <strong>${pct(r.p)}</strong> <span class="delta ${d > 0 ? 'pos' : 'neg'}">(${signedPts(d)} pts)</span>`;
  $('whatif-grid').innerHTML = m.factors
    .filter((f) => isActive(f, S.whatIf, m))
    .map((f) => {
      const v = f.id in S.whatIf ? S.whatIf[f.id] : -2;
      const changed = v !== (f.id in S.baseline ? S.baseline[f.id] : -2);
      const opts = [`<option value="-2"${v === -2 ? ' selected' : ''}>— not answered —</option>`, `<option value="${SKIP}"${v === SKIP ? ' selected' : ''}>Not sure</option>`]
        .concat(f.options.map((o, i) => `<option value="${i}"${v === i ? ' selected' : ''}>${esc(o.label)}</option>`))
        .join('');
      return `<div class="wi${changed ? ' changed' : ''}"><label><span>${esc(f.label)}</span>${f.controllable ? '<span class="tag">you control</span>' : ''}</label><select data-id="${esc(f.id)}" aria-label="${esc(f.question)}">${opts}</select></div>`;
    })
    .join('');
}

function renderMethod(r) {
  const m = S.model;
  const rows = m.factors
    .filter((f) => f.kind === 'evidence' && S.whatIf[f.id] !== undefined && S.whatIf[f.id] !== SKIP && isActive(f, S.whatIf, m))
    .map((f) => {
      const o = f.options[S.whatIf[f.id]];
      const raw = o.rawLogLR ?? o.logLR;
      const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
      return `<tr><td>${esc(f.label)}</td><td>${esc(o.label)}</td><td class="num-col">${fmt(raw)}</td><td class="num-col">${fmt(o.logLR)}</td><td class="num-col">×${Math.exp(o.logLR).toFixed(2)}</td></tr>`;
    })
    .join('');
  const post = posterior(m, S.whatIf);
  $('r-method').innerHTML = `
    <p><strong>1. Outside view.</strong> ${esc(m.baseRateNote)} Base rate used: <code>${pct(post.baseRate)}</code>.</p>
    <p><strong>2. Evidence.</strong> Each answer has a likelihood ratio (LR): how much more common that answer is among people for whom the outcome happens than among people for whom it doesn't. The evidence is combined in log-odds space:</p>
    <span class="formula">logit(p) = logit(${post.baseRate.toFixed(3)}) + ${post.shrink.toFixed(2)} × Σ log LR = ${post.logOdds.toFixed(2)}  →  p = ${pct(post.p)}</span>
    <p><strong>3. Coherence.</strong> Weights are rescaled so that averaging the forecast over everyone in the reference class gives back exactly the base rate (law of total probability). Without this, sloppy weights quietly push every forecast up or down. The table shows each weight before and after.</p>
    <p><strong>4. Correlation correction, tuned by simulation.</strong> Questions overlap (income and savings rate both reflect earning power), so naive Bayes would double-count. The model estimates that ${pct(m.overlap)} of the signal is shared. Oracle simulated a population with that overlap and picked the correction that forecast it best: ρ = <code>${m.dependence.toFixed(2)}</code>, shrinking the evidence by <code>1/√(1+ρ(n−1)) = ${post.shrink.toFixed(2)}</code>.</p>
    <p><strong>5. Uncertainty.</strong> ${r.simulation.n.toLocaleString()} Monte Carlo runs vary the base rate (σ = ${m.baseRateUncertainty} log-odds) and each weight, and fill unanswered questions with plausible answers. The 80% range is the 10th–90th percentile.</p>
    <p><strong>6. Adaptive questioning.</strong> At each step Oracle asked the open question with the largest expected effect on your forecast.</p>
    ${rows ? `<table><thead><tr><th>Factor</th><th>Your answer</th><th>raw log LR</th><th>coherent</th><th>LR</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <div class="calib-check" id="calib-check">
      <h4>Calibration check</h4>
      <p class="muted small">Does “30%” really mean 30%? Oracle can simulate 4,000 people from this model, forecast each one, and compare against what happened to them.</p>
      <button class="btn ghost small" id="run-calib">Run calibration check</button>
    </div>
    ${m.caveat ? `<p class="muted small" style="margin-top:12px">⚠ ${esc(m.caveat)}</p>` : ''}`;
  $('run-calib').onclick = runCalibration;
}

function runCalibration() {
  const box = $('calib-check');
  const s = calibrationStudy(S.model, { n: 4000, overlap: S.model.overlap, seed: 2024 });
  const w = 260;
  const h = 200;
  const x = (v) => 34 + v * (w - 44);
  const y = (v) => h - 26 - v * (h - 40);
  // Hide sparse buckets: a handful of people makes the curve wobble meaninglessly.
  for (const k of ['oracle', 'naive']) s[k].reliability = s[k].reliability.filter((b) => b.n >= 30);
  const dots = (rel, cls) => rel.map((b) => `<circle cx="${x(b.predicted)}" cy="${y(b.actual)}" r="${2.5 + Math.min(5, Math.sqrt(b.n) / 6)}" class="${cls}"><title>Forecast ≈${pct(b.predicted)} → happened ${pct(b.actual)} (${b.n} people)</title></circle>`).join('');
  const line = (rel) => rel.map((b, i) => `${i ? 'L' : 'M'}${x(b.predicted).toFixed(1)},${y(b.actual).toFixed(1)}`).join(' ');
  box.innerHTML = `
    <h4>Calibration check <span class="muted small">· ${s.n.toLocaleString()} simulated people, ${pct(S.model.overlap)} shared signal</span></h4>
    <div class="calib-grid">
      <svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Reliability diagram">
        <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="connector"/>
        <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(0)}" class="axis"/>
        <line x1="${x(0)}" y1="${y(0)}" x2="${x(0)}" y2="${y(1)}" class="axis"/>
        <path d="${line(s.naive.reliability)}" fill="none" stroke="var(--neg)" stroke-opacity=".6" stroke-width="1.5"/>
        ${dots(s.naive.reliability, 'cal-naive')}
        <path d="${line(s.oracle.reliability)}" fill="none" stroke="var(--accent-2)" stroke-width="2"/>
        ${dots(s.oracle.reliability, 'cal-oracle')}
        <text x="${x(0.5)}" y="${h - 6}" text-anchor="middle">forecast</text>
        <text x="10" y="${y(0.5)}" text-anchor="middle" transform="rotate(-90 10 ${y(0.5)})">actually happened</text>
        <text x="${x(0)}" y="${y(0) + 13}" text-anchor="middle">0</text><text x="${x(1)}" y="${y(0) + 13}" text-anchor="end">100%</text>
      </svg>
      <table>
        <thead><tr><th></th><th>Calibration error</th><th>Brier</th><th>Log loss</th></tr></thead>
        <tbody>
          <tr><td><span class="key-dot oracle"></span>Oracle</td><td class="num-col">${(s.oracle.ece * 100).toFixed(1)} pts</td><td class="num-col">${s.oracle.brier.toFixed(3)}</td><td class="num-col">${s.oracle.logLoss.toFixed(3)}</td></tr>
          <tr><td><span class="key-dot naive"></span>Naive Bayes</td><td class="num-col">${(s.naive.ece * 100).toFixed(1)} pts</td><td class="num-col">${s.naive.brier.toFixed(3)}</td><td class="num-col">${s.naive.logLoss.toFixed(3)}</td></tr>
          <tr><td>Base rate only</td><td class="num-col">—</td><td class="num-col">${s.baseRate.brier.toFixed(3)}</td><td class="num-col">${s.baseRate.logLoss.toFixed(3)}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted small">Points on the dashed diagonal are perfectly calibrated. Lower Brier and log loss are better. This checks the engine's internal consistency under the model's own assumptions. Only real outcomes, which the journal records, can show whether the weights match the world.</p>`;
}

async function loadNarrative() {
  const body = $('r-reading-body');
  const src = $('r-reading-source');
  const local = () => {
    S.narrative = { ...offlineNarrative(S.model, analyze(S.model, S.baseline)), source: 'offline' };
    renderNarrative();
  };
  if (!S.status.ai || S.staticMode) return local();
  body.innerHTML = '<div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton short"></div>';
  src.textContent = '✦ Claude is writing…';
  try {
    const n = await api('/api/narrative', { model: S.model, answers: S.baseline });
    S.narrative = n;
    renderNarrative();
  } catch {
    local();
  }
}

function renderNarrative() {
  const n = S.narrative;
  if (!n) return;
  $('r-headline').textContent = n.headline;
  $('r-reading-source').textContent = n.source === 'claude' ? '✦ Written by Claude' : 'Built-in analysis';
  $('r-reading-body').innerHTML = `
    <p>${esc(n.summary)}</p>
    <p class="insight">💡 ${esc(n.insight)}</p>
    ${n.plan?.length ? `<h4>Action plan</h4><ol class="plan">${n.plan.map((p) => `<li>${esc(p.action)}${p.impact ? `<span class="impact">${esc(p.impact)}</span>` : ''}</li>`).join('')}</ol>` : ''}
    ${n.signposts?.length ? `<h4>Watch for</h4><ul class="signposts">${n.signposts.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${n.caveat ? `<p class="muted small">⚠ ${esc(n.caveat)}</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// Sharing & export
// ---------------------------------------------------------------------------

async function encodeShare(obj) {
  const json = JSON.stringify(obj);
  if (!('CompressionStream' in window)) return `j${btoa(unescape(encodeURIComponent(json)))}`;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return `z${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

async function decodeShare(code) {
  const kind = code[0];
  const data = code.slice(1);
  if (kind === 'j') return JSON.parse(decodeURIComponent(escape(atob(data))));
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function copyShareLink() {
  const code = await encodeShare({ v: 1, m: S.model, a: S.whatIf, n: S.narrative });
  const url = `${location.origin}${location.pathname}#r=${code}`;
  // The address bar always holds the link too, so it can be copied by hand.
  history.replaceState(null, '', `#r=${code}`);
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied. It opens this exact forecast.');
  } catch {
    prompt('Copy this link:', url);
  }
}

async function openShared(code) {
  const data = await decodeShare(code);
  S.model = validateModel(data.m);
  S.answers = cleanAnswers(S.model, data.a);
  S.baseline = { ...S.answers };
  S.whatIf = { ...S.answers };
  S.narrative = data.n && typeof data.n === 'object' ? data.n : null;
  show('result');
  renderResult();
  if (S.narrative) renderNarrative();
  else loadNarrative();
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function downloadCard() {
  const r = analyze(S.model, S.whatIf);
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0820');
  bg.addColorStop(1, '#12204a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(300, 315, 10, 300, 315, 320);
  glow.addColorStop(0, 'rgba(124,92,255,0.45)');
  glow.addColorStop(1, 'rgba(124,92,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Ring
  g.lineCap = 'round';
  g.lineWidth = 22;
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.beginPath();
  g.arc(300, 315, 190, 0, Math.PI * 2);
  g.stroke();
  const ring = g.createLinearGradient(110, 125, 490, 505);
  ring.addColorStop(0, '#7c5cff');
  ring.addColorStop(1, '#3ee6ff');
  g.strokeStyle = ring;
  g.beginPath();
  g.arc(300, 315, 190, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, r.p));
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '400 132px "Instrument Serif", Georgia, serif';
  g.fillText(`${Math.round(r.p * 100)}%`, 300, 345);
  g.font = '600 22px Inter, sans-serif';
  g.fillStyle = '#a9a7c9';
  g.fillText(r.verdict.label.toUpperCase(), 300, 395);

  g.textAlign = 'left';
  g.fillStyle = '#3ee6ff';
  g.font = '600 20px Inter, sans-serif';
  g.fillText('ORACLE FORECAST', 560, 140);
  g.fillStyle = '#fff';
  g.font = '400 52px "Instrument Serif", Georgia, serif';
  const lines = wrap(g, S.model.title, 580).slice(0, 3);
  lines.forEach((l, i) => g.fillText(l, 560, 205 + i * 58));
  let y = 205 + lines.length * 58 + 20;
  g.font = '500 22px Inter, sans-serif';
  g.fillStyle = '#a9a7c9';
  g.fillText(`80% range ${pct(r.interval.low)}–${pct(r.interval.high)} · base rate ${pct(r.baseRate)}`, 560, y);
  y += 50;
  for (const ctr of r.contributions.slice(0, 3)) {
    g.fillStyle = ctr.delta >= 0 ? '#3fe0a0' : '#ff6b8b';
    g.fillText(`${signedPts(ctr.delta)}`, 560, y);
    g.fillStyle = '#ecebff';
    g.fillText(ctr.label, 630, y);
    y += 36;
  }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.font = '500 18px Inter, sans-serif';
  g.fillText('Bayesian forecast · 4,000 simulations', 560, H - 50);
  c.toBlob((b) => downloadBlob(b, `oracle-${S.model.id}.png`), 'image/png');
}

function wrap(g, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

function openSaveDialog() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  $('save-date').value = d.toISOString().slice(0, 10);
  $('save-note').value = '';
  $('save-dialog').showModal();
}

function bindJournal() {
  $('save-dialog').addEventListener('close', () => {
    if ($('save-dialog').returnValue !== 'save') return;
    const r = analyze(S.model, S.whatIf);
    const item = journal.add({
      question: S.model.question || S.model.title,
      title: S.model.title,
      outcome: S.model.outcome,
      p: r.p,
      interval: r.interval,
      resolveBy: $('save-date').value,
      note: $('save-note').value.trim(),
      model: S.model,
      answers: S.whatIf,
      narrative: S.narrative,
    });
    if (item) {
      S.journalId = item.id;
      updateJournalCount();
      toast('Saved. Come back when it resolves and record what happened.');
    } else toast('Could not save. Browser storage is unavailable.');
  });

  $('journal-list').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    const act = b.dataset.act;
    if (act === 'yes' || act === 'no') journal.update(id, { resolution: act === 'yes', resolvedAt: new Date().toISOString() });
    if (act === 'undo') journal.update(id, { resolution: null, resolvedAt: null });
    if (act === 'delete' && confirm('Delete this prediction?')) journal.remove(id);
    if (act === 'open') {
      const entry = journal.list().find((x) => x.id === id);
      if (entry?.model) {
        S.model = validateModel(entry.model);
        S.answers = cleanAnswers(S.model, entry.answers);
        S.baseline = { ...S.answers };
        S.whatIf = { ...S.answers };
        S.narrative = entry.narrative || null;
        show('result');
        renderResult();
        if (S.narrative) renderNarrative();
        else loadNarrative();
        return;
      }
    }
    renderJournal();
    updateJournalCount();
  };

  $('journal-export').onclick = () => downloadBlob(new Blob([JSON.stringify(journal.list(), null, 2)], { type: 'application/json' }), 'oracle-journal.json');
  $('journal-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const list = JSON.parse(await file.text());
      if (!Array.isArray(list)) throw new Error();
      const kept = journal.importMany(list);
      renderJournal();
      updateJournalCount();
      toast(kept === list.length ? `Imported ${kept} predictions` : `Imported ${kept} of ${list.length} entries (skipped malformed ones)`);
    } catch {
      toast('That file is not an Oracle journal export.');
    }
    e.target.value = '';
  };
}

function updateJournalCount() {
  const s = journal.stats();
  $('journal-count').textContent = s.due ? `${s.due} due` : s.total || '';
}

function renderJournal() {
  const s = journal.stats();
  const list = journal.list();
  const today = new Date().toISOString().slice(0, 10);
  const brierLabel = s.brier === null ? '—' : s.brier.toFixed(3);
  const brierHint = s.brier === null ? 'Resolve predictions to score yourself' : s.brier < 0.1 ? 'Superforecaster territory' : s.brier < 0.2 ? 'Better than chance' : 'Room to improve';
  $('calibration').innerHTML = `
    <div class="stat"><span class="stat-label">Predictions</span><span class="stat-value">${s.total}</span></div>
    <div class="stat"><span class="stat-label">Resolved</span><span class="stat-value">${s.resolved}</span></div>
    <div class="stat"><span class="stat-label">Brier score</span><span class="stat-value">${brierLabel}</span><span class="muted small">${brierHint}</span></div>
    <div class="stat"><span class="stat-label">Called right</span><span class="stat-value">${s.accuracy === null ? '—' : pct(s.accuracy)}</span></div>
    <div>${calibrationChart(s.buckets)}</div>`;

  $('journal-list').innerHTML = list.length
    ? list
        .map((e) => {
          const due = e.resolution === null && e.resolveBy && e.resolveBy <= today;
          const status = e.resolution === true ? '<span class="status yes">Happened</span>' : e.resolution === false ? '<span class="status no">Didn’t happen</span>' : due ? '<span class="status due">Ready to resolve</span>' : `<span class="status">Check on ${esc(e.resolveBy || '—')}</span>`;
          const btns =
            e.resolution === null
              ? `<button class="btn ghost small" data-act="yes">✓ Happened</button><button class="btn ghost small" data-act="no">✗ Didn’t</button>`
              : `<button class="btn ghost small" data-act="undo">Undo</button>`;
          return `<li class="card jitem${due ? ' due' : ''}" data-id="${esc(e.id)}">
            <div class="jp">${pct(e.p)}</div>
            <div><h3>${esc(e.title)}</h3><div class="jmeta">${status} · saved ${esc(e.createdAt.slice(0, 10))}${e.note ? ` · “${esc(e.note)}”` : ''}</div></div>
            <div class="jbtns">${btns}<button class="btn ghost small" data-act="open">Open</button><button class="btn ghost small" data-act="delete" aria-label="Delete">🗑</button></div>
          </li>`;
        })
        .join('')
    : '<li class="card empty-state">No predictions yet. Make one and save it to start tracking how well-calibrated you are.</li>';
  show('journal');
}

function calibrationChart(buckets) {
  const w = 220;
  const h = 110;
  const x = (v) => 20 + v * (w - 30);
  const y = (v) => h - 18 - v * (h - 28);
  const pts = buckets.filter((b) => b.n);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Calibration chart">
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="connector"/>
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(0)}" class="axis"/>
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(0)}" y2="${y(1)}" class="axis"/>
    ${pts.map((b) => `<circle cx="${x(b.predicted)}" cy="${y(b.actual)}" r="${3 + Math.min(6, b.n)}" fill="var(--accent-2)" fill-opacity=".8"><title>${b.n} predictions around ${pct(b.predicted)}: ${pct(b.actual)} happened</title></circle>`).join('')}
    <text x="${x(0.5)}" y="${h - 3}" text-anchor="middle">predicted</text>
    <text x="8" y="${y(0.5)}" text-anchor="middle" transform="rotate(-90 8 ${y(0.5)})">actual</text>
    ${pts.length ? '' : `<text x="${x(0.5)}" y="${y(0.55)}" text-anchor="middle">calibration plot</text>`}
  </svg>`;
}

boot();
