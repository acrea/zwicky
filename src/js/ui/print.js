// Print / PDF (§5.7): a static view of all three tabs, one per printed section,
// with notes as numbered footnotes under each grid or matrix. It is built on
// "beforeprint" and laid out off-screen first, so option paths can be measured,
// then each section is scaled to fit a landscape page.

import { h, s } from './dom.js';
import { parametersOf, coordinate, rowLetter, getRating, rankOptions, scoreFraction, optionColour } from '../model.js';
import { optionVars } from './grid.js';
import { drawPaths } from './paths.js';
import { swatch } from './options-bar.js';
import { displayOptions, renderProfiles, ordinal } from './evaluation.js';

// Landscape A4 or Letter with 12 mm margins is at least ~960 CSS px wide.
const PAGE_WIDTH = 960;

function footnotes() {
  const list = [];
  return {
    add(ref, title, text) {
      list.push({ ref, title, text });
      return list.length;
    },
    mark: (n) => (n ? h('sup', { class: 'fn' }, String(n)) : null),
    render() {
      if (!list.length) return null;
      return h(
        'ol',
        { class: 'footnotes' },
        list.map((f) => h('li', null, h('span', { class: 'fn-ref' }, f.ref), f.title ? h('span', { class: 'fn-title' }, f.title) : null, h('span', { class: 'fn-text' }, f.text))),
      );
    },
  };
}

function staticGrid(app, section, notes) {
  const { space, state } = app;
  const solution = section === 'solution';
  const active = solution ? state.activeOption : null;
  const grid = h('div', { class: 'grid' });
  space[section].dims.forEach((dim, r) => {
    const row = h('div', { class: 'row' });
    const dn = dim.note ? notes.add(rowLetter(r), dim.title, dim.note) : 0;
    row.append(h('div', { class: 'cell dim' }, h('span', { class: 'coord' }, rowLetter(r)), notes.mark(dn), h('div', { class: 'title' }, dim.title)));
    parametersOf(dim).forEach((p, c) => {
      const coord = coordinate(r, c);
      const pn = p.note ? notes.add(coord, p.title, p.note) : 0;
      const cls = ['cell', 'param'];
      let style = null;
      if (section === 'problem' && p.mark) cls.push('mark-' + p.mark);
      const markers = [];
      if (solution) {
        if (active !== null && p.picks.includes(active)) {
          cls.push('picked');
          style = optionVars(active);
        }
        for (const o of space.options.items) {
          if (o.id === active || !p.picks.includes(o.id)) continue;
          markers.push(h('span', { class: ['marker', optionColour(o.id).style > 0 && 'alt'], style: optionVars(o.id) }, String(o.id)));
        }
      }
      row.append(
        h(
          'div',
          { class: cls, style, dataset: { uid: p.uid } },
          h('span', { class: 'coord' }, coord),
          notes.mark(pn),
          h('div', { class: 'title' }, p.title),
          markers.length ? h('div', { class: 'markers' }, markers) : null,
        ),
      );
    });
    grid.append(row);
  });
  const canvas = h('div', { class: 'grid-canvas', dataset: { section } });
  if (solution) canvas.append(s('svg', { class: 'paths', 'aria-hidden': 'true' }));
  canvas.append(grid);
  return canvas;
}

function band(text, kind) {
  if (!text) return null;
  return h('div', { class: ['note-band', kind] }, kind === 'band' ? h('span', { class: 'band-arrow' }, '↣') : null, h('p', { class: 'print-note' }, text));
}

function sectionHead(app, name) {
  return h(
    'header',
    { class: 'print-head' },
    h('span', { class: 'wordmark' }, 'zwicky', h('span', { class: 'dot' }, '.')),
    h('span', { class: 'print-doc' }, app.space.meta.title || 'Untitled'),
    h('span', { class: 'print-section-name' }, name),
  );
}

function optionLegend(app) {
  const { state } = app;
  const items = app.space.options.items;
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'print-legend' },
    items.map((o) =>
      h(
        'li',
        { class: o.id === state.activeOption && 'active', style: optionVars(o.id) },
        swatch(o.id, state.lineStyles),
        h('span', { class: 'id' }, 'O' + o.id),
        h('span', { class: 'legend-title' }, o.title || 'Untitled'),
        o.note ? h('span', { class: 'legend-note' }, o.note) : null,
      ),
    ),
  );
}

