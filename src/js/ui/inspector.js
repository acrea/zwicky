// Inspector panel (§3): title and note of the selected item, document fields
// when nothing is selected, plus a few item-specific controls.

import { h } from './dom.js';
import {
  findNode,
  findOption,
  optionProfile,
  looksDecided,
  setStage,
  stageName,
  cleanStageName,
  STAGES,
  DEFAULT_STAGE_NAMES,
  coordinate,
  rowLetter,
  duplicateOption,
  removeOption,
  clampAllScores,
  cleanTitle,
} from '../model.js';
import { swatch } from './options-bar.js';
import { MARK_INFO } from './grid.js';
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
  if (tab === 'box') {
    const cur = state.cursor.box;
    if (cur && (cur.type === 'dim' || cur.type === 'param')) {
      const found = findNode(space, cur.uid);
      if (found) return { kind: cur.type, found };
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

const NOTE_PLACEHOLDERS = {
  fixed: 'Why is it fixed, and who decided?',
  out: 'Why is it out?',
};

/** A dimension with a single open parameter may be a constraint in disguise. */
function decidedHint(app, param) {
  return h(
    'p',
    { class: 'insp-hint' },
    'Already decided? ',
    h('button', { class: 'link', onclick: () => app.markParameter(param, 'fixed') }, 'Mark it as fixed'),
    '. ',
    h('kbd', null, 'F'),
  );
}

function nodeInspector(app, { kind, found }) {
  const { space } = app;
  const { node, dim, row } = found;
  const out = [];
  if (kind === 'dim') {
    out.push(head('Dimension', `row ${rowLetter(row)}`));
    out.push(titleField(app, node), noteField(app, node));
    const fixed = node.params.filter((p) => p.mark === 'fixed').length;
    const excluded = node.params.filter((p) => p.mark === 'out').length;
    const counts = [`${node.params.length} parameter${node.params.length === 1 ? '' : 's'}`, fixed && `${fixed} fixed`, excluded && `${excluded} out`];
    out.push(h('p', { class: 'insp-meta' }, counts.filter(Boolean).join(' · ')));
    if (looksDecided(node)) out.push(decidedHint(app, node.params[0]));
  } else {
    const ref = coordinate(row, found.index);
    out.push(head('Parameter', `${ref} · ${dim.title || 'Untitled dimension'}`));
    out.push(titleField(app, node), noteField(app, node, 'Note', NOTE_PLACEHOLDERS[node.mark]));
    const markButton = (mark, key) =>
      h(
        'button',
        {
          class: ['toggle', 'mark-toggle', 'mark-' + mark],
          'aria-pressed': node.mark === mark ? 'true' : 'false',
          title: `${MARK_INFO[mark].label}: ${MARK_INFO[mark].help}`,
          onclick: () => app.markParameter(node, mark),
        },
        MARK_INFO[mark].label,
        h('kbd', null, key),
      );
    out.push(
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Frame'),
        h('div', { class: 'segmented mark-choice' }, markButton('fixed', 'F'), markButton('out', 'X')),
        h('p', { class: 'insp-meta' }, node.mark ? `${MARK_INFO[node.mark].label}: ${MARK_INFO[node.mark].help}.` : 'Open: options can pick it.'),
      ),
    );
    if (looksDecided(dim)) out.push(decidedHint(app, node));
    if (!node.mark) {
      const list = h('div', { class: 'pick-list' });
      for (const o of space.options) {
        const id = 'pick-' + o.id;
        list.append(
          h(
            'label',
            { class: 'pick-row', for: id },
            h('input', { type: 'checkbox', id, checked: node.picks.includes(o.id), onchange: () => app.pick(node, o.id) }),
            swatch(o.id, app.state.lineStyles),
            h('span', { class: 'id' }, 'O' + o.id),
            h('span', { class: ['pick-title', !o.title && 'empty'] }, o.title || 'Untitled'),
            o.id <= 9 ? h('kbd', null, String(o.id)) : null,
          ),
        );
      }
      if (!space.options.length) list.append(h('p', { class: 'insp-meta' }, 'No options yet. Add one with “+ Option”.'));
      out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Picked by'), list));
    }
  }
  out.push(
    h(
      'div',
      { class: 'insp-actions' },
      h('button', { class: 'btn danger-quiet', onclick: () => app.deleteCursor() }, kind === 'dim' ? 'Delete dimension' : 'Delete parameter'),
    ),
  );
  return out;
}

/** One toggle per stage; pressing the current stage clears it. */
function stageButtons(app, option) {
  return STAGES.map((n) =>
    h(
      'button',
      {
        class: ['toggle', 'stage-toggle', 'stage-' + n],
        'aria-pressed': option.stage === n ? 'true' : 'false',
        onclick: () => app.change(() => setStage(option, option.stage === n ? null : n)),
      },
      stageName(app.space, n),
    ),
  );
}

function optionInspector(app, option) {
  const { space, state } = app;
  const out = [head('Option', null, h('span', { class: 'insp-ref option-ref' }, swatch(option.id, state.lineStyles), 'O' + option.id))];
  out.push(titleField(app, option), noteField(app, option, 'Note', 'What is the idea behind this option?'));
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Stage'), h('div', { class: 'segmented stage-choice' }, stageButtons(app, option))));
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
    const items = params.map((p) => h('span', { class: p.mark === 'fixed' && 'fixed' }, p.title || 'Untitled'));
    profile.append(
      h('dt', null, dim.title || 'Untitled dimension'),
      h('dd', { class: !params.length && 'none' }, params.length ? items.flatMap((el, i) => (i ? [' · ', el] : [el])) : '—'),
    );
  }
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Profile'), space.dims.length ? profile : h('p', { class: 'insp-meta' }, 'The box is empty.')));

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
  const stageNames = h('div', { class: 'stage-names' });
  for (const n of STAGES) {
    stageNames.append(
      field(app, {
        label: `Stage ${n}`,
        value: meta.stages[n - 1],
        placeholder: DEFAULT_STAGE_NAMES[n - 1],
        cls: 'stage-' + n,
        onInput: (v) => (meta.stages[n - 1] = v),
        onCommit: (v) => (meta.stages[n - 1] = cleanStageName(v) || DEFAULT_STAGE_NAMES[n - 1]),
      }),
    );
  }
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Stage names'), stageNames));
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
  for (const [k, d] of SHORTCUTS.slice(0, 12)) keys.append(h('dt', null, k), h('dd', null, d));
  out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Keyboard'), keys, h('button', { class: 'link', onclick: () => app.help() }, 'All shortcuts …')));
  return out;
}
