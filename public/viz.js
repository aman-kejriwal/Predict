// Small dependency-free SVG visualisations.

const NS = 'http://www.w3.org/2000/svg';
const pct = (p) => Math.round(p * 100);

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

let gradientId = 0;

/** Ring gauge with the point estimate and an optional uncertainty band. */
export function gauge(container, p, { size = 220, label = '', band = null, big = false } = {}) {
  let root = container.querySelector('.gauge');
  if (!root) {
    container.innerHTML = '';
    root = document.createElement('div');
    root.className = `gauge${big ? ' big' : ''}`;
    const id = `g${++gradientId}`;
    const r = size / 2 - 14;
    const c = 2 * Math.PI * r;
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img' });
    const defs = el('defs', {}, svg);
    const lg = el('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': 'var(--accent)' }, lg);
    el('stop', { offset: '1', 'stop-color': 'var(--accent-2)' }, lg);
    const glow = el('filter', { id: `${id}f`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '6' }, glow);
    const g = el('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` }, svg);
    el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--border)', 'stroke-width': 10 }, g);
    el('circle', {
      class: 'band', cx: size / 2, cy: size / 2, r: r + 11, fill: 'none', stroke: 'var(--accent-2)', 'stroke-opacity': 0.35,
      'stroke-width': 3, 'stroke-dasharray': `0 ${2 * Math.PI * (r + 11)}`, 'stroke-linecap': 'round',
    }, g);
    el('circle', {
      class: 'arc glow', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: `url(#${id})`, 'stroke-width': 10,
      'stroke-dasharray': c, 'stroke-dashoffset': c, 'stroke-linecap': 'round', filter: `url(#${id}f)`, opacity: 0.55,
    }, g);
    el('circle', {
      class: 'arc main', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: `url(#${id})`, 'stroke-width': 10,
      'stroke-dasharray': c, 'stroke-dashoffset': c, 'stroke-linecap': 'round',
    }, g);
    root.appendChild(svg);
    const center = document.createElement('div');
    center.className = 'g-center';
    center.innerHTML = '<div class="g-value"></div><div class="g-label"></div>';
    root.appendChild(center);
    root.dataset.size = size;
    root.dataset.value = '0';
    container.appendChild(root);
  }

  const s = Number(root.dataset.size);
  const r = s / 2 - 14;
  const c = 2 * Math.PI * r;
  const p01 = Math.max(0.004, Math.min(1, p));
  root.querySelectorAll('.arc').forEach((a) => a.setAttribute('stroke-dashoffset', String(c * (1 - p01))));
  root.querySelector('svg').setAttribute('aria-label', `${pct(p)} percent`);

  const bandEl = root.querySelector('.band');
  if (band) {
    const rb = r + 11;
    const cb = 2 * Math.PI * rb;
    const len = Math.max(0.004, band[1] - band[0]) * cb;
    bandEl.setAttribute('stroke-dasharray', `${len} ${cb}`);
    bandEl.setAttribute('stroke-dashoffset', String(-band[0] * cb));
  } else {
    bandEl.setAttribute('stroke-dasharray', `0 ${c}`);
  }

  root.querySelector('.g-label').textContent = label;
  countUp(root.querySelector('.g-value'), Number(root.dataset.value), pct(p));
  root.dataset.value = String(pct(p));
}

function countUp(node, from, to) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const dur = reduce ? 0 : 700;
  cancelAnimationFrame(node._raf);
  const tick = (t) => {
    const k = dur ? Math.min(1, (t - start) / dur) : 1;
    const e = 1 - Math.pow(1 - k, 3);
    node.innerHTML = `${Math.round(from + (to - from) * e)}<small>%</small>`;
    if (k < 1) node._raf = requestAnimationFrame(tick);
  };
  node._raf = requestAnimationFrame(tick);
}

