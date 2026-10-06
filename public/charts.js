// Small dependency-free SVG charts. All text is inserted with textContent.

const NS = 'http://www.w3.org/2000/svg';
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
export const seriesColor = (i) => SERIES[i % SERIES.length];

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

const tooltip = () => document.getElementById('tooltip');

export function showTooltip(evt, title, rows) {
  const tt = tooltip();
  tt.replaceChildren();
  const t = document.createElement('div');
  t.className = 'tt-title';
  t.textContent = title;
  tt.append(t);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    if (r.color) {
      const k = document.createElement('i');
      k.className = 'key';
      k.style.background = r.color;
      row.append(k);
    }
    const b = document.createElement('b');
    b.textContent = r.value;
    const n = document.createElement('span');
    n.className = 'muted';
    n.textContent = r.label;
    row.append(b, n);
    tt.append(row);
  }
  tt.hidden = false;
  const { innerWidth: w } = window;
  const rect = tt.getBoundingClientRect();
  let x = evt.clientX + 14;
  if (x + rect.width > w - 8) x = evt.clientX - rect.width - 14;
  tt.style.left = `${Math.max(8, x)}px`;
  tt.style.top = `${Math.max(8, evt.clientY - rect.height - 12)}px`;
}
export const hideTooltip = () => { tooltip().hidden = true; };

export function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step0;
  const step = step0 * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * Line chart with a snapping crosshair and one tooltip listing every series.
 * series: [{ name, points: [{ x: 'YYYY-MM-DD', y }] }]
 */
