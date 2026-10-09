// SVG overlay that draws options as paths through their picked cells (§3.3).
// The SVG lives inside the scrolling grid canvas, under the cells, so it scrolls
// with the grid and only needs redrawing when the layout changes.

import { s, clear } from './dom.js';
import { parametersOf } from '../model.js';
import { optionStyle } from './grid.js';

/** Cell centres of an option's picks: row by row, left to right within a row. */
function pathPoints(space, optionId, cells, origin) {
  const points = [];
  for (const dim of space.solution.dims) {
    for (const p of parametersOf(dim)) {
      if (!p.picks.includes(optionId)) continue;
      const el = cells.get(p.uid);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      points.push([r.left - origin.left + r.width / 2, r.top - origin.top + r.height / 2]);
    }
  }
  return points;
}

export function drawPaths(app, canvas) {
  const svg = canvas.querySelector('svg.paths');
  if (!svg) return;
  clear(svg);
  const { state, space } = app;
  const active = state.activeOption;
  const ids = state.compare ? space.options.items.map((o) => o.id) : active !== null ? [active] : [];
  if (!ids.length) return;

  const origin = canvas.getBoundingClientRect();
  svg.setAttribute('width', canvas.scrollWidth);
  svg.setAttribute('height', canvas.scrollHeight);
  const cells = new Map();
  for (const el of canvas.querySelectorAll('.cell.param')) cells.set(el.dataset.uid, el);

  // active option last, so it is drawn on top
  const order = ids.filter((id) => id !== active);
  if (ids.includes(active)) order.push(active);

  for (const id of order) {
    const pts = pathPoints(space, id, cells, origin);
    if (!pts.length) continue;
    const isActive = id === active;
    const { colour, dash } = optionStyle(id, state.lineStyles);
    const g = s('g', {
      class: ['path', isActive ? 'active' : 'other'],
      style: { '--opt': `var(--option-${colour})` },
    });
    if (pts.length > 1) {
      g.append(
        s('polyline', {
          points: pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '),
          'stroke-dasharray': dash || null,
        }),
      );
    }
    for (const [x, y] of pts) g.append(s('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: isActive ? 5 : 3.5 }));
    svg.append(g);
  }
}

/** Redraws on layout changes (resize, font load, wrapping). Returns a disconnect function. */
export function watchPaths(app, canvas) {
  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => drawPaths(app, canvas));
  };
  const ro = new ResizeObserver(redraw);
  ro.observe(canvas);
  for (const row of canvas.querySelectorAll('.row')) ro.observe(row);
  redraw();
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
  };
}
