// Shared grid for the Problem and Solution tabs (§3.1): the morphological box.
// Rows are dimensions (sticky title column), cells are parameters, a ghost "+"
// cell ends every row and a ghost "+ Dimension" row ends the grid.

import { h, s, isMac } from './dom.js';
import {
  parametersOf,
  findNode,
  removeNode,
  moveNode,
  moveDimensionToSection,
  moveLosses,
  moveParameter,
  nodeHasContent,
  toggleMark,
  togglePick,
  setStage,
  cycleStage,
  stageName,
  inScope,
  findOption,
  optionColour,
  coordinate,
  rowLetter,
} from '../model.js';

// ---------------------------------------------------------------- cursor

/** The navigable cells, row by row: dimension, parameters, ghost; then the ghost dimension row. */
export function gridLayout(space, section) {
  const rows = space[section].dims.map((d) => [
    { type: 'dim', uid: d.uid },
    ...parametersOf(d).map((p) => ({ type: 'param', uid: p.uid })),
    { type: 'ghost', uid: d.uid },
  ]);
  rows.push([{ type: 'ghostdim', uid: '' }]);
  return rows;
}

export const selKey = (sel) => (sel ? `${sel.type}:${sel.uid || ''}` : '');

function findPos(rows, sel) {
  const key = selKey(sel);
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].findIndex((x) => selKey(x) === key);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** Keeps the cursor valid after a change: same item, else the same position. */
export function fixCursor(space, section, sel, fallbackPos) {
  const rows = gridLayout(space, section);
  if (sel && findPos(rows, sel)) return sel;
  const [r0, c0] = fallbackPos || [0, 0];
  const r = Math.max(0, Math.min(r0, rows.length - 1));
  const c = Math.max(0, Math.min(c0, rows[r].length - 1));
  return rows[r][c];
}

// ---------------------------------------------------------------- render

const DASHES = ['', '6 4', '1.5 4', '8 4 1.5 4', '12 4', '3 3', '10 3 1.5 3 1.5 3', '1.5 7'];

export function optionStyle(id, lineStyles) {
  const { colour, style } = optionColour(id);
  const dashIndex = lineStyles ? (id - 1) % DASHES.length : Math.min(style, 1);
  return { colour, style, dash: DASHES[dashIndex] };
}

export function optionVars(id) {
  const { colour } = optionColour(id);
  return { '--opt': `var(--option-${colour})`, '--on-opt': `var(--on-option-${colour})` };
}

/**
 * Renders a grid section. Returns { el, focusEl } where focusEl is the inline
 * editor (if editing) or the cursor cell.
 */
