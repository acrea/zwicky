// zwicky. application shell: state, rendering, actions, dialogs, keyboard.

import { h, clear, isTextInput, isMac } from './dom.js';
import { parse, serialize, fileName as defaultFileName } from '../format.js';
import { createSpace, findOption, findNode, cleanTitle, addParameter, addDimension } from '../model.js';
import { createHistory } from '../history.js';
import * as store from '../store.js';
import { renderGrid, gridKeydown, fixCursor, gridLayout, selKey, deleteAt, moveToOtherSection } from './grid.js';
import { drawPaths, watchPaths } from './paths.js';
import { renderOptionsBar } from './options-bar.js';
import { renderInspector, inspectedKey, field } from './inspector.js';
import { SHORTCUTS } from './shortcuts.js';
import { preparePrint, cleanupPrint } from './print.js';
import {
  renderEvaluation,
  renderEvalHead,
  evaluationKeydown,
  evaluationInspected,
  evalLayout,
  finishEvalEdit,
  criterionInspector,
  ratingInspector,
} from './evaluation.js';
import { EXAMPLES } from '../examples.js';
import { FORMAT_DOC } from '../format-doc.js';
import { APP_VERSION } from '../version.js';

// The version comes from the VERSION file at the repository root (see build.mjs).
const DENSITIES = ['compact', 'normal', 'roomy'];
const TABS = [
  ['problem', 'Problem'],
  ['solution', 'Solution'],
  ['evaluation', 'Evaluation'],
];
const MOD = isMac() ? '⌘' : 'Ctrl';

// ---------------------------------------------------------------- state

const prefs = store.loadPrefs();

const app = {
  space: createSpace(),
  history: createHistory(),
  state: {
    tab: prefs.tab && TABS.some(([k]) => k === prefs.tab) ? prefs.tab : 'problem',
    cursor: { problem: null, solution: null, evaluation: null },
    inspect: { problem: null, solution: null, evaluation: null },
    editing: null, // { section, sel, initial }
    activeOption: null,
    pickMode: false,
    compare: !!prefs.compare,
    lineStyles: !!prefs.lineStyles,
    evalView: { sortByRank: false, showNotes: false, heatmap: false, ...(prefs.evalView || {}) },
    inspectorOpen: prefs.inspectorOpen !== false,
    density: DENSITIES.includes(prefs.density) ? prefs.density : 'normal',
    coords: prefs.coords !== false,
    dirty: false,
    handle: null,
    fileName: '',
    scroll: {},
  },
  inspectorExtensions: { criterion: criterionInspector, rating: ratingInspector },
  evaluationInspected,
};

const els = {};

// ---------------------------------------------------------------- persistence

const autosave = store.debounce(() => {
  store.writeAutosave(serialize(app.space), app.state.fileName, app.state.dirty);
}, 400);

function savePrefs() {
  const { tab, compare, lineStyles, inspectorOpen, density, coords, evalView } = app.state;
  store.savePrefs({ tab, compare, lineStyles, inspectorOpen, density, coords, evalView });
}

app.markDirty = () => {
  app.state.dirty = true;
  autosave();
  renderStatus();
};

// ---------------------------------------------------------------- changes

/** Records an undo step, applies `fn`, marks the document dirty and re-renders. */
app.change = (fn) => {
  app.history.record(app.space);
  const result = fn();
  app.markDirty();
  app.render();
  return result;
};

function afterRestore() {
  const { state, space } = app;
  for (const sec of ['problem', 'solution']) {
    if (state.cursor[sec]) state.cursor[sec] = fixCursor(space, sec, state.cursor[sec]);
  }
  if (state.cursor.evaluation && !evalLayout(app).flat().some((x) => selKey(x) === selKey(state.cursor.evaluation))) state.cursor.evaluation = null;
  if (state.activeOption !== null && !findOption(space, state.activeOption)) {
    state.activeOption = null;
    state.pickMode = false;
  }
  state.editing = null;
  app.markDirty();
  app.render();
}

app.undo = () => {
  const prev = app.history.undo(app.space);
  if (!prev) return;
  app.space = prev;
  afterRestore();
};

app.redo = () => {
  const next = app.history.redo(app.space);
  if (!next) return;
  app.space = next;
  afterRestore();
};

// ---------------------------------------------------------------- selection