export function lineChart({ series, invert = false, format = (v) => String(v), height = 240, label = 'Chart' }) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const W = 720;
  const H = height;
  const m = { t: 12, r: 16, b: 26, l: 56 };
  const all = series.flatMap((se) => se.points);
  if (!all.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No history available yet.';
    return e;
  }
  const dates = [...new Set(all.map((p) => p.x))].sort();
  const ys = all.map((p) => p.y);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.1 || Math.max(1, yMax * 0.05);
  yMin = Math.max(invert ? 1 : 0, yMin - pad);
  yMax += pad;
  const ticks = niceTicks(yMin, yMax).filter((t) => t >= (invert ? 1 : 0));
  const lo = Math.min(ticks[0], yMin);
  const hi = Math.max(ticks.at(-1), yMax);
  const x = (d) => m.l + (dates.length === 1 ? (W - m.l - m.r) / 2 : (dates.indexOf(d) / (dates.length - 1)) * (W - m.l - m.r));
  const y = (v) => {
    const f = (v - lo) / (hi - lo || 1);
    return invert ? m.t + f * (H - m.t - m.b) : H - m.b - f * (H - m.t - m.b);
  };

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  for (const t of ticks) {
    svg.append(s('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
    svg.append(s('text', { class: 'axis-label', x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, format(t)));
  }
  svg.append(s('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));
  dates.forEach((d, i) => {
    if (i % labelEvery && i !== dates.length - 1) return;
    if (i !== dates.length - 1 && dates.length - 1 - i < labelEvery / 2) return;
    svg.append(s('text', { class: 'axis-label', x: x(d), y: H - 8, 'text-anchor': 'middle' }, shortDate(d)));
  });

  series.forEach((se, i) => {
    const pts = se.points.slice().sort((a, b) => a.x.localeCompare(b.x));
    const dAttr = pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    if (series.length === 1 && pts.length > 1) {
      const area = `${dAttr}L${x(pts.at(-1).x)},${H - m.b}L${x(pts[0].x)},${H - m.b}Z`;
      svg.append(s('path', { d: area, fill: seriesColor(i), opacity: 0.08 }));
    }
    svg.append(s('path', { d: dAttr, fill: 'none', stroke: seriesColor(i), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = pts.at(-1);
    svg.append(s('circle', { cx: x(last.x), cy: y(last.y), r: 4, fill: seriesColor(i), stroke: 'var(--surface)', 'stroke-width': 2 }));
  });

  const cross = s('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  const dots = series.map((_, i) => s('circle', { r: 4, fill: seriesColor(i), stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const hit = s('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent', tabindex: 0 });
  svg.append(hit);

  const showAt = (idx, evt) => {
    const d = dates[idx];
    cross.setAttribute('x1', x(d));
    cross.setAttribute('x2', x(d));
    cross.setAttribute('visibility', 'visible');
    const rows = [];
    series.forEach((se, i) => {
      const p = se.points.find((pt) => pt.x === d);
      if (p) {
        dots[i].setAttribute('cx', x(d));
        dots[i].setAttribute('cy', y(p.y));
        dots[i].setAttribute('visibility', 'visible');
        rows.push({ color: seriesColor(i), label: se.name, value: format(p.y) });
      } else dots[i].setAttribute('visibility', 'hidden');
    });
    showTooltip(evt, longDate(d), rows);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTooltip(); };
  hit.addEventListener('pointermove', (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const f = (px - m.l) / (W - m.l - m.r);
    const idx = Math.max(0, Math.min(dates.length - 1, Math.round(f * (dates.length - 1))));
    showAt(idx, evt);
  });
  hit.addEventListener('pointerleave', hide);
  let kIdx = dates.length - 1;
  hit.addEventListener('focus', () => {
    const b = svg.getBoundingClientRect();
    showAt(kIdx, { clientX: b.left + (x(dates[kIdx]) / W) * b.width, clientY: b.top + 20 });
  });
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    kIdx = Math.max(0, Math.min(dates.length - 1, kIdx + (e.key === 'ArrowRight' ? 1 : -1)));
    const b = svg.getBoundingClientRect();
    showAt(kIdx, { clientX: b.left + (x(dates[kIdx]) / W) * b.width, clientY: b.top + 20 });
  });
  wrap.append(svg);
  return wrap;
}

function shortDate(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function longDate(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export const statusOf = (score) => (score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad');
const STATUS_COLOR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

/** Donut showing a 0–100 score with its grade letter. */
export function ring(score, name, gradeLetter) {
  const wrap = document.createElement('div');
  wrap.className = 'ring';
  const r = 42;
  const c = 2 * Math.PI * r;
  const st = statusOf(score);
  const svg = s('svg', { viewBox: '0 0 104 104', role: 'img', 'aria-label': `${name}: ${score} out of 100, grade ${gradeLetter}` });
  svg.append(s('circle', { cx: 52, cy: 52, r, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': 9 }));
  svg.append(s('circle', {
    cx: 52, cy: 52, r, fill: 'none', stroke: STATUS_COLOR[st], 'stroke-width': 9, 'stroke-linecap': 'round',
    'stroke-dasharray': `${(score / 100) * c} ${c}`, transform: 'rotate(-90 52 52)',
  }));
  svg.append(s('text', { x: 52, y: 54, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 800, fill: 'var(--ink)' }, String(score)));
  svg.append(s('text', { x: 52, y: 72, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: 'var(--muted)' }, `GRADE ${gradeLetter}`));
  const n = document.createElement('div');
  n.className = 'name';
  n.textContent = name;
  wrap.append(svg, n);
  return wrap;
}

/** Horizontal bar list. items: [{ label, value, display?, color? }] */
export function barList(items, { max, href } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'bars';
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const lbl = document.createElement(href ? 'a' : 'span');
    lbl.className = 'lbl';
    lbl.textContent = it.label;
    lbl.title = it.label;
    if (href) lbl.href = href(it);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max(2, (it.value / top) * 100)}%`;
    if (it.color) fill.style.background = it.color;
    track.append(fill);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = it.display ?? String(it.value);
    row.append(lbl, track, val);
    row.addEventListener('pointermove', (e) => showTooltip(e, it.label, [{ label: it.tip || '', value: it.display ?? String(it.value), color: it.color || 'var(--s1)' }]));
    row.addEventListener('pointerleave', hideTooltip);
    wrap.append(row);
  }
  return wrap;
}