/** Probability trajectory over the interview. */
export function sparkline(container, values) {
  container.innerHTML = '';
  if (values.length < 2) return;
  const w = container.clientWidth || 280;
  const h = 46;
  const svg = el('svg', { width: '100%', height: h, viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', class: 'chart' }, container);
  const x = (i) => 4 + (i / (values.length - 1)) * (w - 8);
  const y = (v) => h - 4 - v * (h - 8);
  el('line', { x1: 0, x2: w, y1: y(0.5), y2: y(0.5), class: 'axis', 'stroke-dasharray': '2 4' }, svg);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  el('path', { d: `${d} L${x(values.length - 1)},${h} L${x(0)},${h} Z`, fill: 'var(--accent-soft)' }, svg);
  el('path', { d, fill: 'none', stroke: 'var(--accent-2)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  el('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3.5, fill: 'var(--accent-2)' }, svg);
}

/** 10×10 grid of people, `p` share highlighted. */
export function iconArray(container, p) {
  const n = Math.round(p * 100);
  if (container.children.length !== 100) {
    container.innerHTML = '';
    for (let i = 0; i < 100; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      container.appendChild(d);
    }
  }
  [...container.children].forEach((d, i) => d.classList.toggle('on', i < n));
}

/** Monte Carlo histogram with the 80% interval highlighted. */
export function histogram(container, sim) {
  container.innerHTML = '';
  const w = 520;
  const h = 170;
  const pad = { l: 8, r: 8, t: 12, b: 26 };
  const svg = el('svg', { width: '100%', viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': 'Distribution of simulated probabilities' }, container);
  const max = Math.max(...sim.histogram, 0.001);
  const bw = (w - pad.l - pad.r) / sim.histogram.length;
  sim.histogram.forEach((v, i) => {
    const bh = (v / max) * (h - pad.t - pad.b);
    const mid = (i + 0.5) / sim.histogram.length;
    el('rect', {
      x: pad.l + i * bw + 1.5, y: h - pad.b - bh, width: bw - 3, height: Math.max(bh, v > 0 ? 1.5 : 0), rx: 3,
      class: `hist${mid >= sim.p10 && mid <= sim.p90 ? ' in' : ''}`,
    }, svg);
  });
  el('line', { x1: pad.l, x2: w - pad.r, y1: h - pad.b, y2: h - pad.b, class: 'axis' }, svg);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const tx = pad.l + t * (w - pad.l - pad.r);
    const text = el('text', { x: tx, y: h - 8, 'text-anchor': t === 0 ? 'start' : t === 1 ? 'end' : 'middle' }, svg);
    text.textContent = `${t * 100}%`;
  }
  for (const [q, name] of [[sim.p10, 'P10'], [sim.p90, 'P90']]) {
    const mx = pad.l + q * (w - pad.l - pad.r);
    el('line', { x1: mx, x2: mx, y1: pad.t - 4, y2: h - pad.b, class: 'marker' }, svg);
    const t = el('text', { x: mx + 4, y: pad.t + 4 }, svg);
    t.textContent = `${name} ${pct(q)}%`;
  }
}

/** Waterfall from base rate through each factor to the final estimate. */
export function waterfallChart(container, steps, finalP) {
  container.innerHTML = '';
  const rows = [...steps.slice(0, 11)];
  const hidden = steps.length - rows.length;
  const rowH = 30;
  const labelW = 210;
  const w = 720;
  const h = (rows.length + 1) * rowH + 30;
  const svg = el('svg', { width: '100%', viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': 'Waterfall of factor contributions' }, container);
  const x0 = labelW + 10;
  const x = (p) => x0 + p * (w - x0 - 60);

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    el('line', { x1: x(t), x2: x(t), y1: 6, y2: h - 22, class: 'axis', 'stroke-opacity': 0.4 }, svg);
    const tx = el('text', { x: x(t), y: h - 6, 'text-anchor': 'middle' }, svg);
    tx.textContent = `${t * 100}%`;
  }

  let prev = null;
  rows.forEach((s, i) => {
    const y = 10 + i * rowH;
    const label = el('text', { x: labelW, y: y + 15, 'text-anchor': 'end' }, svg);
    label.textContent = truncate(i === 0 ? 'Base rate' : `${s.label}`, 30);
    if (i === 0) {
      el('rect', { x: x(0), y: y + 4, width: Math.max(2, x(s.p) - x(0)), height: rowH - 12, rx: 4, class: 'bar-base' }, svg);
    } else {
      const from = prev;
      const lo = Math.min(from, s.p);
      const hi = Math.max(from, s.p);
      el('rect', { x: x(lo), y: y + 4, width: Math.max(2, x(hi) - x(lo)), height: rowH - 12, rx: 4, class: s.delta >= 0 ? 'bar-pos' : 'bar-neg' }, svg);
      const d = el('text', { x: x(hi) + 6, y: y + 15 }, svg);
      d.textContent = `${s.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(s.delta * 100))}`;
      el('line', { x1: x(from), x2: x(from), y1: y - rowH + 18, y2: y + 4, class: 'connector' }, svg);
    }
    prev = s.p;
  });

  const y = 10 + rows.length * rowH;
  const label = el('text', { x: labelW, y: y + 15, 'text-anchor': 'end', 'font-weight': 600 }, svg);
  label.textContent = hidden > 0 ? `Your forecast (+${hidden} smaller)` : 'Your forecast';
  el('rect', { x: x(0), y: y + 4, width: Math.max(2, x(finalP) - x(0)), height: rowH - 12, rx: 4, class: 'bar-final' }, svg);
  const v = el('text', { x: x(finalP) + 6, y: y + 15, 'font-weight': 600 }, svg);
  v.textContent = `${pct(finalP)}%`;
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