app.setCursor = (section, sel, { render = true } = {}) => {
  app.state.cursor[section] = sel;
  if (app.state.inspect[section] && app.state.inspect[section].type === 'option') app.state.inspect[section] = null;
  app.tooltip.hide();
  if (!render) return;
  // fast path: a cursor move only changes classes, no need to rebuild the grid
  if (section === app.state.tab && !app.state.editing && moveCursorInPlace(section, sel)) renderInspectorPanel();
  else app.render();
};

function moveCursorInPlace(section, sel) {
  const canvas = els.body.querySelector(`.cursor-root[data-section="${section}"]`);
  if (!canvas) return false;
  const next = sel ? canvas.querySelector(`[data-key="${CSS.escape(selKey(sel))}"]`) : null;
  if (sel && !next) return false;
  const active = document.activeElement;
  const hadFocus = active === document.body || active === null || els.body.contains(active);
  for (const el of canvas.querySelectorAll('.selected, [tabindex="0"]')) {
    el.classList.remove('selected');
    el.tabIndex = -1;
    el.setAttribute('aria-selected', 'false');
  }
  if (next) {
    next.classList.add('selected');
    next.tabIndex = 0;
    next.setAttribute('aria-selected', 'true');
    if (hadFocus) next.focus({ preventScroll: true });
    ensureVisible(next.closest('.grid-scroll'), next);
  }
  return true;
}

app.inspectOption = (id, { focusTitle = false } = {}) => {
  const tab = app.state.tab === 'problem' ? 'solution' : app.state.tab;
  app.state.inspect[tab] = id === null ? null : { type: 'option', id };
  if (focusTitle) {
    app.state.inspectorOpen = true;
    savePrefs();
  }
  app.render();
  if (focusTitle) {
    const input = document.getElementById('inspector-title');
    if (input) {
      input.focus();
      input.select();
    }
  }
};

app.activateOption = (id, pick = false) => {
  app.state.activeOption = id;
  app.state.pickMode = id !== null && pick;
  app.render();
};

/** Chip click: activate + pick mode; on the active option toggles pick mode. */
app.chipClick = (id) => {
  const { state } = app;
  if (state.activeOption === id) state.pickMode = !state.pickMode;
  else {
    state.activeOption = id;
    state.pickMode = true;
  }
  state.inspect.solution = { type: 'option', id };
  app.render();
};

app.setEvalView = (patch) => {
  Object.assign(app.state.evalView, patch);
  savePrefs();
  app.render();
};

/** Opens the inspector and focuses one of its fields (e.g. the rating note). */
app.focusInspectorField = (id) => {
  if (!app.state.inspectorOpen) {
    app.state.inspectorOpen = true;
    savePrefs();
    applyRootAttributes();
  }
  app.render();
  const el = document.getElementById(id);
  if (el) {
    el.focus();
    if (el.select && el.tagName === 'INPUT') el.select();
  }
};

app.setView = (patch) => {
  Object.assign(app.state, patch);
  savePrefs();
  applyRootAttributes();
  app.render();
};

function cursorPos(section, sel) {
  let pos = null;
  gridLayout(app.space, section).forEach((row, r) => row.forEach((x, c) => selKey(x) === selKey(sel) && (pos = [r, c])));
  return pos;
}

app.deleteCursor = (section) => {
  const sel = app.state.cursor[section];
  if (sel) deleteAt(app, section, sel, cursorPos(section, sel));
};

app.moveCursorDimension = (section) => {
  const sel = app.state.cursor[section];
  if (sel) moveToOtherSection(app, section, sel, cursorPos(section, sel));
};

// ---------------------------------------------------------------- inline editing

app.startEdit = (section, sel, initial = null) => {
  app.state.cursor[section] = sel;
  app.state.editing = { section, sel, initial };
  app.tooltip.hide();
  app.render();
};

app.finishEdit = (value, { advance = 0, fromBlur = false } = {}) => {
  const ed = app.state.editing;
  if (!ed) return;
  app.state.editing = null;
  const { section, sel } = ed;
  const space = app.space;
  if (value === null) return app.render();
  const title = cleanTitle(value);
  if (section === 'evaluation') finishEvalEdit(app, sel, title);
  else if (sel.type === 'dim' || sel.type === 'param') {
    const found = findNode(space, sel.uid);
    if (found && found.node.title !== title) app.change(() => (found.node.title = title));
    else app.render();
  } else if (sel.type === 'ghost') {
    if (title) app.change(() => addParameter(space, sel.uid, Infinity, title));
    else app.render();
  } else if (sel.type === 'ghostdim') {
    if (title) {
      const d = app.change(() => addDimension(space, section, Infinity, title));
      app.state.cursor[section] = { type: 'ghost', uid: d.uid };
      app.render();
    } else app.render();
  }
  if (advance && !fromBlur) {
    const flat = (section === 'evaluation' ? evalLayout(app) : gridLayout(space, section)).flat();
    const i = flat.findIndex((x) => selKey(x) === selKey(app.state.cursor[section]));
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + advance))];
    if (next) app.setCursor(section, next);
  }
};

