// Evaluation tab (§3.4): option profiles (read-only) and the rating matrix.

import { h } from './dom.js';
import {
  addCriterion,
  removeCriterion,
  moveItem,
  findCriterion,
  findOption,
  getRating,
  setRating,
  rankOptions,
  scoreFraction,
  optionProfile,
  clampWeight,
  criterionKey,
} from '../model.js';
import { optionVars, selKey, NAV_KEYS } from './grid.js';
import { swatch } from './options-bar.js';
import { field } from './inspector.js';

// ---------------------------------------------------------------- helpers

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Options in display order: stored order, or by rank (view only). */
export function displayOptions(app) {
  const items = app.space.options.items;
  if (!app.state.evalView.sortByRank) return items;
  const ranks = rankOptions(app.space);
  return items
    .map((o, i) => ({ o, i, r: ranks.get(o.id).rank }))
    .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
    .map((x) => x.o);
}

const ratingSel = (cid, oid) => ({ type: 'rating', uid: `${cid}:${oid}` });
const parseRating = (sel) => sel.uid.split(':').map(Number);

/** Navigable cells of the rating matrix, row by row. */
export function evalLayout(app) {
  const opts = displayOptions(app);
  const rows = app.space.criteria.items.map((c) => [
    { type: 'crit', uid: String(c.id) },
    { type: 'weight', uid: String(c.id) },
    ...opts.map((o) => ratingSel(c.id, o.id)),
  ]);
  rows.push([{ type: 'ghostcrit', uid: '' }]);
  return rows;
}

function scaleValues(scale) {
  const out = [];
  for (let v = scale.min; v <= scale.max; v++) out.push(v);
  return out;
}

function criterionHasContent(space, c) {
  if (c.note) return true;
  const key = criterionKey(c.id);
  return Object.values(space.ratings.cells).some((row) => row[key]);
}

// ---------------------------------------------------------------- render

export function renderEvalHead(app) {
  const v = app.state.evalView;
  const toggle = (key, label, title) =>
    h('button', { class: 'toggle', 'aria-pressed': v[key] ? 'true' : 'false', title, onclick: () => app.setEvalView({ [key]: !v[key] }) }, label);
  return h(
    'div',
    { class: 'eval-bar', role: 'toolbar', 'aria-label': 'Evaluation view' },
    h('span', { class: 'bar-label' }, 'View'),
    toggle('sortByRank', 'Sort options by rank', 'Order the columns by rank. The stored order does not change.'),
    toggle('showNotes', 'Show all notes', 'Show every rating note under its score, for reviews and printing'),
    toggle('heatmap', 'Heatmap', 'Tint scores by value'),
  );
}

function optionHead(app, o, extra) {
  return h(
    'th',
    {
      class: 'opt-head',
      scope: 'col',
      style: optionVars(o.id),
      title: o.note || null,
      dataset: { option: String(o.id) },
    },
    h('button', { class: 'opt-head-btn', onclick: () => app.inspectOption(o.id) }, swatch(o.id, app.state.lineStyles), h('span', { class: 'id' }, 'O' + o.id), h('span', { class: ['opt-title', !o.title && 'empty'] }, o.title || 'Untitled')),
    extra,
  );
}

export function renderProfiles(app, opts) {
  const { space } = app;
  if (!opts.length) {
    return h('p', { class: 'empty-state' }, 'No options yet. Compose options in the Solution tab, then compare them here. ', h('button', { class: 'link', onclick: () => app.setTab('solution') }, 'Go to Solution'));
  }
  if (!space.solution.dims.length) return h('p', { class: 'empty-state' }, 'The solution space is empty.');
  const profiles = new Map(opts.map((o) => [o.id, optionProfile(space, o.id)]));
  const table = h('table', { class: 'eval-table profile-table' });
  table.append(h('thead', null, h('tr', null, h('th', { class: 'sticky corner', scope: 'col' }, 'Dimension'), opts.map((o) => optionHead(app, o)))));
  const body = h('tbody');
  space.solution.dims.forEach((dim, r) => {
    body.append(
      h(
        'tr',
        null,
        h('th', { class: 'sticky row-head', scope: 'row' }, dim.title || 'Untitled dimension'),
        opts.map((o) => {
          const params = profiles.get(o.id)[r].params;
          return h('td', { class: !params.length && 'none' }, params.length ? h('ul', null, params.map((p) => h('li', null, p.title || 'Untitled'))) : '—');
        }),
      ),
    );
  });
  table.append(body);
  return h('div', { class: 'table-scroll' }, table);
}

