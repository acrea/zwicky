// zwicky. persistence: autosave to localStorage, open / save files, clipboard, preferences.
// The browser cache is a convenience, not a backup (README, Help).

const AUTOSAVE_KEY = 'zwicky.autosave';
const PREFS_KEY = 'zwicky.prefs';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- autosave

/** Returns { markdown, fileName, dirty } or null. */
export function loadAutosave() {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.markdown !== 'string') return null;
    return { markdown: data.markdown, fileName: data.fileName || '', dirty: !!data.dirty };
  } catch {
    return null;
  }
}

/**
 * Keeps an autosave the app cannot read (e.g. from a newer version) under a
 * separate key instead of overwriting it. Returns the backup key.
 */
export function backupAutosave() {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const key = `${AUTOSAVE_KEY}.backup-${new Date().toISOString()}`;
    ls.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

export function writeAutosave(markdown, fileName, dirty) {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(AUTOSAVE_KEY, JSON.stringify({ markdown, fileName, dirty, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function debounce(fn, ms) {
  let t = null;
  const run = () => {
    t = null;
    fn();
  };
  const d = () => {
    clearTimeout(t);
    t = setTimeout(run, ms);
  };
  d.flush = () => {
    if (t !== null) {
      clearTimeout(t);
      run();
    }
  };
  return d;
}

// ---------------------------------------------------------------- preferences

export function loadPrefs() {
  const ls = storage();
  try {
    return (ls && JSON.parse(ls.getItem(PREFS_KEY) || '{}')) || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  const ls = storage();
  try {
    if (ls) ls.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: preferences are not remembered */
  }
}

// ---------------------------------------------------------------- files

const PICKER_TYPES = [{ description: 'zwicky Markdown', accept: { 'text/markdown': ['.md'] } }];

export const hasFileSystemAccess = () =>
  typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

const isAbort = (err) => err && err.name === 'AbortError';

/** Lets the user pick a file. Resolves to { text, name, handle } or null if cancelled. */
export async function openFile() {
  if (hasFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,text/markdown,text/plain';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      resolve(file ? { text: await file.text(), name: file.name, handle: null } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function readDroppedFile(file) {
  return { text: await file.text(), name: file.name, handle: null };
}

/**
 * Saves text. With a file handle (File System Access API) it writes back to that
 * file; `saveAs` or no handle prompts for a new one where supported, otherwise
 * the file is downloaded. Resolves to { handle, name, method } or null if cancelled.
 */
export async function saveFile(text, { handle = null, name, saveAs = false }) {
  if (hasFileSystemAccess()) {
    try {
      let h = handle;
      if (!h || saveAs) h = await window.showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES });
      const writable = await h.createWritable();
      await writable.write(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
      await writable.close();
      return { handle: h, name: h.name, method: 'file' };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  download(text, name, 'text/markdown;charset=utf-8');
  return { handle: null, name, method: 'download' };
}

export function download(content, name, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'offscreen';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