function ratingMatrix(app, opts, notes) {
  const { space } = app;
  const scale = space.meta.scale;
  const ranks = rankOptions(space);
  const table = h('table', { class: 'eval-table rating-table print-matrix' });
  table.append(
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { class: 'corner crit-col' }, 'Criterion'),
        h('th', { class: 'weight-col' }, 'Weight'),
        opts.map((o) => h('th', { class: 'opt-head', style: optionVars(o.id) }, h('span', { class: 'opt-head-btn' }, swatch(o.id), h('span', { class: 'id' }, 'O' + o.id), h('span', { class: 'opt-title' }, o.title || 'Untitled')))),
      ),
    ),
  );
  const body = h('tbody');
  for (const c of space.criteria.items) {
    const cn = c.note ? notes.add('C' + c.id, c.title, c.note) : 0;
    const tr = h('tr', null, h('th', { class: 'crit-col ecell crit' }, h('span', { class: 'id' }, 'C' + c.id), c.title, notes.mark(cn)), h('td', { class: ['weight-col', 'ecell', 'weight', c.weight === 0 && 'zero'] }, h('span', { class: 'w-val' }, String(c.weight))));
    for (const o of opts) {
      const r = getRating(space, o.id, c.id);
      const rn = r && r.note ? notes.add(`O${o.id} × C${c.id}`, `${o.title} · ${c.title}`, r.note) : 0;
      const score = r ? r.score : null;
      tr.append(h('td', { class: 'ecell rating' }, h('span', { class: ['score', score === null && 'empty'] }, score === null ? '·' : String(score)), notes.mark(rn)));
    }
    body.append(tr);
  }
  table.append(body);
  table.append(
    h(
      'tfoot',
      null,
      h(
        'tr',
        { class: 'total-row' },
        h('th', { class: 'crit-col', colspan: '2' }, 'Weighted score'),
        opts.map((o) => {
          const r = ranks.get(o.id);
          return h('td', { class: ['total', r.rank === 1 && 'top'], style: optionVars(o.id) }, h('span', { class: 'total-val' }, r.display === null ? '–' : r.display.toFixed(1)), h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: (scoreFraction(r.score, scale) * 100).toFixed(1) + '%' } })));
        }),
      ),
      h('tr', { class: 'unrated-row' }, h('th', { class: 'crit-col', colspan: '2' }, 'Unrated'), opts.map((o) => h('td', null, String(ranks.get(o.id).unrated)))),
      h(
        'tr',
        { class: 'rank-row' },
        h('th', { class: 'crit-col', colspan: '2' }, 'Rank'),
        opts.map((o) => {
          const r = ranks.get(o.id).rank;
          return h('td', null, r === null ? '–' : r === 1 ? h('span', { class: 'badge' }, '1st') : ordinal(r));
        }),
      ),
    ),
  );
  return table;
}

/** Builds the print view and appends it to the document. */
export function preparePrint(app) {
  cleanupPrint();
  const { space } = app;
  const root = h('div', { class: 'print-root', 'aria-hidden': 'true' });
  const sections = [];

  if (space.problem.note || space.problem.dims.length) {
    const notes = footnotes();
    const grid = staticGrid(app, 'problem', notes);
    sections.push(h('section', { class: 'print-section' }, sectionHead(app, 'Problem'), band(space.problem.note, 'band'), grid, notes.render()));
  }
  let solutionCanvas = null;
  if (space.solution.note || space.solution.dims.length) {
    const notes = footnotes();
    solutionCanvas = staticGrid(app, 'solution', notes);
    sections.push(h('section', { class: 'print-section' }, sectionHead(app, 'Solution'), band(space.solution.note, 'intro'), optionLegend(app), solutionCanvas, notes.render()));
  }
  const opts = displayOptions(app);
  if (opts.length || space.criteria.items.length) {
    const notes = footnotes();
    sections.push(
      h(
        'section',
        { class: 'print-section' },
        sectionHead(app, 'Evaluation'),
        opts.length && space.solution.dims.length ? h('div', { class: 'print-block' }, h('h2', { class: 'section-title' }, 'Option profiles'), renderProfiles(app, opts)) : null,
        space.criteria.items.length ? h('div', { class: 'print-block' }, h('h2', { class: 'section-title' }, 'Ratings'), ratingMatrix(app, opts, notes)) : null,
        space.criteria.items.length ? notes.render() : null,
      ),
    );
  }
  if (!sections.length) sections.push(h('section', { class: 'print-section' }, sectionHead(app, ''), h('p', null, 'This space is empty.')));
  root.append(...sections);
  document.body.append(root);

  // measure at full size, then scale each section to the page width
  if (solutionCanvas) drawPaths(app, solutionCanvas);
  for (const sec of sections) {
    const w = sec.scrollWidth;
    if (w > PAGE_WIDTH) sec.style.zoom = String(Math.max(0.35, PAGE_WIDTH / w));
  }
  return root;
}

export function cleanupPrint() {
  for (const el of document.querySelectorAll('.print-root')) el.remove();
}