// ---------------------------------------------------------------- rendering

let renderFrame = 0;
let renderFlags = null;
app.renderSoon = ({ inspector = true } = {}) => {
  renderFlags = { inspector: (renderFlags && renderFlags.inspector) || inspector };
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    const f = renderFlags;
    renderFlags = null;
    renderTop();
    renderMain();
    if (f.inspector) renderInspectorPanel();
  });
};

app.render = () => {
  cancelAnimationFrame(renderFrame);
  renderFlags = null;
  renderTop();
  renderMain();
  renderInspectorPanel();
};

function applyRootAttributes() {
  const root = document.documentElement;
  root.dataset.density = app.state.density;
  root.dataset.coords = app.state.coords ? 'on' : 'off';
  els.app.classList.toggle('inspector-closed', !app.state.inspectorOpen);
}

function buildShell() {
  els.app = h('div', { id: 'zwicky', class: 'app' });
  els.top = h('header', { class: 'topbar' });
  els.main = h('main', { class: 'main', id: 'main' });
  els.head = h('div', { class: 'tab-head' });
  els.body = h('div', { class: 'tab-body' });
  els.main.append(els.head, els.body);
  els.inspector = h('aside', { class: 'inspector', 'aria-label': 'Inspector' });
  els.app.append(els.top, els.main, els.inspector);
  els.tooltip = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
  els.toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  document.body.append(els.app, els.tooltip, els.toast);

  // top bar: built once, parts updated by renderTop
  els.title = h('input', {
    class: 'doc-title',
    type: 'text',
    'aria-label': 'Document title',
    placeholder: 'Untitled',
    spellcheck: 'true',
  });
  els.title.addEventListener('focus', () => app.history.beginEdit(app.space));
  els.title.addEventListener('input', () => {
    app.history.touch();
    app.space.meta.title = els.title.value;
    app.markDirty();
    app.renderSoon();
  });
  els.title.addEventListener('blur', () => {
    app.history.endEdit();
    app.space.meta.title = els.title.value.replace(/\s+/g, ' ').trim();
    app.renderSoon();
  });
  els.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      els.title.blur();
    }
  });

  els.tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' });
  for (const [key, label] of TABS) {
    els.tabs.append(
      h('button', { class: 'tab', role: 'tab', id: 'tab-' + key, 'aria-controls': 'main', dataset: { tab: key }, onclick: () => app.setTab(key) }, label),
    );
  }
  els.tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex(([k]) => k === app.state.tab) + (e.key === 'ArrowLeft' ? -1 : 1);
    const [k] = TABS[(i + TABS.length) % TABS.length];
    app.setTab(k);
    els.tabs.querySelector(`[data-tab="${k}"]`).focus();
  });

  els.status = h('span', { class: 'status', title: 'Changes are kept in this browser’s cache. That is a convenience, not a backup: save to a file.' });
  els.undo = h('button', { class: 'icon-btn', title: `Undo (${MOD}+Z)`, 'aria-label': 'Undo', onclick: () => app.undo() }, '↶');
  els.redo = h('button', { class: 'icon-btn', title: `Redo (${MOD}+Shift+Z)`, 'aria-label': 'Redo', onclick: () => app.redo() }, '↷');

  const fileMenu = menu('File', () => [
    { label: 'New', action: () => app.newSpace() },
    { label: 'Open …', shortcut: `${MOD}+O`, action: () => app.open() },
    { label: 'Import from text …', action: () => app.importText() },
    'sep',
    { label: 'Save', shortcut: `${MOD}+S`, action: () => app.save(false) },
    { label: 'Save as …', shortcut: `${MOD}+Shift+S`, action: () => app.save(true) },
    { label: 'Copy as Markdown', action: () => app.copyMarkdown() },
    'sep',
    { label: 'Print / PDF …', action: () => window.print() },
  ]);
  const viewMenu = menu('View', () => [
    { heading: 'Density' },
    ...DENSITIES.map((d) => ({ label: d[0].toUpperCase() + d.slice(1), checked: app.state.density === d, radio: true, action: () => app.setView({ density: d }) })),
    'sep',
    { label: 'Coordinates', checked: app.state.coords, action: () => app.setView({ coords: !app.state.coords }) },
    { label: 'Inspector', shortcut: 'I', checked: app.state.inspectorOpen, action: () => app.toggleInspector() },
  ]);

  els.top.append(
    h('div', { class: 'wordmark', 'aria-label': 'zwicky.' }, 'zwicky', h('span', { class: 'dot' }, '.')),
    els.title,
    els.tabs,
    h('div', { class: 'spacer' }),
    els.status,
    fileMenu,
    h('div', { class: 'btn-group' }, els.undo, els.redo),
    viewMenu,
    h('button', { class: 'icon-btn', title: 'Help (?)', 'aria-label': 'Help', onclick: () => app.help() }, '?'),
    (els.inspectorToggle = h('button', { class: 'icon-btn inspector-toggle', title: 'Inspector (I)', 'aria-label': 'Toggle inspector', onclick: () => app.toggleInspector() }, '▤')),
  );
}