function renderRatings(app, opts) {
  const { space, state } = app;
  const scale = space.meta.scale;
  const values = scaleValues(scale);
  const segOk = values.length <= 10;
  const ranks = rankOptions(space);
  const cursorKey = selKey(state.cursor.evaluation);
  const editing = state.editing && state.editing.section === 'evaluation' ? state.editing : null;
  const editKey = editing ? selKey(editing.sel) : '';
  const v = state.evalView;
  let focusEl = null;

  let firstStop = !cursorKey; // with no cursor, the first cell is the matrix's tab stop
  const cellAttrs = (sel, cls, label) => {
    const key = selKey(sel);
    const selected = key === cursorKey;
    const stop = selected || firstStop;
    firstStop = false;
    return {
      class: ['ecell', cls, selected && 'selected'],
      tabindex: stop ? '0' : '-1',
      'aria-selected': selected ? 'true' : 'false',
      'aria-label': label,
      dataset: { key, type: sel.type, uid: sel.uid },
    };
  };
  const inlineEdit = (sel, value, placeholder) => {
    if (selKey(sel) !== editKey) return null;
    const ta = h('textarea', { class: 'inline-edit', rows: '1', 'aria-label': 'Criterion title', value: editing.initial ?? value, placeholder });
    focusEl = ta;
    return ta;
  };

  const table = h('table', { class: 'eval-table rating-table cursor-root', dataset: { section: 'evaluation' }, role: 'grid', 'aria-label': 'Rating matrix' });
  table.append(
    h(
      'thead',
      null,
      h('tr', null, h('th', { class: 'sticky corner crit-col', scope: 'col' }, 'Criterion'), h('th', { class: 'sticky weight-col', scope: 'col', title: 'Weight 0–10. 0 leaves a criterion out of the total.' }, 'Weight'), opts.map((o) => optionHead(app, o))),
    ),
  );

  const body = h('tbody');
  space.criteria.items.forEach((c) => {
    const tr = h('tr', { dataset: { crit: String(c.id) } });
    const critSel = { type: 'crit', uid: String(c.id) };
    const editor = inlineEdit(critSel, c.title, 'Criterion');
    tr.append(
      h(
        'th',
        { ...cellAttrs(critSel, ['sticky', 'crit-col', 'crit', c.note && 'has-note'], `C${c.id} ${c.title}`), scope: 'row', draggable: editor ? null : 'true' },
        c.note ? h('span', { class: 'fold', 'aria-hidden': 'true' }) : null,
        h('span', { class: 'id' }, 'C' + c.id),
        editor || h('span', { class: ['crit-title', !c.title && 'empty'] }, c.title || 'Untitled criterion'),
      ),
    );
    const wSel = { type: 'weight', uid: String(c.id) };
    tr.append(
      h(
        'td',
        { ...cellAttrs(wSel, ['sticky', 'weight-col', 'weight', c.weight === 0 && 'zero'], `Weight of C${c.id}: ${c.weight}`) },
        h('button', { class: 'step', tabindex: '-1', 'aria-label': 'Decrease weight', dataset: { step: '-1' } }, '−'),
        h('span', { class: 'w-val' }, String(c.weight)),
        h('button', { class: 'step', tabindex: '-1', 'aria-label': 'Increase weight', dataset: { step: '1' } }, '+'),
      ),
    );
    for (const o of opts) {
      const r = getRating(space, o.id, c.id);
      const score = r ? r.score : null;
      const note = r ? r.note : '';
      const sel = ratingSel(c.id, o.id);
      const style = { ...optionVars(o.id) };
      if (v.heatmap && score !== null) style['--heat'] = Math.round(6 + 22 * scoreFraction(score, scale)) + '%';
      tr.append(
        h(
          'td',
          {
            ...cellAttrs(sel, ['rating', note && 'has-note', v.heatmap && score !== null && 'heat'], `O${o.id} × C${c.id}: ${score === null ? 'unrated' : score}${note ? ', has note' : ''}`),
            style,
          },
          note ? h('span', { class: 'fold', 'aria-hidden': 'true' }) : null,
          h('span', { class: ['score', score === null && 'empty'] }, score === null ? '·' : String(score)),
          v.showNotes && note ? h('div', { class: 'cell-note' }, note) : null,
          segOk
            ? h(
                'div',
                { class: 'seg', 'aria-hidden': 'true' },
                values.map((val) => h('button', { class: ['seg-btn', val === score && 'on'], tabindex: '-1', dataset: { score: String(val) } }, String(val))),
              )
            : null,
        ),
      );
    }
    body.append(tr);
  });
  const gSel = { type: 'ghostcrit', uid: '' };
  const gEditor = inlineEdit(gSel, '', 'New criterion');
  body.append(
    h(
      'tr',
      { class: 'ghost-row' },
      h('th', { ...cellAttrs(gSel, ['sticky', 'crit-col', 'ghost']), scope: 'row', colspan: '2' }, gEditor || h('span', { class: 'crit-title empty' }, '+ Criterion')),
      opts.length ? h('td', { colspan: String(opts.length), class: 'filler' }) : null,
    ),
  );
  table.append(body);

  // footer: weighted score, unrated, rank
  const foot = h('tfoot');
  const topRank = (id) => ranks.get(id).rank === 1;
  foot.append(
    h(
      'tr',
      { class: 'total-row' },
      h('th', { class: 'sticky crit-col', scope: 'row', colspan: '2' }, 'Weighted score'),
      opts.map((o) => {
        const r = ranks.get(o.id);
        return h(
          'td',
          { class: ['total', topRank(o.id) && 'top'], style: optionVars(o.id) },
          h('span', { class: 'total-val' }, r.display === null ? '–' : r.display.toFixed(1)),
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { width: (scoreFraction(r.score, scale) * 100).toFixed(1) + '%' } })),
        );
      }),
    ),
    h(
      'tr',
      { class: 'unrated-row' },
      h('th', { class: 'sticky crit-col', scope: 'row', colspan: '2' }, 'Unrated'),
      opts.map((o) => {
        const n = ranks.get(o.id).unrated;
        return h('td', { class: n ? null : 'zero' }, String(n));
      }),
    ),
    h(
      'tr',
      { class: 'rank-row' },
      h('th', { class: 'sticky crit-col', scope: 'row', colspan: '2' }, 'Rank'),
      opts.map((o) => {
        const r = ranks.get(o.id).rank;
        return h('td', null, r === null ? '–' : r === 1 ? h('span', { class: 'badge' }, '1st') : ordinal(r));
      }),
    ),
  );
  table.append(foot);
  wireRatings(app, table);
  if (!focusEl && cursorKey) focusEl = table.querySelector(`[data-key="${CSS.escape(cursorKey)}"]`);
  return { el: h('div', { class: 'table-scroll' }, table), focusEl };
}

