# 🔮 Oracle: predict anything

Ask Oracle a question about your future, like *"Will I be rich?"*, *"Will my startup succeed?"*, *"Will I crack JEE?"* or *"Will I move abroad in 5 years?"*

Oracle doesn't guess. It **builds a forecasting model for your question**, **interviews you adaptively** (each next question is the one most likely to change the answer), and returns a **calibrated probability** along with everything behind it: what pushed the number up or down, how uncertain it is, and which changes on your side would move it most.

```
You: "Will I be rich in the future?"

Oracle: Resolves YES if your net worth reaches the top ~5% (≈US$1M+) by age ~60.
        Base rate for people in general: 7%.
        Q1 Where does your income sit vs. your age group?   → live forecast 9%
        Q2 What share of take-home pay do you save?         → live forecast 17%
        ...
        FORECAST 37%  (80% range 12–47%) · Leaning no
        Biggest lever: Income level → Top 5%   (+23 pts)
```

## What makes it different

| | |
|---|---|
| **Starts from the base rate** | Every forecast begins with the real base rate for a reference class ("how often does this happen to people in general?"), the way professional forecasters work. |
| **Any question** | With a Claude API key, Claude designs a model for *your exact question*: it defines a resolvable outcome, picks the reference class and base rate, chooses 7–12 predictive factors, and calibrates how much each answer should count. |
| **Adaptive interview** | Questions are ordered by expected impact on your forecast. Follow-up questions branch off your earlier answers, and Claude adds personalised follow-ups once it has seen your answers. |
| **Transparent math** | Bayesian updating in log-odds space. Every number can be traced in the "How this was calculated" panel. |
| **Coherent by construction** | Weights are rescaled so the forecast averaged over the reference class equals the base rate (the law of total probability). Without this, hand-set or LLM-set weights quietly bias every forecast. |
| **Calibration you can check** | The correlation correction is tuned by simulation, and any forecast's model can be stress-tested in the browser ("Run calibration check"): Oracle simulates 4,000 people and draws the reliability diagram against naive Bayes. |
| **Honest uncertainty** | 4,000 Monte Carlo simulations produce an 80% range. Answering more questions narrows it. |
| **Levers & path to yes** | Ranks the changes you control by impact, and finds the fewest changes that would get you past 50%. |
| **What-if lab** | Change any answer and watch the forecast, the waterfall and the levers update instantly. |
| **Prediction journal** | Save forecasts, record what actually happened, and track your calibration with the **Brier score**. |
| **Share** | Share links reproduce the exact forecast, compressed into the URL with no server storage. There's also a downloadable image card and JSON export. |
| **Works offline** | No API key? Eight built-in models (wealth, startup, relationships, longevity, job, exams, fitness, habits) plus a universal model for anything else. |
| **Terminal mode** | `npm run cli` runs the full interview in your terminal. |

## Quick start

```bash
git clone https://github.com/aman-kejriwal/Predict.git
cd Predict
npm install
npm start                 # → http://localhost:3000
```

To let Claude build a model for **any** question:

```bash
cp .env.example .env      # then put your key in ANTHROPIC_API_KEY
npm start
```

Terminal version:

```bash
npm run cli -- "Will I be rich in the future?"
npm run cli -- --offline "Will my startup succeed?"
```

Requires Node.js 18.17+ (20.12+ to auto-load `.env`).

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | Enables Claude mode. Without it, Oracle runs on built-in models. |
| `ORACLE_MODEL` | `claude-opus-5-5` | Claude model used to build models and write readings. |
| `ORACLE_EFFORT` | `medium` | Effort for model building (`low` … `max`). |
| `PORT` | `3000` | Web server port. |

## How it works

```
   your question
        │
        ▼
┌──────────────────┐   Claude (or a built-in model) designs:
│  Model builder   │   • a precise, checkable YES definition + time horizon
│                  │   • reference class + base rate
└────────┬─────────┘   • 7–12 factors, each answer weighted by a likelihood ratio
         ▼
┌──────────────────┐   Picks the open question with the largest
│ Adaptive         │   expected shift in your forecast. Conditional
│ interviewer      │   follow-ups unlock based on your answers.
└────────┬─────────┘
         ▼
┌──────────────────┐   logit(p) = logit(base rate) + shrink(n) · Σ log LR
│ Bayesian engine  │   shrink(n) = 1/√(1 + ρ(n−1)) corrects for correlated factors
└────────┬─────────┘   + 4,000 Monte Carlo runs for the uncertainty range
         ▼
   probability · 80% range · drivers · levers · path to yes · scenarios · reading
```

**Why Claude builds the model but doesn't compute the answer.** Language models aren't calibrated calculators. Oracle uses Claude for what it's good at: framing the question, knowing the research on base rates and predictors, and asking good questions. The arithmetic runs in a small deterministic engine (`src/engine/core.js`), so the probability is reproducible, explainable and easy to inspect.

### Is it calibrated?

`npm run calibrate` simulates 20,000 people per built-in model, forecasts each one, and scores the forecasts against what happened to them. The seed is different from the one used for tuning:

| model | calibration error: Oracle | naive Bayes | log loss: Oracle | naive | base rate only |
|---|---|---|---|---|---|
| wealth | **0.4%** | 1.7% | **0.201** | 0.205 | 0.265 |
| startup | **0.4%** | 1.9% | **0.283** | 0.285 | 0.333 |
| marriage | **0.6%** | 3.3% | **0.579** | 0.585 | 0.689 |
| longevity | **0.6%** | 2.3% | **0.498** | 0.500 | 0.560 |
| job | **1.3%** | 3.0% | **0.527** | 0.531 | 0.608 |
| exam | **0.9%** | 3.4% | **0.602** | 0.607 | 0.693 |
| fitness | **0.7%** | 2.0% | **0.446** | 0.448 | 0.497 |
| habit | **0.8%** | 1.6% | **0.458** | 0.460 | 0.506 |

Calibration error is the average gap between the forecast and how often it came true. Oracle is 2–5× better calibrated than naive Bayes and has lower log loss and Brier score on every model.

**What this does and doesn't show.** The simulation draws people from each model's own assumptions, including a hidden trait shared across questions, so the questions overlap the way they do in real life. It shows that the engine's math is internally consistent: coherence, the correlation correction, and the combination of evidence. It can't show that the *weights themselves* match the real world. Only real outcomes can, which is what the prediction journal's Brier score is for.

### Calibration details

- **Evidence weights** are natural-log likelihood ratios: `log(P(answer | yes) / P(answer | no))`. ±0.2 is weak, ±0.5 moderate, ±1 strong, ±2 near-decisive. All weights are clamped to ±3.
- **Coherence.** For each question with answer frequencies m and likelihood ratios L, Oracle solves for the scale λ that makes `Σ m·P(yes | answer) = base rate`, then uses λL. Relative evidence between answers is preserved, the solve is capped at ±3 in log space, and re-validating a model never changes it.
- **Correlation correction, tuned by simulation.** Naive Bayes assumes questions are independent, so it double-counts overlapping ones like income and savings rate. The model's author (Claude or the built-in library) estimates *how much* signal the questions share. Oracle simulates a population with that much overlap and picks the shrink factor ρ in `1/√(1+ρ(n−1))` that forecasts it best. Every answered question counts toward n, which keeps the forecast monotone: a stronger answer never lowers it.
- **Uncertainty.** The simulation varies the base rate (logit-normal), each evidence weight (sd grows with its magnitude), and fills unanswered questions by sampling from how common each answer is. That's why the range narrows as you answer.
- **Question selection.** For each open question Oracle computes the expected absolute change in probability over its possible answers and asks the largest. Reference-class questions always go first, because they reset the starting point.

## Project layout

```
src/engine/core.js       Forecasting engine: validation, inference, Monte Carlo, levers (runs in Node and the browser)
src/engine/library.js    Built-in offline models + question matcher
src/engine/narrative.js  Offline written reading
src/engine/calibration.js Simulation-based calibration study + correlation tuning
scripts/calibration-report.js  `npm run calibrate`
src/server/oracle-ai.js  Claude integration (structured outputs, refusal fallbacks)
src/server/server.js     Zero-framework HTTP server + JSON API
src/cli.js               Terminal interface
public/                  Web app (vanilla JS, SVG charts, no build step)
test/                    unit, fuzz, API-abuse and browser (Playwright) suites
```

### API

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/status` | | `{ ai, model, library }` |
| `POST /api/model` | `{ question, context? }` | `{ model, presets, interpretation, source }` |
| `POST /api/followups` | `{ model, answers }` | `{ factors, note }` |
| `POST /api/narrative` | `{ model, answers }` | `{ headline, summary, insight, plan, signposts, caveat }` |

The server re-validates every model and answer set it receives, so clients can't inject out-of-range weights.

## Tests

```bash
npm test
```

The suite has four layers:

- **Unit tests:** the math, every built-in model, and the Claude integration. The Claude tests run against a local fake Messages API, so no key is needed.
- **Property-based fuzzing:** random and often hostile models, including `NaN`, `Infinity`, junk types, duplicate ids, broken conditional links and prototype-pollution keys. Each run checks these properties:
  - validation never crashes and is idempotent
  - coherence holds for every question
  - probabilities stay finite and in range
  - the waterfall chart sums to the forecast
  - levers report exactly the probability they produce
  - the "path to yes" only goes up
  - a stronger answer never lowers the forecast
  - interviews always end
  - the tuned correction beats naive Bayes

  Run harder with `FUZZ_ROUNDS=5000 npm test`.
- **API abuse tests:** malformed or non-object JSON, wrong field types, oversized bodies, path-traversal variants, prototype-pollution payloads, injected out-of-range weights, and 100 concurrent requests.
- **Browser tests** (Playwright, skipped if it isn't installed): the full flow, script injection in questions and imported journals, keyboard-only use, skip-everything, back navigation, share-link round trips and tampered links, malformed journal imports, conditional questions in the what-if lab, downloads, and no sideways scrolling on mobile. Any console error fails the test.

## A note on honesty

Oracle estimates odds from patterns in reference classes. It isn't fate, and it isn't financial, medical or legal advice. A 30% forecast means that out of 100 people with your exact answers, about 30 would see it happen. The useful part is learning which of your answers move those odds, so you know what to change.

## License

MIT