function renderTop() {
  const { state, space } = app;
  if (document.activeElement !== els.title) els.title.value = space.meta.title;
  for (const b of els.tabs.querySelectorAll('.tab')) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
  els.undo.disabled = !app.history.canUndo;
  els.redo.disabled = !app.history.canRedo;
  els.inspectorToggle.setAttribute('aria-pressed', state.inspectorOpen ? 'true' : 'false');
  renderStatus();
  document.title = (space.meta.title || 'Untitled') + ' · zwicky.';
}

function renderStatus() {
  if (!els.status) return;
  const { dirty, fileName } = app.state;
  els.status.textContent = dirty ? 'Unsaved changes' : fileName ? 'Saved' : '';
  els.status.classList.toggle('dirty', dirty);
}

let unwatchPaths = null;

function renderMain() {
  const { state } = app;
  const tab = state.tab;
  const active = document.activeElement;
  const focusInHead = els.head.contains(active) && isTextInput(active);
  const gridHadFocus = active === document.body || active === null || els.body.contains(active);

  // remember scroll per tab
  const oldScroll = els.body.querySelector('.grid-scroll');
  if (oldScroll) state.scroll[oldScroll.dataset.tab] = [oldScroll.scrollLeft, oldScroll.scrollTop];

  if (!focusInHead) {
    clear(els.head);
    els.head.dataset.tab = tab;
    if (tab === 'problem') els.head.append(noteBand(app.space.problem, 'Problem statement', 'What problem are we solving? Write the problem statement here.', 'band'));
    if (tab === 'solution') {
      els.head.append(noteBand(app.space.solution, 'Solution intro', 'Optional intro note for the solution space.', 'intro'));
      els.head.append(renderOptionsBar(app));
    }
    if (tab === 'evaluation') els.head.append(renderEvalHead(app));
  }

  if (unwatchPaths) unwatchPaths();
  unwatchPaths = null;
  clear(els.body);
  els.body.dataset.tab = tab;

  if (tab === 'problem' || tab === 'solution') {
    if (state.editing && state.editing.section !== tab) state.editing = null;
    const { el, focusEl } = renderGrid(app, tab);
    const scroller = h('div', { class: 'grid-scroll', dataset: { tab } }, el);
    els.body.append(scroller);
    const [sl, st] = state.scroll[tab] || [0, 0];
    scroller.scrollLeft = sl;
    scroller.scrollTop = st;
    if (tab === 'solution') {
      drawPaths(app, el);
      unwatchPaths = watchPaths(app, el);
    }
    if (focusEl && (gridHadFocus || focusEl.tagName === 'TEXTAREA')) {
      focusEl.focus({ preventScroll: true });
      if (focusEl.tagName === 'TEXTAREA') {
        const n = focusEl.value.length;
        focusEl.setSelectionRange(n, n);
        focusEl.style.height = focusEl.scrollHeight + 'px';
      }
      ensureVisible(scroller, focusEl.closest('.cell'));
    }
  } else {
    if (state.editing && state.editing.section !== tab) state.editing = null;
    const { el, focusEl } = renderEvaluation(app);
    const scroller = h('div', { class: 'grid-scroll eval-scroll', dataset: { tab } }, el);
    els.body.append(scroller);
    const [sl, st] = state.scroll[tab] || [0, 0];
    scroller.scrollLeft = sl;
    scroller.scrollTop = st;
    if (focusEl && (gridHadFocus || focusEl.tagName === 'TEXTAREA')) {
      focusEl.focus({ preventScroll: true });
      if (focusEl.tagName === 'TEXTAREA') {
        const n = focusEl.value.length;
        focusEl.setSelectionRange(n, n);
        focusEl.style.height = focusEl.scrollHeight + 'px';
      }
      ensureVisible(scroller, focusEl.closest('.ecell'));
    }
  }
}

