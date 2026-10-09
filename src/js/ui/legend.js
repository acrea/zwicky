// Legend above the Problem and Solution grids: what rows, cells and tints mean,
// plus the "scope up to stage N" filter, which greys out later stages (and the
// options that address them). The filter is a view setting, not saved.

import { h } from './dom.js';
import { STAGES, stageName, inScope } from '../model.js';

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
        button(n, stageName(space, n), n === 1 ? `Grey out everything outside ${stageName(space, 1)}` : `Grey out everything beyond ${stageName(space, n)}`),
      ),
    ),
  );
}

/** The legend's entries for a grid section (also used by the print view). */
export function legendItems(app, section) {
  const { space } = app;
  const items = [];
  if (section === 'problem') {
    items.push(
      h('span', { class: 'legend-item' }, h('strong', null, 'Rows'), ' dimensions of the problem'),
      h('span', { class: 'legend-item' }, h('strong', null, 'Cells'), ' their parameters'),
      ...STAGES.map((n) => h('span', { class: 'legend-item' }, h('span', { class: ['legend-swatch', 'stage-' + n], 'aria-hidden': 'true' }), stageName(space, n))),
      h('span', { class: 'legend-item legend-out' }, 'Out of scope'),
    );
  } else {
    items.push(
      h('span', { class: 'legend-item' }, h('strong', null, 'Rows'), ' dimensions of the solution'),
      h('span', { class: 'legend-item' }, h('strong', null, 'Cells'), ' building blocks'),
      h('span', { class: 'legend-item' }, h('strong', null, 'Paths'), ' options: the blocks each one picks'),
      h('span', { class: 'legend-item' }, h('strong', null, 'Stages'), ' ', STAGES.map((n) => stagePill(space, n))),
    );
  }
  return items;
}

export function renderLegend(app, section) {
  return h('div', { class: 'legend-bar' }, h('div', { class: 'legend', role: 'note', 'aria-label': 'Legend' }, legendItems(app, section)), scopeFilter(app));
}
