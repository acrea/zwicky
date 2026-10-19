// Legend: a small box under the box (the grid), bottom right, explaining
// what is not self-evident: the marks, paths and extension line styles.

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
  const mark = (m, text) =>
    h(
      'span',
      { class: 'legend-item', title: `${MARK_INFO[m].label}: ${MARK_INFO[m].help}` },
      h('span', { class: ['legend-swatch', 'mark-' + m], 'aria-hidden': 'true' }, MARK_INFO[m].glyph),
      h('strong', null, MARK_INFO[m].label),
      ' ' + text,
    );
  return [
    mark('fixed', 'already decided'),
    mark('out', 'excluded'),
    h('span', { class: 'legend-item', title: 'Each option is drawn as a path through what it picks' }, lineSample(DASHES[0]), h('strong', null, 'Option')),
    h('span', { class: 'legend-item', title: 'Later versions of an option, drawn in its colour' }, lineSample(DASHES[1]), lineSample(DASHES[2]), h('strong', null, 'Extensions')),
  ];
}

/** The "Legend" box under the grid (also used by the print view). */
export function renderLegend() {
  return h(
    'aside',
    { class: 'legend-box', 'aria-label': 'Legend' },
    h('span', { class: 'bar-label' }, 'Legend'),
    h('div', { class: 'legend' }, legendItems()),
  );
}