function noteBand(target, label, placeholder, kind) {
  return h(
    'div',
    { class: ['note-band', kind] },
    kind === 'band' ? h('span', { class: 'band-arrow', 'aria-hidden': 'true' }, '↣') : null,
    field(app, { label, value: target.note, multiline: true, placeholder, onInput: (v) => (target.note = v), cls: 'band-input', wrapClass: 'band-field', rows: 1 }),
  );
}

function ensureVisible(scroller, cell) {
  if (!cell) return;
  const sr = scroller.getBoundingClientRect();
  const cr = cell.getBoundingClientRect();
  const isSticky = (c) => c.classList.contains('sticky') || c.classList.contains('dim');
  const sticky = isSticky(cell) ? 0 : [...cell.parentElement.children].filter(isSticky).reduce((sum, c) => sum + c.offsetWidth, 0);
  if (cr.left < sr.left + sticky) scroller.scrollLeft -= sr.left + sticky - cr.left + 8;
  else if (cr.right > sr.right) scroller.scrollLeft += cr.right - sr.right + 8;
  if (cr.top < sr.top) scroller.scrollTop -= sr.top - cr.top + 8;
  else if (cr.bottom > sr.bottom) scroller.scrollTop += cr.bottom - sr.bottom + 8;
}

let lastInspectorKey = '';
function renderInspectorPanel() {
  const key = app.state.tab + '|' + inspectedKey(app);
  if (els.inspector.contains(document.activeElement) && isTextInput(document.activeElement) && key === lastInspectorKey) return;
  lastInspectorKey = key;
  clear(els.inspector);
  if (!app.state.inspectorOpen) return;
  els.inspector.append(renderInspector(app));
}

app.setTab = (tab) => {
  if (app.state.editing) app.finishEdit(document.querySelector('.inline-edit')?.value ?? null);
  app.state.tab = tab;
  app.tooltip.hide();
  savePrefs();
  app.render();
};

app.toggleInspector = () => {
  app.state.inspectorOpen = !app.state.inspectorOpen;
  savePrefs();
  applyRootAttributes();
  app.render();
};

// ---------------------------------------------------------------- tooltip and toast

app.tooltip = (() => {
  let timer = 0;
  return {
    show(anchor, text) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const tip = els.tooltip;
        tip.textContent = text;
        tip.hidden = false;
        const r = anchor.getBoundingClientRect();
        const w = tip.offsetWidth;
        const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
        let top = r.bottom + 6;
        if (top + tip.offsetHeight > window.innerHeight - 8) top = r.top - tip.offsetHeight - 6;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      }, 250);
    },
    hide() {
      clearTimeout(timer);
      if (els.tooltip) els.tooltip.hidden = true;
    },
  };
})();

let toastTimer = 0;
app.toast = (text) => {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
};

// ---------------------------------------------------------------- menus

let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.panel.remove();
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu = null;
}

