// Inspector panel (§3): title and note of the selected item, document fields
// when nothing is selected, plus a few item-specific controls.

import { h } from './dom.js';
import {
  findNode,
  findOption,
  optionProfile,
  togglePick,
  toggleMark,
  coordinate,
  rowLetter,
  parametersOf,
  duplicateOption,
  removeOption,
  clampAllScores,
  cleanTitle,
} from '../model.js';
import { swatch } from './options-bar.js';
import { SHORTCUTS } from './shortcuts.js';

/**
 * A text field bound to the model. A typing session is one undo step: the
 * snapshot is taken on focus and recorded on the first input.
 */
export function field(app, { label, value, multiline = false, placeholder = '', onInput, onCommit, id, cls, wrapClass, rows = 2 }) {
  const attrs = {
    class: ['field-input', cls],
    value,
    placeholder,
    'aria-label': label,
    spellcheck: 'true',
    id,
  };
  const el = multiline ? h('textarea', { ...attrs, rows: String(rows) }) : h('input', { ...attrs, type: 'text' });
  const grow = () => {
    if (!multiline) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  };
  el.addEventListener('focus', () => app.history.beginEdit(app.space));
  el.addEventListener('input', () => {
    app.history.touch();
    onInput(el.value);
    app.markDirty();
    app.renderSoon({ inspector: false });
    grow();
  });
  el.addEventListener('blur', () => {
    app.history.endEdit();
    if (onCommit) onCommit(el.value);
    app.renderSoon();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
    } else if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    } else if (multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      el.blur();
    }
  });
  requestAnimationFrame(grow);
  return h('label', { class: ['field', wrapClass] }, h('span', { class: 'field-label' }, label), el);
}

const titleField = (app, item, label = 'Title') =>
  field(app, {
    label,
    value: item.title,
    id: 'inspector-title',
    cls: 'title-input',
    onInput: (v) => (item.title = v),
    onCommit: (v) => (item.title = cleanTitle(v)),
  });

const noteField = (app, item, label = 'Note', placeholder = 'Clarify the buzzword, record an assumption …') =>
  field(app, { label, value: item.note, multiline: true, placeholder, onInput: (v) => (item.note = v) });

function head(kind, ref, extra) {
  return h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, kind), ref ? h('span', { class: 'insp-ref' }, ref) : null, extra);
}

/** What the inspector should show for the current tab. */
export function inspected(app) {
  const { state, space } = app;
  const tab = state.tab;
  const insp = state.inspect[tab];
  if (insp && insp.type === 'option' && findOption(space, insp.id)) return { kind: 'option', option: findOption(space, insp.id) };
  if (tab === 'evaluation' && app.evaluationInspected) {
    const r = app.evaluationInspected(app);
    if (r) return r;
  }
  if (tab === 'problem' || tab === 'solution') {
    const cur = state.cursor[tab];
    if (cur && (cur.type === 'dim' || cur.type === 'param')) {
      const found = findNode(space, cur.uid);
      if (found) return { kind: cur.type, found, section: tab };
    }
  }
  return { kind: 'document' };
}

export function inspectedKey(app) {
  const i = inspected(app);
  if (i.kind === 'option') return 'option:' + i.option.uid;
  if (i.found) return i.kind + ':' + i.found.node.uid;
  return i.kind + ':' + (i.key || '');
}

export function renderInspector(app) {
  const i = inspected(app);
  const body = h('div', { class: 'insp-body' });
  if (i.kind === 'param' || i.kind === 'dim') body.append(...nodeInspector(app, i));
  else if (i.kind === 'option') body.append(...optionInspector(app, i.option));
  else if (app.inspectorExtensions && app.inspectorExtensions[i.kind]) body.append(...app.inspectorExtensions[i.kind](app, i));
  else body.append(...documentInspector(app));
  return body;
}

function nodeInspector(app, { kind, found, section }) {
  const { space } = app;
  const { node, parent } = found;
  const dims = space[section].dims;
  const out = [];
  if (kind === 'dim') {
    const r = dims.indexOf(node);
    out.push(head('Dimension', `${section === 'problem' ? 'Problem' : 'Solution'} · row ${rowLetter(r)}`));
    out.push(titleField(app, node), noteField(app, node));
    out.push(h('p', { class: 'insp-meta' }, `${parametersOf(node).length} parameters`));
  } else {
    const r = dims.indexOf(parent);
    const ref = coordinate(r, parametersOf(parent).indexOf(node));
    out.push(head('Parameter', `${ref} · ${parent.title || 'Untitled dimension'}`));
    out.push(titleField(app, node), noteField(app, node));
    if (section === 'problem') {
      const mark = (m, label, key) =>
        h(
          'button',
          {
            class: ['toggle', 'mark-toggle', 'mark-' + m],
            'aria-pressed': node.mark === m ? 'true' : 'false',
            onclick: () => app.change(() => toggleMark(node, m)),
          },
          label,
          h('kbd', null, key),
        );
      out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Mark'), h('div', { class: 'segmented' }, mark('focus', 'Focus', 'F'), mark('out', 'Out of scope', 'X'))));
    } else {
      const list = h('div', { class: 'pick-list' });
      for (const o of space.options.items) {
        const id = 'pick-' + o.id;
        list.append(
          h(
            'label',
            { class: 'pick-row', for: id },
            h('input', { type: 'checkbox', id, checked: node.picks.includes(o.id), onchange: () => app.change(() => togglePick(node, o.id)) }),
            swatch(o.id, app.state.lineStyles),
            h('span', { class: 'id' }, 'O' + o.id),
            h('span', { class: ['pick-title', !o.title && 'empty'] }, o.title || 'Untitled'),
            o.id <= 9 ? h('kbd', null, String(o.id)) : null,
          ),
        );
      }
      if (!space.options.items.length) list.append(h('p', { class: 'insp-meta' }, 'No options yet. Add one with “+ Option”.'));
      out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Picked by'), list));
    }
  }
  out.push(
    h(
      'div',
      { class: 'insp-actions' },
      kind === 'dim'
        ? h(
            'button',
            { class: 'btn', title: 'Move this dimension and its parameters to the other space', onclick: () => app.moveCursorDimension(section) },
            section === 'problem' ? 'Move to Solution' : 'Move to Problem',
            h('kbd', null, 'M'),
          )
        : null,
      h('button', { class: 'btn danger-quiet', onclick: () => app.deleteCursor(section) }, kind === 'dim' ? 'Delete dimension' : 'Delete parameter'),
    ),
  );
  return out;
}

