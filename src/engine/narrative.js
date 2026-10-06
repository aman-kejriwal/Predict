// Offline "reading": turns an analysis into plain-language insight. When Claude
// is connected the server replaces this with a richer, personalised narrative,
// but the structure (headline, summary, drivers, plan, signposts) is the same.

const pct = (p) => `${Math.round(p * 100)}%`;
const pts = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))} pts`;

function oneIn(p) {
  if (p >= 0.5) return `${Math.round(p * 10)} in 10`;
  const n = Math.round(1 / Math.max(p, 0.001));
  return `1 in ${n}`;
}

export function offlineNarrative(model, result) {
  const { p, baseRate, contributions, levers, path, interval } = result;
  const helping = contributions.filter((c) => c.delta > 0.005).slice(0, 3);
  const hurting = contributions.filter((c) => c.delta < -0.005).slice(0, 3);
  const shift = p - baseRate;

  const headline =
    Math.abs(shift) < 0.03
      ? `About ${oneIn(p)} — right in line with people like you.`
      : shift > 0
        ? `About ${oneIn(p)} — your answers put you ahead of the crowd.`
        : `About ${oneIn(p)} — your current path is behind the base rate.`;

  const summary = [
    `Starting from a base rate of ${pct(baseRate)} for this outcome, your answers move the estimate to ${pct(p)} (80% interval ${pct(interval.low)}–${pct(interval.high)}).`,
    helping.length ? `Working for you: ${helping.map((c) => c.label.toLowerCase()).join(', ')}.` : '',
    hurting.length ? `Working against you: ${hurting.map((c) => c.label.toLowerCase()).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const plan = levers.slice(0, 4).map((l) => ({
    action: `${l.label}: move from “${l.from}” to “${l.to}”.`,
    impact: `${pts(l.delta)} → ${pct(l.p)}`,
  }));

  let insight;
  if (path.steps.length && path.reached) {
    insight = `The shortest path to ${pct(path.p)} takes ${path.steps.length} change${path.steps.length > 1 ? 's' : ''}: ${path.steps.map((s) => s.label.toLowerCase()).join(', then ')}.`;
  } else if (levers.length) {
    insight = `Your biggest single lever is ${levers[0].label.toLowerCase()} (${pts(levers[0].delta)}). Focus there first.`;
  } else if (p >= 0.6) {
    insight = 'You are already doing most of what moves these odds. The main job now is to keep it up and avoid unforced errors.';
  } else {
    insight = 'Most of what drives this forecast is outside your direct control. Hedge: plan for both outcomes.';
  }

  const signposts = [
    ...contributions
      .filter((c) => c.controllable)
      .slice(0, 2)
      .map((c) => `Re-run this forecast if your answer on “${c.label}” changes.`),
    'Check back at your resolution date and record what happened. Calibration is how forecasters get better.',
  ];

  return { headline, summary, insight, plan, signposts, caveat: model.caveat || '' };
}