function menu(label, items) {
  const button = h('button', { class: 'menu-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label, h('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
  const open = (focusFirst) => {
    closeMenu();
    const panel = h('div', { class: 'menu', role: 'menu' });
    for (const it of items()) {
      if (it === 'sep') panel.append(h('div', { class: 'menu-sep', role: 'separator' }));
      else if (it.heading) panel.append(h('div', { class: 'menu-heading' }, it.heading));
      else {
        const role = it.checked === undefined ? 'menuitem' : it.radio ? 'menuitemradio' : 'menuitemcheckbox';
        panel.append(
          h(
            'button',
            {
              class: 'menu-item',
              role,
              tabindex: '-1',
              'aria-checked': it.checked === undefined ? null : it.checked ? 'true' : 'false',
              onclick: () => {
                closeMenu();
                button.focus();
                it.action();
              },
            },
            h('span', { class: 'check', 'aria-hidden': 'true' }, it.checked ? (it.radio ? '•' : '✓') : ''),
            h('span', { class: 'menu-label' }, it.label),
            it.shortcut ? h('span', { class: 'menu-shortcut' }, it.shortcut) : null,
          ),
        );
      }
    }
    panel.addEventListener('keydown', (e) => {
      const list = [...panel.querySelectorAll('.menu-item')];
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        closeMenu();
        button.focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        list[e.key === 'Home' ? 0 : list.length - 1].focus();
      }
      e.stopPropagation();
    });
    document.body.append(panel);
    const r = button.getBoundingClientRect();
    panel.style.top = r.bottom + 4 + 'px';
    panel.style.left = Math.min(window.innerWidth - panel.offsetWidth - 8, r.left) + 'px';
    button.setAttribute('aria-expanded', 'true');
    openMenu = { panel, button };
    if (focusFirst) panel.querySelector('.menu-item').focus();
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu && openMenu.button === button) closeMenu();
    else open(e.detail === 0);
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(true);
    }
  });
  return button;
}

document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.panel.contains(e.target) && e.target !== openMenu.button && !openMenu.button.contains(e.target)) closeMenu();
});

// ---------------------------------------------------------------- dialogs

function dialog(title, content, buttons, { wide = false, onClose } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: ['dialog', wide && 'wide'], 'aria-label': title });
    const footer = h('div', { class: 'dialog-buttons' });
    let result = null;
    for (const b of buttons) {
      footer.append(
        h(
          'button',
          {
            class: ['btn', b.primary && 'primary', b.danger && 'danger'],
            autofocus: b.autofocus ? true : null,
            onclick: () => {
              result = b.value;
              dlg.close();
            },
          },
          b.label,
        ),
      );
    }
    dlg.append(h('h2', { class: 'dialog-title' }, title), h('div', { class: 'dialog-content' }, content), footer);
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (onClose) onClose(result);
      resolve(result);
    });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dlg);
    app.tooltip.hide();
    closeMenu();
    dlg.showModal();
    const auto = dlg.querySelector('[autofocus]');
    if (auto) auto.focus();
  });
}

app.confirm = async (title, text, okLabel = 'OK') => {
  const r = await dialog(title, h('p', null, text), [
    { label: 'Cancel', value: false },
    { label: okLabel, value: true, danger: /delete|discard/i.test(okLabel), primary: !/delete|discard/i.test(okLabel), autofocus: true },
  ]);
  return r === true;
};

app.alert = (title, text) => dialog(title, h('p', null, text), [{ label: 'OK', value: true, primary: true, autofocus: true }]);

async function confirmDiscard() {
  if (!app.state.dirty) return true;
  return app.confirm('Discard unsaved changes?', 'The current space has changes that are not saved to a file. They are only in this browser’s cache, which is not a backup.', 'Discard');
}

function showReport(report, name) {
  if (!report.length) return;
  const list = h('ol', { class: 'report' });
  for (const r of report) {
    list.append(h('li', { class: 'report-' + r.level }, h('span', { class: 'report-line' }, r.line ? 'Line ' + r.line : '—'), h('span', { class: 'report-msg' }, r.message)));
  }
  dialog(
    'Import report',
    [h('p', null, `${name ? '“' + name + '” was' : 'The text was'} opened with ${report.length} note${report.length === 1 ? '' : 's'}. Saving writes the cleaned-up, canonical form.`), list],
    [{ label: 'OK', value: true, primary: true, autofocus: true }],
    { wide: true },
  );
}

// ---------------------------------------------------------------- documents

function loadSpace(space, { fileName = '', handle = null, dirty = false } = {}) {
  app.space = space;
  app.history.clear();
  const { state } = app;
  state.cursor = { problem: null, solution: null, evaluation: null };
  state.inspect = { problem: null, solution: null, evaluation: null };
  state.editing = null;
  state.scroll = {};
  state.activeOption = space.options.items.length ? space.options.items[0].id : null;
  state.pickMode = false;
  state.handle = handle;
  state.fileName = fileName;
  state.dirty = dirty;
  autosave();
  autosave.flush();
  app.render();
}

/** Opens Markdown text. Returns true on success. */
function openText(text, { name = '', handle = null, dirty = false } = {}) {
  const { space, report } = parse(text);
  if (!space) {
    app.alert('Cannot open this file', report.map((r) => r.message).join('\n'));
    return false;
  }
  loadSpace(space, { fileName: name, handle, dirty });
  showReport(report, name);
  return true;
}