/** Renders the Evaluation tab body. Returns { el, focusEl }. */
export function renderEvaluation(app) {
  const opts = displayOptions(app);
  const { el: ratings, focusEl } = renderRatings(app, opts);
  const hint = !app.space.criteria.items.length
    ? h('p', { class: 'empty-state' }, 'Add the criteria that describe what a great solution looks like, then rate each option against them.')
    : null;
  const el = h(
    'div',
    { class: 'eval' },
    h('section', { class: 'eval-section' }, h('h2', { class: 'section-title' }, 'Option profiles'), renderProfiles(app, opts)),
    h('section', { class: 'eval-section' }, h('h2', { class: 'section-title' }, 'Ratings'), hint, ratings),
  );
  return { el, focusEl };
}

// ---------------------------------------------------------------- actions

function setScore(app, cid, oid, score) {
  app.change(() => setRating(app.space, oid, cid, { score }));
}

function stepScore(app, cid, oid, dir) {
  const { scale } = app.space.meta;
  const r = getRating(app.space, oid, cid);
  const cur = r ? r.score : null;
  let next;
  if (cur === null) next = dir > 0 ? scale.min : null;
  else next = Math.max(scale.min, Math.min(scale.max, cur + dir));
  if (next !== cur) setScore(app, cid, oid, next);
}

function setWeight(app, c, w) {
  const weight = clampWeight(w);
  if (weight !== c.weight) app.change(() => (c.weight = weight));
}