export function renderGrid(app, section) {
  const { space, state } = app;
  const dims = space[section].dims;
  const cursor = state.cursor[section];
  const cursorKey = selKey(cursor);
  const editing = state.editing && state.editing.section === section ? state.editing : null;
  const editKey = editing ? selKey(editing.sel) : '';
  const solution = section === 'solution';
  const active = solution ? state.activeOption : null;
  const options = space.options.items;
  let focusEl = null;

  let firstStop = !cursorKey; // with no cursor, the first cell is the grid's tab stop
  const cellAttrs = (sel, extraClass, label) => {
    const key = selKey(sel);
    const selected = key === cursorKey;
    const stop = selected || firstStop;
    firstStop = false;
    return {
      class: ['cell', extraClass, selected && 'selected'],
      role: 'gridcell',
      tabindex: stop ? '0' : '-1',
      'aria-selected': selected ? 'true' : 'false',
      'aria-label': label,
      dataset: { key, type: sel.type, uid: sel.uid },
    };
  };

  const titleEl = (sel, title, placeholder) => {
    if (selKey(sel) === editKey) {
      const ta = h('textarea', {
        class: 'inline-edit',
        rows: '1',
        spellcheck: 'true',
        'aria-label': 'Title',
        value: editing.initial ?? title,
        placeholder,
      });
      focusEl = ta;
      return ta;
    }
    return h('div', { class: ['title', !title && 'empty'] }, title || placeholder);
  };

  const noteFold = (note) => (note ? h('span', { class: 'fold', 'aria-hidden': 'true' }) : null);

  const grid = h('div', {
    class: ['grid', state.pickMode && solution && active !== null && 'pick-mode'],
    role: 'grid',
    'aria-label': solution ? 'Solution space' : 'Problem space',
  });

  dims.forEach((dim, r) => {
    const row = h('div', { class: 'row', role: 'row', dataset: { dim: dim.uid } });
    const dimSel = { type: 'dim', uid: dim.uid };
    row.append(
      h(
        'div',
        {
          ...cellAttrs(dimSel, ['dim', dim.note && 'has-note'], `Dimension ${rowLetter(r)}: ${dim.title}`),
          draggable: selKey(dimSel) === editKey ? null : 'true',
        },
        h('span', { class: 'coord' }, rowLetter(r)),
        noteFold(dim.note),
        titleEl(dimSel, dim.title, 'Untitled dimension'),
      ),
    );
    parametersOf(dim).forEach((p, c) => {
      const sel = { type: 'param', uid: p.uid };
      const cls = ['param', p.note && 'has-note'];
      let style = null;
      const markers = [];
      if (section === 'problem') {
        if (p.stage) cls.push('stage-' + p.stage);
        else if (p.mark) cls.push('mark-' + p.mark);
        if (!inScope(p.stage, state.scopeUpTo)) cls.push('beyond-scope');
      }
      if (solution) {
        if (active !== null && p.picks.includes(active)) {
          cls.push('picked');
          style = optionVars(active);
        }
        for (const o of options) {
          if (o.id === active || !p.picks.includes(o.id) || !inScope(o.stage, state.scopeUpTo)) continue;
          const { style: ls } = optionColour(o.id);
          markers.push(
            h(
              'span',
              { class: ['marker', ls > 0 && 'alt'], style: optionVars(o.id), title: `O${o.id} ${o.title}` },
              String(o.id),
            ),
          );
        }
      }
      const coord = coordinate(r, c);
      const label = [
        `${coord}: ${p.title}`,
        section === 'problem' && p.stage && stageName(space, p.stage),
        section === 'problem' && p.mark === 'out' && 'out of scope',
        solution && p.picks.length && 'picked by ' + p.picks.map((id) => 'O' + id).join(', '),
        p.note && 'has note',
      ]
        .filter(Boolean)
        .join(', ');
      row.append(
        h(
          'div',
          { ...cellAttrs(sel, cls, label), style, draggable: selKey(sel) === editKey ? null : 'true' },
          h('span', { class: 'coord' }, coord),
          noteFold(p.note),
          titleEl(sel, p.title, 'Untitled'),
          markers.length ? h('div', { class: 'markers' }, markers) : null,
        ),
      );
    });
    const ghostSel = { type: 'ghost', uid: dim.uid };
    row.append(
      h('div', cellAttrs(ghostSel, 'ghost', `Add parameter to ${dim.title}`), titleEl(ghostSel, '', '+')),
    );
    grid.append(row);
  });

  const gdSel = { type: 'ghostdim', uid: '' };
  grid.append(
    h(
      'div',
      { class: 'row ghost-row', role: 'row' },
      h('div', cellAttrs(gdSel, 'dim ghost', 'Add dimension'), titleEl(gdSel, '', '+ Dimension')),
    ),
  );

  const canvas = h('div', { class: 'grid-canvas cursor-root', dataset: { section } });
  if (solution) canvas.append(s('svg', { class: 'paths', 'aria-hidden': 'true' }));
  canvas.append(grid);
  wireGrid(app, section, canvas);

  if (!focusEl && cursorKey) focusEl = grid.querySelector(`[data-key="${CSS.escape(cursorKey)}"]`);
  return { el: canvas, focusEl };
}

// ---------------------------------------------------------------- mouse

const selFromCell = (cell) => ({ type: cell.dataset.type, uid: cell.dataset.uid || '' });

let drag = null; // { type: 'dim' | 'param', uid }

