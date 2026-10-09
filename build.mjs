// zwicky. build: bundles the ES modules, inlines CSS, fonts and examples, computes
// the CSP script hash and writes dist/zwicky.html. Zero dependencies: `node build.mjs`.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const JS = join(SRC, 'js');
const ENTRY = 'ui/app.js';
const OUT = join(ROOT, 'dist', 'zwicky.html');
const MAX_BYTES = 1.5 * 1024 * 1024;

const read = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------- virtual modules

/** examples.js: the canonical fixtures, loadable via Help → Examples. */
function examplesModule() {
  const dir = join(ROOT, 'examples');
  const order = ['car-concept.zwicky.md', 'slide-generator.zwicky.md'];
  const names = readdirSync(dir).filter((f) => f.endsWith('.zwicky.md') && !f.startsWith('messy'));
  names.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const entries = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(read(join(dir, n)))}`);
  return `export const EXAMPLES = {\n${entries.join(',\n')}\n};\n`;
}

/** format-doc.js: docs/FORMAT.md, shown in Help and copyable for LLMs. */
function formatDocModule() {
  return `export const FORMAT_DOC = ${JSON.stringify(read(join(ROOT, 'docs', 'FORMAT.md')))};\n`;
}

/** version.js: the app version, from the VERSION file (one line, e.g. 1.2.0 or 1.2.0-rc.1). */
export function readVersion() {
  const v = read(join(ROOT, 'VERSION')).trim();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v)) throw new Error(`VERSION "${v}" is not a semantic version`);
  return v;
}
function versionModule() {
  return `export const APP_VERSION = ${JSON.stringify(readVersion())};\n`;
}

const VIRTUAL = { 'examples.js': examplesModule, 'format-doc.js': formatDocModule, 'version.js': versionModule };

// ---------------------------------------------------------------- bundler

const IMPORT_RE = /^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'([^']+)';?[ \t]*$/gm;

function loadModule(id) {
  if (VIRTUAL[id]) return VIRTUAL[id]();
  return read(join(JS, id));
}

/** Rewrites one ES module into a function body that returns its exports. */
function transform(id, code) {
  const deps = [];
  code = code.replace(IMPORT_RE, (_, ns, names, from) => {
    const dep = posix.normalize(posix.join(posix.dirname(id), from));
    deps.push(dep);
    if (ns) return `const ${ns} = __m[${JSON.stringify(dep)}];`;
    const binds = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2'));
    return `const { ${binds.join(', ')} } = __m[${JSON.stringify(dep)}];`;
  });
  if (/^\s*import\s/m.test(code)) throw new Error(`${id}: unsupported import syntax`);

  const exported = [];
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+(\w+)/gm, (_, kw, name) => {
    exported.push(name);
    return `${kw} ${name}`;
  });
  code = code.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_, list) => {
    for (const part of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      const m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(part);
      if (!m) throw new Error(`${id}: unsupported export "${part}"`);
      exported.push(m[2] ? `${m[2]}: ${m[1]}` : m[1]);
    }
    return '';
  });
  if (/^\s*export\s/m.test(code)) throw new Error(`${id}: unsupported export syntax`);
  return { deps, body: `${code.trim()}\nreturn { ${exported.join(', ')} };` };
}

function bundle(entry) {
  const done = new Map();
  const visiting = new Set();
  const order = [];
  const visit = (id) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`circular import: ${id}`);
    visiting.add(id);
    const mod = transform(id, loadModule(id));
    for (const d of mod.deps) visit(d);
    visiting.delete(id);
    done.set(id, mod);
    order.push(id);
  };
  visit(entry);
  const parts = order.map((id) => `// ---- ${id}\n__m[${JSON.stringify(id)}] = (() => {\n${done.get(id).body}\n})();`);
  return `(() => {\n'use strict';\nconst __m = Object.create(null);\n${parts.join('\n\n')}\n})();\n`;
}

// ---------------------------------------------------------------- CSS and fonts

function inlineFonts(css, dir) {
  return css.replace(/url\(([^)'"]+\.woff2)\)/g, (_, file) => {
    const data = readFileSync(join(dir, file)).toString('base64');
    return `url(data:font/woff2;base64,${data})`;
  });
}

function styles() {
  const fonts = inlineFonts(read(join(SRC, 'fonts', 'fonts.css')), join(SRC, 'fonts'));
  const themes = readdirSync(join(SRC, 'themes'))
    .filter((f) => f.endsWith('.css'))
    .sort((a, b) => (a === 'dm.css' ? -1 : b === 'dm.css' ? 1 : a.localeCompare(b)))
    .map((f) => `/* ---- themes/${f} */\n` + read(join(SRC, 'themes', f)));
  const base = read(join(SRC, 'css', 'base.css'));
  const print = existsSync(join(SRC, 'css', 'print.css')) ? read(join(SRC, 'css', 'print.css')) : '';
  return [fonts, ...themes, base, print].join('\n');
}

// ---------------------------------------------------------------- page

function build() {
  let js = bundle(ENTRY);
  // keep the script from closing its own element
  js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const hash = createHash('sha256').update(js, 'utf8').digest('base64');
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    'img-src data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  let html = read(join(SRC, 'index.html'));
  const put = (marker, content) => {
    if (!html.includes(marker)) throw new Error(`index.html lacks ${marker}`);
    html = html.replace(marker, () => content);
  };
  put('<!-- @CSP -->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  put('<!-- @STYLE -->', `<style>\n${styles()}\n</style>`);
  put('<!-- @SCRIPT -->', `<script>${js}</script>`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  const bytes = Buffer.byteLength(html);
  const kb = (bytes / 1024).toFixed(0);
  if (bytes > MAX_BYTES) throw new Error(`dist/zwicky.html is ${kb} KB, over the 1.5 MB budget`);
  console.log(`${relative(ROOT, OUT)}  ${kb} KB  (version ${readVersion()})`);
}

// `node build.mjs --version` prints the version (used by the release workflow).
if (process.argv.includes('--version')) console.log(readVersion());
else build();