export async function deleteCriterion(app, c) {
  if (criterionHasContent(app.space, c)) {
    const ok = await app.confirm(`Delete C${c.id} ${c.title}?`, 'It has a note or ratings, which are removed too. You can undo this.', 'Delete criterion');
    if (!ok) return;
  }
  const rows = evalLayout(app);
  const r = rows.findIndex((row) => row[0].uid === String(c.id));
  app.change(() => removeCriterion(app.space, c.id));
  const after = evalLayout(app);
  app.setCursor('evaluation', after[Math.min(r, after.length - 1)][0]);
}

function moveCriterion(app, c, dir) {
  const items = app.space.criteria.items;
  const i = items.indexOf(c);
  const j = i + dir;
  if (j >= 0 && j < items.length) app.change(() => moveItem(items, i, j));
}

export function finishEvalEdit(app, sel, title) {
  const { space } = app;
  if (sel.type === 'crit') {
    const c = findCriterion(space, Number(sel.uid));
    if (c && c.title !== title) app.change(() => (c.title = title));
    else app.render();
  } else if (sel.type === 'ghostcrit') {
    if (title) app.change(() => addCriterion(space, title));
    else app.render();
  } else app.render();
}

// ---------------------------------------------------------------- mouse

let dragCrit = null;

function wireRatings(app, table) {
  table.addEventListener('click', (e) => {
    const cell = e.target.closest('.ecell');
    if (!cell || e.target.closest('.inline-edit')) return;
    const sel = { type: cell.dataset.type, uid: cell.dataset.uid };
    const seg = e.target.closest('.seg-btn');
    const step = e.target.closest('.step');
    if (seg && sel.type === 'rating') {
      const [cid, oid] = parseRating(sel);
      const r = getRating(app.space, oid, cid);
      const val = Number(seg.dataset.score);
      app.setCursor('evaluation', sel, { render: false });
      if (!r || r.score !== val) setScore(app, cid, oid, val);
      else app.render();
      return;
    }
    if (step && sel.type === 'weight') {
      const c = findCriterion(app.space, Number(sel.uid));
      app.setCursor('evaluation', sel, { render: false });
      setWeight(app, c, c.weight + Number(step.dataset.step));
      return;
    }
    app.setCursor('evaluation', sel);
    if (sel.type === 'ghostcrit') app.startEdit('evaluation', sel);
  });
  table.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.ecell');
    if (!cell || e.target !== cell) return;
    const sel = { type: cell.dataset.type, uid: cell.dataset.uid };
    if (selKey(sel) !== selKey(app.state.cursor.evaluation)) app.setCursor('evaluation', sel);
  });
  table.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.ecell');
    if (!cell || e.target.closest('.inline-edit, .seg, .step')) return;
    const sel = { type: cell.dataset.type, uid: cell.dataset.uid };
    if (sel.type === 'crit') app.startEdit('evaluation', sel);
    else if (sel.type === 'rating') app.focusInspectorField('inspector-note');
  });

  // note tooltips
  table.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.ecell.has-note');
    if (!cell) return;
    let note = '';
    if (cell.dataset.type === 'crit') note = (findCriterion(app.space, Number(cell.dataset.uid)) || {}).note;
    else if (cell.dataset.type === 'rating') {
      const [cid, oid] = cell.dataset.uid.split(':').map(Number);
      note = (getRating(app.space, oid, cid) || {}).note;
    }
    if (note && !app.state.evalView.showNotes) app.tooltip.show(cell, note);
  });
  table.addEventListener('mouseout', (e) => {
    const cell = e.target.closest('.ecell.has-note');
    if (cell && !cell.contains(e.relatedTarget)) app.tooltip.hide();
  });

  // inline editor for criterion titles
  table.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('inline-edit')) return;
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.shiftKey) app.finishEdit(e.target.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      app.finishEdit(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      app.finishEdit(e.target.value, { advance: e.shiftKey ? -1 : 1 });
    }
  });
  table.addEventListener('input', (e) => {
    if (e.target.classList.contains('inline-edit')) {
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
    }
  });
  table.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('inline-edit')) app.finishEdit(e.target.value, { fromBlur: true });
  });

  // drag criteria rows to reorder
  const clear = () => {
    for (const el of table.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
  };
  table.addEventListener('dragstart', (e) => {
    const cell = e.target.closest('.ecell.crit');
    if (!cell) return;
    dragCrit = Number(cell.dataset.uid);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cell.textContent);
    app.tooltip.hide();
  });
  table.addEventListener('dragover', (e) => {
    if (dragCrit === null) return;
    const tr = e.target.closest('tr[data-crit]');
    clear();
    if (!tr) return;
    e.preventDefault();
    const r = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  table.addEventListener('drop', (e) => {
    const tr = e.target.closest('tr[data-crit]');
    const id = dragCrit;
    dragCrit = null;
    clear();
    if (id === null || !tr) return;
    e.preventDefault();
    const items = app.space.criteria.items;
    const from = items.findIndex((c) => c.id === id);
    const r = tr.getBoundingClientRect();
    let to = items.findIndex((c) => c.id === Number(tr.dataset.crit)) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    if (from < to) to -= 1;
    if (from !== to) app.change(() => moveItem(items, from, to));
  });
  table.addEventListener('dragend', () => {
    dragCrit = null;
    clear();
  });
}

// ---------------------------------------------------------------- keyboard

let lastDigit = { key: '', digit: '', time: 0 };

/** Two quick digits on the same cell combine ("1", "0" -> 10) when the result is valid. */
function digitValue(key, digit, isValid) {
  const now = Date.now();
  let value = Number(digit);
  if (lastDigit.key === key && now - lastDigit.time < 900) {
    const combined = Number(lastDigit.digit + digit);
    if (isValid(combined)) value = combined;
  }
  lastDigit = { key, digit: String(value), time: now };
  return value;
}

export function evaluationKeydown(app, e) {
  const { space } = app;
  const rows = evalLayout(app);
  const cur = app.state.cursor.evaluation;
  const key = selKey(cur);
  let r = 0;
  let c = 0;
  rows.forEach((row, ri) =>
    row.forEach((x, ci) => {
      if (selKey(x) === key) {
        r = ri;
        c = ci;
      }
    }),
  );
  const sel = rows[r][c];
  const go = (nr, nc) => {
    const rr = Math.max(0, Math.min(nr, rows.length - 1));
    const cc = Math.max(0, Math.min(nc, rows[rr].length - 1));
    app.setCursor('evaluation', rows[rr][cc]);
  };
  if (e.ctrlKey || e.metaKey) return false;
  if (!cur) {
    if (!NAV_KEYS.includes(e.key) || e.altKey || (e.key === 'Tab' && e.shiftKey)) return false;
    app.setCursor('evaluation', rows[0][0]);
    return true;
  }
  const crit = sel.type === 'ghostcrit' ? null : findCriterion(space, Number(sel.uid.split(':')[0]));

  if (e.altKey) {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && crit) {
      moveCriterion(app, crit, e.key === 'ArrowUp' ? -1 : 1);
      return true;
    }
    return false;
  }
  if (cur && sel.type === 'ghostcrit' && e.key.length === 1 && e.key !== ' ') {
    app.startEdit('evaluation', sel, e.key);
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
      if (i < 0 || i >= flat.length) return false;
      app.setCursor('evaluation', flat[i]);
      return true;
    }
    case 'Enter':
    case 'F2':
      if (sel.type === 'crit' || sel.type === 'ghostcrit') app.startEdit('evaluation', sel);
      else if (sel.type === 'rating') app.focusInspectorField('inspector-note');
      else if (sel.type === 'weight') app.focusInspectorField('inspector-weight');
      return true;
    case 'Delete':
    case 'Backspace':
      if (sel.type === 'crit') deleteCriterion(app, crit);
      else if (sel.type === 'rating') {
        const [cid, oid] = parseRating(sel);
        const rt = getRating(space, oid, cid);
        if (rt && rt.score !== null) setScore(app, cid, oid, null);
      } else if (sel.type === 'weight') setWeight(app, crit, 1);
      return true;
  }
  if (/^[0-9]$/.test(e.key)) {
    if (sel.type === 'rating') {
      const [cid, oid] = parseRating(sel);
      const { min, max } = space.meta.scale;
      const val = digitValue(key, e.key, (v) => v >= min && v <= max);
      if (val < min || val > max) app.toast(`Scores run from ${min} to ${max}.`);
      else setScore(app, cid, oid, val);
      return true;
    }
    if (sel.type === 'weight') {
      setWeight(app, crit, digitValue(key, e.key, (v) => v <= 10));
      return true;
    }
  }
  if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
    const dir = e.key === '+' || e.key === '=' ? 1 : -1;
    if (sel.type === 'rating') {
      const [cid, oid] = parseRating(sel);
      stepScore(app, cid, oid, dir);
      return true;
    }
    if (sel.type === 'weight') {
      setWeight(app, crit, crit.weight + dir);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- inspector

/** What the inspector shows on the Evaluation tab, or null for the default. */
export function evaluationInspected(app) {
  const cur = app.state.cursor.evaluation;
  if (!cur) return null;
  if (cur.type === 'crit' || cur.type === 'weight') {
    const c = findCriterion(app.space, Number(cur.uid));
    return c ? { kind: 'criterion', criterion: c, key: c.uid } : null;
  }
  if (cur.type === 'rating') {
    const [cid, oid] = parseRating(cur);
    const c = findCriterion(app.space, cid);
    const o = findOption(app.space, oid);
    return c && o ? { kind: 'rating', criterion: c, option: o, key: c.uid + ':' + o.uid } : null;
  }
  return null;
}

function inspHead(kind, ref) {
  return h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, kind), ref ? h('span', { class: 'insp-ref' }, ref) : null);
}

