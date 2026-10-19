// Options bar above the box: one chip per option, "+ Option", and the
// compare toggle. An extension's chip names the option it extends.

import { h, s } from './dom.js';
import { addOption, moveItem } from '../model.js';
import { optionVars, optionStyle } from './grid.js';

/** A small colour swatch that also shows the option's line style (dashed or dotted for extensions). */
export function swatch(space, id) {
  const { dash } = optionStyle(space, id);
  return s(
    'svg',
    { class: 'swatch', viewBox: '0 0 20 10', width: '20', height: '10', 'aria-hidden': 'true', style: optionVars(space, id) },
    s('line', { x1: '1', y1: '5', x2: '19', y2: '5', 'stroke-dasharray': dash || null }),
    s('circle', { cx: '10', cy: '5', r: '3.5' }),
  );
}

/** "↳ O2" on an extension: the option it extends. */
export function extendsRef(option) {
  if (option.extends === null) return null;
  return h('span', { class: 'extends-ref', title: `Extends O${option.extends}` }, '↳ O' + option.extends);
}

export function renderOptionsBar(app) {
  const { state, space } = app;
  const bar = h('div', { class: 'options-bar', role: 'toolbar', 'aria-label': 'Options' });
  const label = h('span', { class: 'bar-label' }, 'Options');
  bar.append(label);

  const chips = h('div', { class: 'chips' });
  for (const o of space.options) {
    const active = state.activeOption === o.id;
    const chip = h(
      'button',
      {
        class: ['chip', active && 'active', active && state.pickMode && 'picking'],
        style: optionVars(space, o.id),
        draggable: 'true',
        'aria-pressed': active ? 'true' : 'false',
        title: active
          ? state.pickMode
            ? 'Picking: click parameters to toggle them. Click again or press Esc to stop.'
            : 'Click to pick parameters for this option'
          : 'Show this option and pick its parameters',
        dataset: { id: String(o.id) },
        onclick: () => app.chipClick(o.id),
        ondblclick: () => app.inspectOption(o.id, { focusTitle: true }),
      },
      swatch(space, o.id),
      h('span', { class: 'id' }, 'O' + o.id),
      h('span', { class: ['chip-title', !o.title && 'empty'] }, o.title || 'Untitled'),
      extendsRef(o),
    );
    chips.append(chip);
  }

  // drag chips to reorder
  let dragId = null;
  chips.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    dragId = Number(chip.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'O' + dragId);
  });
  chips.addEventListener('dragover', (e) => {
    if (dragId === null) return;
    const chip = e.target.closest('.chip');
    for (const c of chips.querySelectorAll('.drop-before, .drop-after')) c.classList.remove('drop-before', 'drop-after');
    if (!chip) return;
    e.preventDefault();
    const r = chip.getBoundingClientRect();
    chip.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  });
  chips.addEventListener('drop', (e) => {
    const chip = e.target.closest('.chip');
    if (dragId === null || !chip) return;
    e.preventDefault();
    const items = space.options;
    const from = items.findIndex((o) => o.id === dragId);
    const r = chip.getBoundingClientRect();
    let to = items.findIndex((o) => o.id === Number(chip.dataset.id)) + (e.clientX < r.left + r.width / 2 ? 0 : 1);
    if (from < to) to -= 1;
    dragId = null;
    if (from !== to) app.change(() => moveItem(items, from, to));
  });
  chips.addEventListener('dragend', () => {
    dragId = null;
    for (const c of chips.querySelectorAll('.drop-before, .drop-after')) c.classList.remove('drop-before', 'drop-after');
  });

  chips.append(
    h(
      'button',
      {
        class: 'chip add',
        title: 'Add an option',
        onclick: () => {
          let o;
          app.change(() => (o = addOption(space, '')));
          app.activateOption(o.id, true);
          app.inspectOption(o.id, { focusTitle: true });
        },
      },
      '+ Option',
    ),
  );
  bar.append(chips);

  const toggles = h('div', { class: 'bar-toggles' });
  toggles.append(
    h(
      'button',
      {
        class: 'toggle',
        'aria-pressed': state.compare ? 'true' : 'false',
        title: 'Draw all option paths at once',
        onclick: () => app.setView({ compare: !state.compare }),
      },
      'Compare',
    ),
  );
  bar.append(toggles);

  if (state.pickMode && state.activeOption !== null) {
    const o = space.options.find((x) => x.id === state.activeOption);
    bar.append(
      h(
        'div',
        { class: 'pick-hint', role: 'status', style: optionVars(space, state.activeOption) },
        h('strong', null, 'Picking for O' + state.activeOption + (o && o.title ? ' ' + o.title : '')),
        ' — click open parameters (or press Space) to toggle them. Esc to finish.',
      ),
    );
  }
  return bar;
}