function wireGrid(app, section, canvas) {
  canvas.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || e.target.closest('.inline-edit')) return;
    const sel = selFromCell(cell);
    const { state } = app;
    if (sel.type === 'ghost' || sel.type === 'ghostdim') {
      app.setCursor(section, sel);
      app.startEdit(section, sel);
      return;
    }
    if (section === 'solution' && state.pickMode && state.activeOption !== null && sel.type === 'param') {
      const found = findNode(app.space, sel.uid);
      app.setCursor(section, sel, { render: false });
      app.change(() => togglePick(found.node, state.activeOption));
      return;
    }
    app.setCursor(section, sel);
  });

  // keyboard focus (Tab into the grid) moves the cursor to the focused cell
  canvas.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || e.target !== cell) return;
    const sel = selFromCell(cell);
    if (selKey(sel) !== selKey(app.state.cursor[section])) app.setCursor(section, sel);
  });

  canvas.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || e.target.closest('.inline-edit')) return;
    const sel = selFromCell(cell);
    app.setCursor(section, sel, { render: false });
    app.startEdit(section, sel);
  });

  // note tooltips
  canvas.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.cell.has-note');
    if (!cell) return;
    const found = findNode(app.space, cell.dataset.uid);
    if (found && found.node.note) app.tooltip.show(cell, found.node.note);
  });
  canvas.addEventListener('mouseout', (e) => {
    const cell = e.target.closest('.cell.has-note');
    if (cell && !cell.contains(e.relatedTarget)) app.tooltip.hide();
  });

  // inline editor
  canvas.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('inline-edit')) return;
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault(); // titles are single-line; Shift+Enter does nothing
      if (!e.shiftKey) app.finishEdit(e.target.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      app.finishEdit(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      app.finishEdit(e.target.value, { advance: e.shiftKey ? -1 : 1 });
    }
  });
  canvas.addEventListener('input', (e) => {
    if (e.target.classList.contains('inline-edit')) {
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
    }
  });
  canvas.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('inline-edit')) app.finishEdit(e.target.value, { fromBlur: true });
  });

  // drag and drop
  const clearMarks = () => {
    for (const el of canvas.querySelectorAll('.drop-before, .drop-after, .dragging'))
      el.classList.remove('drop-before', 'drop-after', 'dragging');
  };

  const dropTarget = (e) => {
    if (!drag) return null;
    if (drag.type === 'dim') {
      const row = e.target.closest('.row');
      if (!row || !row.dataset.dim) {
        if (e.target.closest('.ghost-row')) return { el: e.target.closest('.ghost-row'), before: true, dimUid: null };
        return null;
      }
      const rect = row.getBoundingClientRect();
      return { el: row, before: e.clientY < rect.top + rect.height / 2, dimUid: row.dataset.dim };
    }
    const cell = e.target.closest('.cell');
    if (!cell) return null;
    const row = cell.closest('.row');
    if (!row || !row.dataset.dim) return null;
    if (cell.dataset.type === 'ghost') return { el: cell, before: true, dimUid: row.dataset.dim, paramUid: null };
    if (cell.dataset.type === 'dim') {
      const first = row.querySelector('.cell.param, .cell.ghost');
      return { el: first, before: true, dimUid: row.dataset.dim, paramUid: first.dataset.type === 'param' ? first.dataset.uid : null };
    }
    const rect = cell.getBoundingClientRect();
    return { el: cell, before: e.clientX < rect.left + rect.width / 2, dimUid: row.dataset.dim, paramUid: cell.dataset.uid };
  };

  canvas.addEventListener('dragstart', (e) => {
    const cell = e.target.closest('.cell[draggable="true"]');
    if (!cell) return;
    drag = { type: cell.dataset.type, uid: cell.dataset.uid, section };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cell.textContent);
    cell.classList.add('dragging');
    app.tooltip.hide();
  });
  canvas.addEventListener('dragover', (e) => {
    if (!drag || drag.section !== section) return;
    const t = dropTarget(e);
    for (const el of canvas.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    t.el.classList.add(t.before ? 'drop-before' : 'drop-after');
  });
  canvas.addEventListener('dragleave', (e) => {
    if (!canvas.contains(e.relatedTarget)) clearMarks();
  });
  canvas.addEventListener('drop', (e) => {
    if (!drag || drag.section !== section) return;
    const t = dropTarget(e);
    const d = drag;
    drag = null;
    clearMarks();
    if (!t) return;
    e.preventDefault();
    const space = app.space;
    if (d.type === 'dim') {
      const dims = space[section].dims;
      const from = dims.findIndex((x) => x.uid === d.uid);
      let to = t.dimUid === null ? dims.length : dims.findIndex((x) => x.uid === t.dimUid) + (t.before ? 0 : 1);
      if (from < to) to -= 1;
      if (to !== from) app.change(() => moveNode(space, d.uid, to));
      return;
    }
    const target = findNode(space, t.dimUid).node;
    const from = findNode(space, d.uid);
    let to = t.paramUid === null ? target.children.length : target.children.findIndex((x) => x.uid === t.paramUid) + (t.before ? 0 : 1);
    if (from.parent === target && from.index < to) to -= 1;
    if (from.parent === target && from.index === to) return;
    app.change(() => moveParameter(space, d.uid, t.dimUid, to));
    app.setCursor(section, { type: 'param', uid: d.uid });
  });
  canvas.addEventListener('dragend', () => {
    drag = null;
    clearMarks();
  });
}