function weightInput(app, c) {
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', for: 'inspector-weight' }, 'Weight (0–10; 0 leaves it out of the total)'),
    h('input', {
      type: 'number',
      id: 'inspector-weight',
      class: 'field-input num',
      min: '0',
      max: '10',
      step: '1',
      value: String(c.weight),
      onchange: (e) => setWeight(app, c, Number(e.target.value)),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
      },
    }),
  );
}

export function criterionInspector(app, { criterion: c }) {
  return [
    inspHead('Criterion', 'C' + c.id),
    field(app, { label: 'Title', value: c.title, id: 'inspector-title', cls: 'title-input', onInput: (v) => (c.title = v), onCommit: (v) => (c.title = v.replace(/\s+/g, ' ').trim()) }),
    field(app, { label: 'What does great look like?', value: c.note, multiline: true, placeholder: 'Describe what a top score means for this criterion.', onInput: (v) => (c.note = v) }),
    weightInput(app, c),
    h('div', { class: 'insp-actions' }, h('button', { class: 'btn danger-quiet', onclick: () => deleteCriterion(app, c) }, 'Delete criterion')),
  ];
}

export function ratingInspector(app, { criterion: c, option: o }) {
  const { space } = app;
  const scale = space.meta.scale;
  const r = getRating(space, o.id, c.id);
  const score = r ? r.score : null;
  const values = scaleValues(scale);
  const scoreControl =
    values.length <= 11
      ? h(
          'div',
          { class: 'segmented score-seg', role: 'radiogroup', 'aria-label': 'Score' },
          values.map((v) =>
            h('button', { class: ['toggle', 'seg-choice'], role: 'radio', 'aria-checked': v === score ? 'true' : 'false', 'aria-pressed': v === score ? 'true' : 'false', onclick: () => setScore(app, c.id, o.id, v === score ? null : v) }, String(v)),
          ),
          h('button', { class: ['toggle', 'seg-choice', 'unrated'], role: 'radio', 'aria-checked': score === null ? 'true' : 'false', 'aria-pressed': score === null ? 'true' : 'false', onclick: () => setScore(app, c.id, o.id, null) }, 'Unrated'),
        )
      : h('input', { type: 'number', class: 'field-input num', min: String(scale.min), max: String(scale.max), value: score === null ? '' : String(score), 'aria-label': 'Score', onchange: (e) => setScore(app, c.id, o.id, e.target.value === '' ? null : Number(e.target.value)) });
  return [
    inspHead('Rating', `O${o.id} × C${c.id}`),
    h(
      'dl',
      { class: 'profile rating-ref' },
      h('dt', null, 'Option'),
      h('dd', { class: 'option-ref' }, swatch(o.id, app.state.lineStyles), h('span', null, `O${o.id} ${o.title || 'Untitled'}`)),
      h('dt', null, 'Criterion'),
      h('dd', null, `C${c.id} ${c.title || 'Untitled'}`, h('span', { class: 'muted' }, ` · weight ${c.weight}`)),
      c.note ? h('dt', null, 'Great means') : null,
      c.note ? h('dd', { class: 'muted pre' }, c.note) : null,
    ),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, `Score (${scale.min}–${scale.max})`), scoreControl),
    field(app, {
      label: 'Rationale or assumption',
      value: r ? r.note : '',
      multiline: true,
      rows: 4,
      id: 'inspector-note',
      placeholder: 'Why this score? What are we assuming?',
      onInput: (v) => setRating(space, o.id, c.id, { note: v }),
    }),
  ];
}