function optionInspector(app, option) {
  const { space, state } = app;
  const out = [head('Option', null, h('span', { class: 'insp-ref option-ref' }, swatch(option.id, state.lineStyles), 'O' + option.id))];
  out.push(titleField(app, option), noteField(app, option, 'Note', 'What is the idea behind this option?'));
  const active = state.activeOption === option.id;
  out.push(
    h(
      'div',
      { class: 'insp-actions' },
      h(
        'button',
        { class: ['btn', active && state.pickMode && 'pressed'], 'aria-pressed': active && state.pickMode ? 'true' : 'false', onclick: () => app.chipClick(option.id) },
        active && state.pickMode ? 'Stop picking' : 'Pick parameters',
      ),
    ),
  );

  const profile = h('dl', { class: 'profile' });
  for (const { dim, params } of optionProfile(space, option.id)) {
    profile.append(
      h('dt', null, dim.title || 'Untitled dimension'),
      h('dd', { class: !params.length && 'none' }, params.length ? params.map((p) => p.title || 'Untitled').join(' · ') : '—'),
    );
  }
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Profile'), space.solution.dims.length ? profile : h('p', { class: 'insp-meta' }, 'The solution space is empty.')));

  out.push(
    h(
      'div',
      { class: 'insp-actions' },
      h(
        'button',
        {
          class: 'btn',
          title: 'Start a new option as a copy of this one',
          onclick: () => {
            let copy;
            app.change(() => (copy = duplicateOption(space, option.id)));
            app.activateOption(copy.id, false);
            app.inspectOption(copy.id, { focusTitle: true });
            app.toast(`O${copy.id} started as a copy of O${option.id}.`);
          },
        },
        'Duplicate',
      ),
      h(
        'button',
        {
          class: 'btn danger-quiet',
          onclick: async () => {
            const ok = await app.confirm(`Delete O${option.id} ${option.title}?`, 'Its picks and ratings are removed too. You can undo this.', 'Delete option');
            if (!ok) return;
            app.change(() => removeOption(space, option.id));
            if (state.activeOption === option.id) app.activateOption(null);
            app.inspectOption(null);
          },
        },
        'Delete option',
      ),
    ),
  );
  return out;
}

function documentInspector(app) {
  const { space } = app;
  const meta = space.meta;
  const out = [head('Document')];
  out.push(
    field(app, {
      label: 'Title',
      value: meta.title,
      placeholder: 'Untitled',
      onInput: (v) => (meta.title = v),
      onCommit: (v) => (meta.title = v.replace(/\s+/g, ' ').trim()),
    }),
  );

  const scaleInput = (key) =>
    h('input', {
      type: 'number',
      class: 'field-input num',
      min: key === 'min' ? '0' : '1',
      max: '100',
      value: String(meta.scale[key]),
      'aria-label': key === 'min' ? 'Scale minimum' : 'Scale maximum',
      onchange: (e) => {
        const v = Math.round(Number(e.target.value));
        const next = { ...meta.scale, [key]: v };
        if (!Number.isFinite(v) || next.min < 0 || next.max > 100 || next.min >= next.max) {
          app.toast('The scale needs whole numbers with min < max (0–100).');
          app.render();
          return;
        }
        app.change(() => {
          meta.scale = next;
          clampAllScores(space);
        });
      },
    });
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rating scale'), h('div', { class: 'scale-row' }, scaleInput('min'), h('span', null, 'to'), scaleInput('max'))));
  if (meta.updated) out.push(h('p', { class: 'insp-meta' }, 'Last saved ' + meta.updated));
  if (meta.extra.length) {
    const dl = h('dl', { class: 'profile' });
    for (const [k, v] of meta.extra) dl.append(h('dt', null, k), h('dd', null, v));
    out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Other front matter'), dl));
  }
  if (space.passthrough.length) {
    out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes section'), h('pre', { class: 'passthrough' }, space.passthrough.join('\n'))));
  }
  out.push(h('p', { class: 'insp-meta' }, 'Your work is kept in this browser’s cache. That is a convenience, not a backup: save to a file (File → Save).'));
  const keys = h('dl', { class: 'shortcuts' });
  for (const [k, d] of SHORTCUTS.slice(0, 14)) keys.append(h('dt', null, k), h('dd', null, d));
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Keyboard'), keys, h('button', { class: 'link', onclick: () => app.help() }, 'All shortcuts …')));
  return out;
}