// ---------------------------------------------------------------- keyboard

export const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'];

/** Handles a key for the grid of `section`. Returns true if handled. */
export function gridKeydown(app, section, e) {
  const { state } = app;
  const space = app.space;
  const rows = gridLayout(space, section);
  const cursor = state.cursor[section];
  const pos = findPos(rows, cursor) || [0, 0];
  const [r, c] = pos;
  const sel = rows[r][c];
  const mod = e.ctrlKey || e.metaKey;
  const go = (nr, nc) => {
    const rr = Math.max(0, Math.min(nr, rows.length - 1));
    const cc = Math.max(0, Math.min(nc, rows[rr].length - 1));
    app.setCursor(section, rows[rr][cc]);
  };

  if (mod) return false;

  // with nothing selected, a navigation key selects the first cell; other keys do nothing
  if (!cursor) {
    if (!NAV_KEYS.includes(e.key) || e.altKey) return false;
    app.setCursor(section, rows[0][0]);
    return true;
  }

  // moving things
  if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (sel.type === 'ghostdim') return true;
    const found = findNode(space, sel.uid);
    if (!found) return true;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dimUid = sel.type === 'param' ? found.parent.uid : found.node.uid;
      const dims = space[section].dims;
      const i = dims.findIndex((d) => d.uid === dimUid);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j >= 0 && j < dims.length) app.change(() => moveNode(space, dimUid, j));
    } else if (sel.type === 'param') {
      const j = found.index + (e.key === 'ArrowLeft' ? -1 : 1);
      if (j >= 0 && j < found.siblings.length) app.change(() => moveNode(space, sel.uid, j));
    }
    return true;
  }
  if (e.altKey) return false;

  // a printable key on a selected ghost cell starts creating the new item
  if (cursor && (sel.type === 'ghost' || sel.type === 'ghostdim') && e.key.length === 1 && e.key !== ' ') {
    e.preventDefault();
    app.startEdit(section, sel, e.key);
    return true;
  }

  switch (e.key) {
    case 'ArrowRight':
      go(r, c + 1);
      return true;
    case 'ArrowLeft':
      go(r, c - 1);
      return true;
    case 'ArrowDown':
      go(r + 1, c);
      return true;
    case 'ArrowUp':
      go(r - 1, c);
      return true;
    case 'Home':
      go(r, 0);
      return true;
    case 'End':
      go(r, rows[r].length - 1);
      return true;
    case 'Tab': {
      const flat = rows.flat();
      const i = flat.findIndex((x) => selKey(x) === selKey(sel)) + (e.shiftKey ? -1 : 1);
      if (i < 0 || i >= flat.length) return false; // leave the grid
      app.setCursor(section, flat[i]);
      return true;
    }
    case 'Enter':
    case 'F2':
      app.startEdit(section, sel);
      return true;
    case 'Delete':
    case 'Backspace':
      deleteAt(app, section, sel, pos);
      return true;
  }

  const key = e.key.toLowerCase();
  if (key === 'm' && !e.shiftKey) {
    if (sel.type === 'dim') moveToOtherSection(app, section, sel, pos);
    else app.toast('Select a dimension (its row title) to move it with M.');
    return true;
  }
  if (section === 'problem' && sel.type === 'param' && (key === 'f' || key === 'x' || /^[0-3]$/.test(key))) {
    const { node } = findNode(space, sel.uid);
    if (key === 'f') app.change(() => cycleStage(node));
    else if (key === 'x') app.change(() => toggleMark(node, 'out'));
    else {
      const n = Number(key);
      app.change(() => setStage(node, n === node.stage ? null : n));
    }
    return true;
  }
  if (section === 'solution' && sel.type === 'param') {
    if (/^[1-9]$/.test(e.key)) {
      const id = Number(e.key);
      if (findOption(space, id)) {
        const { node } = findNode(space, sel.uid);
        app.change(() => togglePick(node, id));
      } else app.toast(`There is no option O${id}.`);
      return true;
    }
    if (e.key === ' ' && state.pickMode && state.activeOption !== null) {
      const { node } = findNode(space, sel.uid);
      app.change(() => togglePick(node, state.activeOption));
      return true;
    }
  }
  return false;
}