app.newSpace = async () => {
  if (!(await confirmDiscard())) return;
  loadSpace(createSpace(''));
  app.setTab('problem');
};

app.open = async () => {
  if (!(await confirmDiscard())) return;
  try {
    const f = await store.openFile();
    if (f) openText(f.text, { name: f.name, handle: f.handle });
  } catch (err) {
    app.alert('Could not open the file', String(err && err.message));
  }
};

app.importText = async () => {
  const ta = h('textarea', { class: 'import-text', rows: '14', spellcheck: 'false', placeholder: '---\nzwicky: 1\ntitle: …\n---\n\n# Problem\n…', 'aria-label': 'Markdown to import' });
  const r = await dialog('Import from text', [h('p', null, 'Paste a zwicky Markdown document, e.g. one drafted by an LLM from docs/FORMAT.md. It replaces the open space.'), ta], [
    { label: 'Cancel', value: false },
    { label: 'Import', value: true, primary: true },
  ], { wide: true });
  if (!r || !ta.value.trim()) return;
  if (!(await confirmDiscard())) return;
  openText(ta.value, { dirty: true });
};

app.loadExample = async (name) => {
  if (!(await confirmDiscard())) return;
  openText(EXAMPLES[name], { name: '' });
};

app.save = async (saveAs) => {
  const { state, space } = app;
  if (state.editing) app.finishEdit(document.querySelector('.inline-edit')?.value ?? null);
  const before = space.meta.updated;
  space.meta.updated = store.today();
  const text = serialize(space);
  const name = state.fileName || defaultFileName(space.meta.title);
  try {
    const res = await store.saveFile(text, { handle: state.handle, name, saveAs });
    if (!res) {
      space.meta.updated = before;
      return;
    }
    state.handle = res.handle;
    state.fileName = res.name;
    state.dirty = false;
    autosave();
    autosave.flush();
    app.toast(res.method === 'file' ? `Saved to ${res.name}.` : `Downloaded ${res.name}.`);
    app.render();
  } catch (err) {
    space.meta.updated = before;
    app.alert('Could not save', String(err && err.message));
  }
};

app.markdown = () => serialize(app.space);

app.copyMarkdown = async () => {
  const ok = await store.copyText(serialize(app.space));
  app.toast(ok ? 'Copied the space as Markdown.' : 'Copying failed. Use Save instead.');
};

