// Legend above the box: what rows, cells, marks and paths mean, plus the
// "scope up to stage N" filter, which greys out the options of later stages.
// The filter is a view setting, not saved.

import { h } from './dom.js';
import { STAGES, stageName, inScope } from '../model.js';
import { MARK_INFO } from './grid.js';

/** A small pill with a stage's name, tinted like the stage. */
export function stagePill(space, stage, extraClass) {
  if (!STAGES.includes(stage)) return null;
  return h('span', { class: ['stage-pill', 'stage-' + stage, extraClass] }, stageName(space, stage));
}

/** Whether an option is outside the current scope filter. */
export const optionBeyondScope = (app, option) => !inScope(option.stage, app.state.scopeUpTo);

export function scopeFilter(app) {
  const { state, space } = app;
  const button = (upTo, label, title) =>
    h(
      'button',
      {
        class: ['toggle', upTo && 'stage-' + upTo],
        'aria-pressed': state.scopeUpTo === upTo ? 'true' : 'false',
        title,
        onclick: () => app.setScope(upTo),
      },
      label,
    );
  return h(
    'div',
    { class: 'scope-filter', role: 'group', 'aria-label': 'Scope filter' },
    h('span', { class: 'bar-label' }, 'Scope up to'),
    h(
      'div',
      { class: 'segmented' },
      button(null, 'All', 'Show everything'),
      STAGES.map((n) =>
        button(n, stageName(space, n), n === 1 ? `Grey out the options outside ${stageName(space, 1)}` : `Grey out the options beyond ${stageName(space, n)}`),
      ),
    ),
  );
}

/** The legend's entries (also used by the print view). */
export function legendItems(app) {
  const { space } = app;
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
    h('span', { class: 'legend-item' }, h('strong', null, 'Paths'), ' options: what each one picks'),
    h('span', { class: 'legend-item' }, h('strong', null, 'Stages'), ' ', STAGES.map((n) => stagePill(space, n))),
  ];
}

export function renderLegend(app) {
  return h('div', { class: 'legend-bar' }, h('div', { class: 'legend', role: 'note', 'aria-label': 'Legend' }, legendItems(app)), scopeFilter(app));
}