export async function deleteAt(app, section, sel, pos) {
  if (sel.type !== 'dim' && sel.type !== 'param') return;
  const found = findNode(app.space, sel.uid);
  if (!found) return;
  const what = sel.type === 'dim' ? `dimension “${found.node.title || 'Untitled'}” and its parameters` : `“${found.node.title || 'Untitled'}”`;
  if (nodeHasContent(found.node)) {
    const ok = await app.confirm(`Delete ${what}?`, 'It has a note or is picked by an option. You can undo this.', 'Delete');
    if (!ok) return;
  }
  app.change(() => removeNode(app.space, sel.uid));
  const [r, c] = pos || [0, 0];
  app.setCursor(section, fixCursor(app.space, section, null, sel.type === 'dim' ? [r, 0] : [r, c]));
}

export const otherSection = (section) => (section === 'problem' ? 'solution' : 'problem');
const SECTION_NAMES = { problem: 'problem space', solution: 'solution space' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Moves the selected dimension to the other grid section, then shows it there.
 * Asks first when marks (to the solution) or picks (to the problem) would be dropped.
 */
export async function moveToOtherSection(app, section, sel, pos) {
  if (sel.type !== 'dim') return;
  const found = findNode(app.space, sel.uid);
  if (!found) return;
  const to = otherSection(section);
  const name = `“${found.node.title || 'Untitled'}”`;
  const { marks, picks } = moveLosses(found.node);
  const lost =
    to === 'solution' && marks
      ? `${plural(marks, 'parameter loses its', 'parameters lose their')} stage or out-of-scope mark, because the solution space has neither.`
      : to === 'problem' && picks
        ? `${plural(picks, 'pick by an option is', 'picks by options are')} removed, because the problem space has no picks. Ratings stay as they are.`
        : '';
  if (lost) {
    const ok = await app.confirm(`Move ${name} to the ${SECTION_NAMES[to]}?`, `${lost} You can undo this.`, 'Move');
    if (!ok) return;
  }
  app.change(() => moveDimensionToSection(app.space, sel.uid, to));
  const [r] = pos || [0, 0];
  app.state.cursor[section] = fixCursor(app.space, section, null, [r, 0]);
  app.state.cursor[to] = { type: 'dim', uid: sel.uid };
  app.setTab(to);
  app.toast(`Moved ${name} to the ${SECTION_NAMES[to]}. ${isMac() ? '⌘Z' : 'Ctrl+Z'} undoes it.`);
}
