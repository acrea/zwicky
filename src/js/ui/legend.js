// Legend above the box: what rows, cells, marks, paths and line styles mean.

import { h, s } from './dom.js';
import { MARK_INFO, DASHES } from './grid.js';

/** A short line in the ink colour with a dash pattern, for the legend. */
function lineSample(dash) {
  return s(
    'svg',
    { class: 'legend-line', viewBox: '0 0 22 8', width: '22', height: '8', 'aria-hidden': 'true' },
    s('line', { x1: '1', y1: '4', x2: '21', y2: '4', 'stroke-dasharray': dash || null }),
  );
}

/** The legend's entries (also used by the print view). */
export function legendItems() {
  const mark = (m) =>
    h(
      'span',
      { class: 'legend-item' },
      h('span', { class: ['legend-swatch', 'mark-' + m], 'aria-hidden': 'true' }, MARK_INFO[m].glyph),
      h('strong', null, MARK_INFO[m].label),
      ' ' + MARK_INFO[m].help,
    );
  return [
    h('span', { class: 'legend-item' }, h('strong', null, 'Rows'), ' dimensions'),
    h('span', { class: 'legend-item' }, h('strong', null, 'Cells'), ' parameters, open unless marked'),
    mark('fixed'),
    mark('out'),
    h('span', { class: 'legend-item' }, lineSample(DASHES[0]), h('strong', null, 'Paths'), ' options: what each one picks'),
    h('span', { class: 'legend-item' }, lineSample(DASHES[1]), lineSample(DASHES[2]), h('strong', null, 'Extensions'), ' later versions of an option, in its colour'),
  ];
}

export function renderLegend() {
  return h('div', { class: 'legend-bar' }, h('div', { class: 'legend', role: 'note', 'aria-label': 'Legend' }, legendItems()));
}