app.help = () => {
  const keys = h('dl', { class: 'shortcuts' });
  for (const [k, d] of SHORTCUTS) keys.append(h('dt', null, k.replace(/Ctrl/g, MOD)), h('dd', null, d));
  const examples = h('ul', { class: 'examples' });
  for (const name of Object.keys(EXAMPLES)) {
    const title = (/^title: (.*)$/m.exec(EXAMPLES[name]) || [])[1] || name;
    examples.append(
      h(
        'li',
        null,
        h('button', { class: 'link', onclick: () => { closeDialogs(); app.loadExample(name); } }, title),
        h('span', { class: 'muted' }, ' ' + name),
      ),
    );
  }
  const spec = h('pre', { class: 'format-doc', hidden: true }, FORMAT_DOC);
  const showSpec = h('button', { class: 'btn', 'aria-expanded': 'false', onclick: () => {
    spec.hidden = !spec.hidden;
    showSpec.setAttribute('aria-expanded', spec.hidden ? 'false' : 'true');
    showSpec.textContent = spec.hidden ? 'Show the format' : 'Hide the format';
  } }, 'Show the format');
  const copySpec = h('button', { class: 'btn', onclick: async () => {
    const ok = await store.copyText(FORMAT_DOC);
    app.toast(ok ? 'Copied the format specification.' : 'Copying failed. Select the text instead.');
  } }, 'Copy the format');
  const served = /^https?:$/.test(location.protocol);
  const offline = served
    ? h('p', null, h('a', { class: 'link', href: location.href.split(/[?#]/)[0], download: 'zwicky.html' }, 'Download zwicky.html for offline use'), ' — the whole app is this one file. It also works when opened from disk.')
    : null;
  dialog(
    'Help',
    [
      h('h3', null, 'Examples'),
      h('p', null, 'Opening an example replaces the open space.'),
      examples,
      h('h3', null, 'Keyboard'),
      keys,
      h('h3', null, 'The file format'),
      h(
        'p',
        null,
        'Spaces are saved as plain Markdown (.zwicky.md) that reads well in any editor and diffs cleanly in Git. The specification is in ',
        h('a', { class: 'link', href: '../docs/FORMAT.md', target: '_blank', rel: 'noopener' }, 'docs/FORMAT.md'),
        '. Give it to an LLM to draft or edit a space, then paste the result into File → Import from text.',
      ),
      h('div', { class: 'insp-actions' }, copySpec, showSpec),
      spec,
      h('h3', null, 'Where your data lives'),
      h('p', null, 'zwicky runs entirely in your browser and makes no network requests. The open space is kept in this browser’s cache so a reload does not lose it. That cache is a convenience, not a backup: clearing site data, a private window or another browser loses it. Save your space to a .zwicky.md file.'),
      offline,
      h('h3', null, 'About'),
      h(
        'p',
        null,
        `zwicky. ${APP_VERSION}. Named after Fritz Zwicky (1898–1974), the Swiss astrophysicist who formalised morphological analysis, the “Zwicky box”. `,
        'Fonts: Playfair Display, Lora and Source Code Pro, all under the SIL Open Font License 1.1.',
      ),
    ],
    [{ label: 'Close', value: true, primary: true, autofocus: true }],
    { wide: true },
  );
};

function closeDialogs() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const target = e.target;
  const inText = isTextInput(target);

  if (mod && key === 's') {
    e.preventDefault();
    if (inText) target.blur();
    app.save(e.shiftKey);
    return;
  }
  if (mod && key === 'o') {
    e.preventDefault();
    app.open();
    return;
  }
  if (inText) return; // native editing (incl. its own undo) inside text fields
  if (openMenu) return;

  if (mod && (key === 'z' || key === 'y')) {
    e.preventDefault();
    if (key === 'y' || e.shiftKey) app.redo();
    else app.undo();
    return;
  }

  const { state } = app;
  const inGrid = target === document.body || !target || els.body.contains(target);
  if ((state.tab === 'problem' || state.tab === 'solution') && inGrid && gridKeydown(app, state.tab, e)) {
    e.preventDefault();
    return;
  }
  if (state.tab === 'evaluation' && inGrid && evaluationKeydown(app, e)) {
    e.preventDefault();
    return;
  }
  if (mod || e.altKey) return;

  if (e.key === '?') {
    e.preventDefault();
    app.help();
  } else if (key === 'i') {
    e.preventDefault();
    app.toggleInspector();
  } else if (e.key === 'Escape') {
    if (state.pickMode) app.activateOption(state.activeOption, false);
    else if (state.inspect[state.tab]) app.inspectOption(null);
    else if (state.tab === 'solution' && state.activeOption !== null && !state.compare) app.activateOption(null);
    else if (state.cursor[state.tab]) app.setCursor(state.tab, null);
  }
});

// ---------------------------------------------------------------- files dropped on the window

document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    els.app.classList.add('file-over');
  }
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) els.app.classList.remove('file-over');
});
document.addEventListener('drop', async (e) => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  e.preventDefault();
  els.app.classList.remove('file-over');
  const file = files[0];
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    app.alert('Not a Markdown file', `“${file.name}” is not a .md file.`);
    return;
  }
  if (!(await confirmDiscard())) return;
  const f = await store.readDroppedFile(file);
  openText(f.text, { name: f.name });
});

app.preparePrint = () => preparePrint(app);
window.addEventListener('beforeprint', () => {
  if (app.state.editing) app.finishEdit(document.querySelector('.inline-edit')?.value ?? null);
  preparePrint(app);
});
window.addEventListener('afterprint', cleanupPrint);

window.addEventListener('beforeunload', (e) => {
  autosave.flush();
  if (app.state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave.flush();
});

// ---------------------------------------------------------------- start

function start() {
  buildShell();
  applyRootAttributes();
  const saved = store.loadAutosave();
  if (saved) {
    const { space, report } = parse(saved.markdown);
    if (space) {
      loadSpace(space, { fileName: saved.fileName, dirty: saved.dirty });
      return;
    }
    const key = store.backupAutosave();
    app.alert('The browser cache could not be read', `${report.map((r) => r.message).join(' ')} It was kept under “${key}” and not overwritten.`);
  }
  openText(EXAMPLES['car-concept.zwicky.md'], { name: '' });
}

start();

// for debugging in the console and for tests
window.zwicky = app;
