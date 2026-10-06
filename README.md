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
| **Transparent math** | Bayesian updating in log-odds space with a correlation correction. Every number can be traced in the "How this was calculated" panel. |
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

### Calibration details

- **Evidence weights** are natural-log likelihood ratios: `log(P(answer | yes) / P(answer | no))`. ±0.2 is weak, ±0.5 moderate, ±1 strong, ±2 near-decisive. All weights are clamped to ±3.
- **Correlation correction.** Naive Bayes assumes factors are independent, which makes it overconfident: income and savings rate overlap, for example. Oracle scales the combined evidence by `1/√(1+ρ(n−1))`, where ρ is the model's estimated average factor correlation.
- **Uncertainty.** The simulation varies the base rate (logit-normal), each evidence weight (sd grows with its magnitude), and fills unanswered questions by sampling from how common each answer is. That's why the range narrows as you answer.
- **Question selection.** For each open question Oracle computes the expected absolute change in probability over its possible answers and asks the largest. Reference-class questions always go first, because they reset the starting point.

## Project layout

```
src/engine/core.js       Forecasting engine: validation, inference, Monte Carlo, levers (runs in Node and the browser)
src/engine/library.js    Built-in offline models + question matcher
src/engine/narrative.js  Offline written reading
src/server/oracle-ai.js  Claude integration (structured outputs, refusal fallbacks)
src/server/server.js     Zero-framework HTTP server + JSON API
src/cli.js               Terminal interface
public/                  Web app (vanilla JS, SVG charts, no build step)
test/                    node:test suites (engine, server, Claude integration via a fake API)
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

28 tests cover the math (Bayes updates, correlation shrink, conditional questions, deterministic simulation, levers, path-finding), every built-in model, sanitisation of hostile model input, the HTTP API (including path-traversal checks), and the Claude integration, which runs against a local fake Messages API, so no key is needed.

## A note on honesty

Oracle estimates odds from patterns in reference classes. It isn't fate, and it isn't financial, medical or legal advice. A 30% forecast means that out of 100 people with your exact answers, about 30 would see it happen. The useful part is learning which of your answers move those odds, so you know what to change.

## License

MIT
