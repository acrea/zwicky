// zwicky. file format: parse(markdown) -> { space, report }; serialize(space) -> markdown.
// Tolerant reader, canonical writer. The specification is docs/FORMAT.md.
// Pure module: no DOM, importable in Node for tests.

import {
  FORMAT_VERSION,
  DEFAULT_SCALE,
  MARKS,
  STAGES,
  DEFAULT_STAGE_NAMES,
  cleanStageName,
  createSpace,
  createDimension,
  createParameter,
  createOption,
  createCriterion,
  clampWeight,
  cleanTitle,
  optionKey,
  criterionKey,
} from './model.js';

/**
 * Upgrades older files step by step before parsing. Each entry turns the text
 * of a version `from` file into the text of a version `from + 1` file, e.g.
 *   { from: 1, up: (text) => text.replace(…) }
 * v1 is the first version, so the list is empty.
 */
export const MIGRATIONS = [];

const SECTIONS = ['problem', 'solution', 'options', 'criteria', 'ratings', 'notes'];
const SECTION_TITLES = {
  problem: 'Problem',
  solution: 'Solution',
  options: 'Options',
  criteria: 'Criteria',
  ratings: 'Ratings',
  notes: 'Notes',
};
const KNOWN_META = ['zwicky', 'title', 'scale', 'stages', 'updated'];
const SUB_SEPARATOR = ' › ';

// ---------------------------------------------------------------- helpers

// A tag group is one {…} at the very end of a heading or list-item line,
// preceded by whitespace (or nothing). Titles never end in such a group
// (see cleanTitle in model.js), so the format needs no escaping.
const TAG_RE = /(^|\s)\{([^{}]*)\}$/;

/** Splits "Title {a b}" into title and tokens; a title left ending in {…} is reported and fixed. */
function splitTitle(text, ln, add) {
  let s = text.trim();
  let tokens = [];
  const m = TAG_RE.exec(s);
  if (m) {
    tokens = m[2].trim().split(/\s+/).filter(Boolean);
    s = s.slice(0, m.index).trim();
  }
  const title = cleanTitle(s);
  if (title !== s && add) add(ln, 'info', `Title "${s}" may not end in {…}; read as "${title}".`);
  return { title, tokens };
}

/** Canonical note text: LF, no trailing spaces, no leading or trailing empty lines. */
export function normNote(note) {
  const lines = String(note ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function trimBlankEdges(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

function splitLines(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+$/, ''));
}

/** Finds the front matter block: { start, end } line indexes of the two fences, or null. */
function findFrontMatter(lines) {
  let i = 0;
  while (i < lines.length && lines[i] === '') i++;
  if (lines[i] !== '---') return null;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '---' || lines[j] === '...') return { start: i, end: j };
  }
  return { start: i, end: -1 };
}

function splitMetaLine(line) {
  let idx = line.indexOf(': ');
  if (idx < 0 && line.endsWith(':')) idx = line.length - 1;
  if (idx < 0) idx = line.indexOf(':');
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  if (!key) return null;
  return { key, value: line.slice(idx + 1).trim() };
}

function readVersion(lines) {
  const fm = findFrontMatter(lines);
  if (!fm || fm.end < 0) return { version: null, raw: null };
  let raw = null;
  for (let j = fm.start + 1; j < fm.end; j++) {
    const kv = splitMetaLine(lines[j]);
    if (kv && kv.key.toLowerCase() === 'zwicky') raw = kv.value;
  }
  if (raw === null) return { version: null, raw };
  return { version: /^\d+$/.test(raw) ? Number(raw) : null, raw };
}

function parseScale(value) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(value);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!(min < max) || max > 100) return null;
  return { min, max };
}

// ---------------------------------------------------------------- parse

/**
 * Parses a zwicky Markdown file. Never throws on user content: problems are
 * collected in `report` as { line, level: 'error' | 'warning' | 'info', message }.
 * `space` is null only when the file cannot be read at all (e.g. a newer version).
 */
export { cleanTitle };

export function parse(text) {
  const report = [];
  try {
    let source = String(text ?? '');
    const { version, raw } = readVersion(splitLines(source));
    if (version !== null && version > FORMAT_VERSION) {
      report.push({
        line: 1,
        level: 'error',
        message: `This file uses zwicky format version ${version}; this app reads up to version ${FORMAT_VERSION}. Please use a newer zwicky.`,
      });
      return { space: null, report };
    }
    if (version !== null && version >= 1) {
      for (let v = version; v < FORMAT_VERSION; v++) {
        const step = MIGRATIONS.find((m) => m.from === v);
        if (!step) {
          report.push({ line: 1, level: 'error', message: `No migration from format version ${v}.` });
          return { space: null, report };
        }
        source = step.up(source);
        report.push({ line: 1, level: 'info', message: `Upgraded from format version ${v} to ${v + 1}.` });
      }
    }
    const space = parseBody(splitLines(source), report, version, raw);
    report.sort((a, b) => a.line - b.line);
    return { space, report };
  } catch (err) {
    report.push({ line: 0, level: 'error', message: 'Unexpected parser error: ' + (err && err.message) });
    return { space: null, report };
  }
}

function parseBody(lines, report, version, rawVersion) {
  const add = (line, level, message) => report.push({ line, level, message });
  const space = createSpace();

  // Passthrough: the "# Notes" section first, then other blocks that could not be placed.
  const notesLines = [];
  const blocks = [];
  let lastUnplaced = -2;
  let currentBlock = null;
  const unplace = (ln, raw, why) => {
    if (currentBlock && lastUnplaced === ln - 1) currentBlock.push(raw);
    else {
      add(ln, 'warning', `${why}; kept under # Notes.`);
      currentBlock = [raw];
      blocks.push(currentBlock);
    }
    lastUnplaced = ln;
  };

  // ---- front matter
  let bodyStart = 0;
  const fm = findFrontMatter(lines);
  if (!fm) {
    add(1, 'info', 'No front matter; read as zwicky format version 1.');
  } else if (fm.end < 0) {
    add(fm.start + 1, 'warning', 'Front matter is not closed with "---"; read as content.');
  } else {
    const seen = new Set();
    for (let j = fm.start + 1; j < fm.end; j++) {
      const ln = j + 1;
      if (lines[j].trim() === '') continue;
      const kv = splitMetaLine(lines[j]);
      if (!kv) {
        unplace(ln, lines[j], 'Front matter line is not "key: value"');
        continue;
      }
      const lower = kv.key.toLowerCase();
      const key = KNOWN_META.includes(lower) ? lower : kv.key;
      if (seen.has(key)) add(ln, 'warning', `Duplicate front matter key "${key}"; the last value wins.`);
      seen.add(key);
      if (key === 'zwicky') continue;
      if (key === 'title') space.meta.title = kv.value;
      else if (key === 'updated') space.meta.updated = kv.value;
      else if (key === 'scale') {
        const scale = parseScale(kv.value);
        if (scale) space.meta.scale = scale;
        else {
          space.meta.scale = { ...DEFAULT_SCALE };
          add(ln, 'warning', `Scale "${kv.value}" is not "<min>-<max>"; using ${DEFAULT_SCALE.min}-${DEFAULT_SCALE.max}.`);
        }
      } else if (key === 'stages') {
        const names = kv.value.split(',').map(cleanStageName);
        if (names.length > STAGES.length)
          add(ln, 'warning', `Only ${STAGES.length} stages are supported; "${names.slice(STAGES.length).join(', ')}" dropped.`);
        space.meta.stages = DEFAULT_STAGE_NAMES.map((d, i) => names[i] || d);
        if (names.slice(0, STAGES.length).some((n) => !n) || names.length < STAGES.length)
          add(ln, 'info', `Missing stage names filled in with the defaults: ${space.meta.stages.join(', ')}.`);
      } else {
        const existing = space.meta.extra.find((e) => e[0] === key);
        if (existing) existing[1] = kv.value;
        else space.meta.extra.push([key, kv.value]);
      }
    }
    if (rawVersion === null) add(fm.start + 1, 'info', 'Front matter has no "zwicky" version; read as version 1.');
    else if (version === null || version < 1)
      add(fm.start + 1, 'warning', `Format version "${rawVersion}" is not valid; read as version 1.`);
    bodyStart = fm.end + 1;
  }

  // ---- body
  const DROP = {}; // note/item target whose lines are silently dropped (unknown rating block)
  let section = null; // a SECTIONS key, 'unknown', or null before the first section
  const seenSections = new Set();
  let dim = null; // current dimension (problem/solution)
  let sub = null; // current ### sub-dimension being flattened
  let ratingBlock = null; // current ## O<n> block under # Ratings, or DROP
  let target = null; // where the next "> " note line goes
  let blank = false; // was there a blank line since the last content line
  let unknownBlock = null;

  const noteBuf = new Map();
  const subdims = new Map(); // dim -> [{ title, target }]
  const optionRecs = [];
  const criterionRecs = [];
  const pickRefs = []; // { param, id, line }
  const ratingBlocks = [];

  const setTarget = (t) => {
    target = t;
    blank = false;
  };

  const startDimension = (text, ln) => {
    const { title, tokens } = splitTitle(text, ln, add);
    const d = createDimension(title);
    for (const tok of tokens) {
      d.tags.push(tok);
      add(ln, 'info', `Unknown tag "${tok}" on dimension kept.`);
    }
    space[section].dims.push(d);
    dim = d;
    sub = null;
    setTarget(d);
  };

  const readHeadingId = (text, letter, ln) => {
    const { title, tokens } = splitTitle(text, ln, add);
    const m = new RegExp(`^${letter}(\\d+)(?=[\\s:.]|$)[:.]?\\s*(.*)$`).exec(title);
    if (!m) return { id: null, title, tokens };
    return { id: Number(m[1]), title: m[2], tokens };
  };

  for (let n = bodyStart; n < lines.length; n++) {
    const raw = lines[n];
    const ln = n + 1;
    const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(raw);
    const level = h ? h[1].length : 0;
    const htext = h ? (h[2] || '').trim() : '';

    // # Section
    if (level === 1) {
      const key = htext.toLowerCase();
      if (SECTIONS.includes(key)) {
        if (seenSections.has(key)) add(ln, 'warning', `Section "# ${SECTION_TITLES[key]}" appears twice; merged.`);
        seenSections.add(key);
        section = key;
        dim = null;
        sub = null;
        ratingBlock = null;
        unknownBlock = null;
        setTarget(key === 'notes' ? null : space[key]);
        continue;
      }
      if (section !== 'notes') {
        add(ln, 'warning', `Unknown section "# ${htext}"; kept under # Notes.`);
        section = 'unknown';
        unknownBlock = [raw];
        blocks.push(unknownBlock);
        setTarget(null);
        continue;
      }
    }

    if (section === 'notes') {
      notesLines.push(raw);
      continue;
    }
    if (section === 'unknown') {
      unknownBlock.push(raw);
      continue;
    }

    if (raw.trim() === '') {
      blank = true;
      continue;
    }

    // > note line
    if (/^\s*>/.test(raw)) {
      if (target === DROP) continue;
      if (!target) {
        unplace(ln, raw, 'Note without a heading or list item to belong to');
        continue;
      }
      let buf = noteBuf.get(target);
      if (!buf) noteBuf.set(target, (buf = []));
      if (blank && buf.length) buf.push('');
      buf.push(raw.replace(/^\s*>/, '').replace(/^ /, ''));
      blank = false;
      continue;
    }
    blank = false;

    // ## heading
    if (level === 2) {
      if (section === 'problem' || section === 'solution') {
        startDimension(htext, ln);
      } else if (section === 'options' || section === 'criteria') {
        const letter = section === 'options' ? 'O' : 'C';
        const { id, title, tokens } = readHeadingId(htext, letter, ln);
        const item = section === 'options' ? createOption(null, title) : createCriterion(null, title);
        for (const tok of tokens) {
          const w = /^w=(-?\d+)$/.exec(tok);
          const st = /^stage=(\d+)$/.exec(tok);
          if (section === 'options' && st && STAGES.includes(Number(st[1])) && !item.stage) {
            item.stage = Number(st[1]);
          } else if (section === 'criteria' && w) {
            const weight = clampWeight(Number(w[1]));
            if (weight !== Number(w[1])) add(ln, 'warning', `Weight ${w[1]} is outside 0–10; set to ${weight}.`);
            item.weight = weight;
          } else {
            item.tags.push(tok);
            add(ln, 'info', `Unknown tag "${tok}" kept.`);
          }
        }
        (section === 'options' ? space.options : space.criteria).items.push(item);
        (section === 'options' ? optionRecs : criterionRecs).push({ item, id, line: ln });
        setTarget(item);
      } else if (section === 'ratings') {
        const { id, tokens } = readHeadingId(htext, 'O', ln);
        if (tokens.length) add(ln, 'warning', `Tags on a ratings heading are ignored: {${tokens.join(' ')}}.`);
        if (id === null) {
          add(ln, 'warning', `Ratings heading "## ${htext}" has no option id (O<n>); its ratings are dropped.`);
          ratingBlock = DROP;
          setTarget(DROP);
        } else {
          ratingBlock = { id, line: ln, entries: [] };
          ratingBlocks.push(ratingBlock);
          setTarget(null);
        }
      } else {
        unplace(ln, raw, 'Heading outside a known section');
        setTarget(null);
      }
      continue;
    }

    // ### and deeper
    if (level >= 3) {
      if (level === 3 && (section === 'problem' || section === 'solution')) {
        if (!dim) {
          add(ln, 'warning', `"### ${htext}" has no parent dimension; read as a dimension.`);
          startDimension(htext, ln);
          continue;
        }
        const { title, tokens } = splitTitle(htext, ln, add);
        if (tokens.length) add(ln, 'warning', `Tags on a sub-dimension are dropped: {${tokens.join(' ')}}.`);
        add(
          ln,
          'warning',
          `Sub-dimension "${title}" flattened into "${dim.title}" (sub-dimensions are not supported in v1).`,
        );
        sub = { title, target: {} };
        if (!subdims.has(dim)) subdims.set(dim, []);
        subdims.get(dim).push(sub);
        setTarget(sub.target);
      } else {
        unplace(ln, raw, `Heading level ${level} is not used here`);
        setTarget(null);
      }
      continue;
    }

    // - list item
    const li = /^\s*[-*+](?:\s+(.*))?$/.exec(raw);
    if (li) {
      const text = li[1] || '';
      if (section === 'problem' || section === 'solution') {
        if (!dim) {
          unplace(ln, raw, 'Parameter outside a dimension');
          setTarget(null);
          continue;
        }
        const { title, tokens } = splitTitle(text, ln, add);
        const param = createParameter(sub ? sub.title + SUB_SEPARATOR + title : title);
        for (const tok of tokens) {
          const pick = /^O(\d+)$/.exec(tok);
          const focus = /^focus(?:=(\d+))?$/.exec(tok);
          const stage = focus ? Number(focus[1] || 1) : null;
          if (section === 'problem' && (MARKS.includes(tok) || (focus && STAGES.includes(stage)))) {
            const current = param.stage ? stageTag(param.stage) : param.mark;
            if (current) {
              if (current !== tok) add(ln, 'warning', `Parameter has both "${current}" and "${tok}"; kept "${current}".`);
            } else if (focus) param.stage = stage;
            else param.mark = tok;
          } else if (section === 'problem' && focus) {
            param.tags.push(tok);
            add(ln, 'warning', `Stage ${focus[1]} does not exist (only 1–${STAGES.length}); "${tok}" kept as an unknown tag.`);
          } else if (section === 'solution' && pick) {
            const id = Number(pick[1]);
            if (pickRefs.some((r) => r.param === param && r.id === id)) add(ln, 'info', `Duplicate pick O${id} removed.`);
            else pickRefs.push({ param, id, line: ln });
          } else {
            param.tags.push(tok);
            add(ln, 'info', `Unknown tag "${tok}" kept.`);
          }
        }
        dim.children.push(param);
        setTarget(param);
      } else if (section === 'ratings' && ratingBlock) {
        if (ratingBlock === DROP) continue;
        const { title, tokens } = splitTitle(text);
        const m = /^C(\d+)\s*:\s*(.*)$/.exec(title);
        if (!m) {
          unplace(ln, raw, 'Rating line is not "- C<n>: <score>"');
          setTarget(null);
          continue;
        }
        let score = null;
        const value = m[2].trim();
        if (/^-?\d+$/.test(value)) score = Number(value);
        else if (value !== '' && value !== '?') add(ln, 'warning', `Score "${value}" is not a whole number; left unscored.`);
        for (const tok of tokens) add(ln, 'info', `Unknown tag "${tok}" kept.`);
        const entry = { cid: Number(m[1]), score, tags: tokens, line: ln, cell: {} };
        ratingBlock.entries.push(entry);
        setTarget(entry.cell);
      } else {
        unplace(ln, raw, section ? 'List item not expected here' : 'List item outside a section');
        setTarget(null);
      }
      continue;
    }

    // anything else
    unplace(ln, raw, 'Text that is not a heading, list item or note');
    setTarget(null);
  }

  // ---- notes
  const noteOf = (t) => normNote((noteBuf.get(t) || []).join('\n'));
  for (const key of ['problem', 'solution', 'options', 'criteria', 'ratings']) space[key].note = noteOf(space[key]);
  for (const key of ['problem', 'solution']) {
    for (const d of space[key].dims) {
      d.note = noteOf(d);
      for (const p of d.children) p.note = noteOf(p);
      for (const s of subdims.get(d) || []) {
        const sn = noteOf(s.target);
        if (sn) d.note = d.note ? `${d.note}\n${s.title}: ${sn}` : `${s.title}: ${sn}`;
      }
    }
  }
  for (const o of space.options.items) o.note = noteOf(o);
  for (const c of space.criteria.items) c.note = noteOf(c);

  // ---- ids
  const assignIds = (recs, letter, what) => {
    const used = new Set();
    const pending = [];
    for (const rec of recs) {
      if (rec.id !== null && rec.id > 0 && !used.has(rec.id)) {
        rec.item.id = rec.id;
        used.add(rec.id);
      } else pending.push(rec);
    }
    let next = Math.max(0, ...used) + 1;
    for (const rec of pending) {
      rec.item.id = next++;
      if (rec.id === null || rec.id <= 0)
        add(rec.line, 'warning', `${what} heading without an id; assigned ${letter}${rec.item.id}.`);
      else add(rec.line, 'warning', `Duplicate id ${letter}${rec.id}; re-assigned as ${letter}${rec.item.id}.`);
    }
  };
  assignIds(optionRecs, 'O', 'Option');
  assignIds(criterionRecs, 'C', 'Criterion');

  const optionIds = new Set(space.options.items.map((o) => o.id));
  const criterionIds = new Set(space.criteria.items.map((c) => c.id));

  for (const ref of pickRefs) {
    if (optionIds.has(ref.id)) ref.param.picks.push(ref.id);
    else add(ref.line, 'warning', `Unknown option O${ref.id}; pick dropped.`);
  }
  for (const d of space.solution.dims) for (const p of d.children) p.picks.sort((a, b) => a - b);

  // ---- ratings
  const { min, max } = space.meta.scale;
  for (const block of ratingBlocks) {
    if (!optionIds.has(block.id)) {
      add(block.line, 'warning', `Ratings for unknown option O${block.id} dropped.`);
      continue;
    }
    const ok = optionKey(block.id);
    for (const e of block.entries) {
      if (!criterionIds.has(e.cid)) {
        add(e.line, 'warning', `Rating for unknown criterion C${e.cid} dropped.`);
        continue;
      }
      let score = e.score;
      if (score !== null && (score < min || score > max)) {
        const clamped = Math.max(min, Math.min(max, score));
        add(e.line, 'warning', `Score ${score} is outside ${min}-${max}; set to ${clamped}.`);
        score = clamped;
      }
      const note = noteOf(e.cell);
      if (score === null && !note && e.tags.length === 0) continue;
      const row = (space.ratings.cells[ok] ||= {});
      const ck = criterionKey(e.cid);
      if (row[ck]) add(e.line, 'warning', `Second rating for O${block.id} × C${e.cid}; the last one wins.`);
      row[ck] = { score, note, tags: e.tags };
    }
  }

  // ---- passthrough
  const out = trimBlankEdges(notesLines);
  for (const b of blocks) {
    const lines2 = trimBlankEdges(b);
    if (!lines2.length) continue;
    if (out.length) out.push('');
    out.push(...lines2);
  }
  space.passthrough = out;

  return space;
}

// ---------------------------------------------------------------- serialize

/** The tag for a problem stage: "focus" for stage 1, "focus=2" and "focus=3" for the others. */
function stageTag(stage) {
  return stage === 1 ? 'focus' : 'focus=' + stage;
}

function tagGroup(tokens) {
  return tokens.length ? ' {' + tokens.join(' ') + '}' : '';
}

function itemLine(prefix, title, tokens) {
  const t = cleanTitle(title);
  return prefix + (t ? ' ' + t : '') + tagGroup(tokens);
}

function cleanValue(v) {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Writes the canonical form (§4.4). */
export function serialize(space) {
  const out = [];
  const { meta } = space;
  out.push('---', `zwicky: ${FORMAT_VERSION}`);
  const title = cleanValue(meta.title);
  if (title) out.push(`title: ${title}`);
  const scale = meta.scale || DEFAULT_SCALE;
  out.push(`scale: ${scale.min}-${scale.max}`);
  const stages = DEFAULT_STAGE_NAMES.map((d, i) => cleanStageName((meta.stages || [])[i]) || d);
  if (stages.some((n, i) => n !== DEFAULT_STAGE_NAMES[i])) out.push(`stages: ${stages.join(', ')}`);
  const updated = cleanValue(meta.updated);
  if (updated) out.push(`updated: ${updated}`);
  for (const [k, v] of meta.extra || []) {
    const key = cleanValue(k);
    if (!key || KNOWN_META.includes(key.toLowerCase()) || key.includes(':')) continue;
    const value = cleanValue(v);
    out.push(value ? `${key}: ${value}` : `${key}:`);
  }
  out.push('---');

  const heading = (text) => out.push('', text);
  const note = (text, indent) => {
    const n = normNote(text);
    if (!n) return;
    for (const l of n.split('\n')) out.push(l ? `${indent}> ${l}` : `${indent}>`);
  };

  const optionIds = new Set(space.options.items.map((o) => o.id));
  const criterionIds = new Set(space.criteria.items.map((c) => c.id));

  // Problem and Solution
  const writeChildren = (key, children, prefix) => {
    for (const c of children) {
      if (c.kind === 'dim') {
        // v1 never creates sub-dimensions; flatten defensively like the reader does.
        writeChildren(key, c.children, prefix + cleanTitle(c.title) + SUB_SEPARATOR);
        continue;
      }
      const tokens = [];
      if (key === 'problem' && STAGES.includes(c.stage)) tokens.push(stageTag(c.stage));
      else if (key === 'problem' && MARKS.includes(c.mark)) tokens.push(c.mark);
      if (key === 'solution')
        for (const id of [...c.picks].sort((a, b) => a - b)) if (optionIds.has(id)) tokens.push('O' + id);
      tokens.push(...c.tags);
      out.push(itemLine('-', prefix + cleanTitle(c.title), tokens));
      note(c.note, '  ');
    }
  };
  for (const key of ['problem', 'solution']) {
    const sec = space[key];
    if (!normNote(sec.note) && sec.dims.length === 0) continue;
    heading('# ' + SECTION_TITLES[key]);
    note(sec.note, '');
    for (const d of sec.dims) {
      heading(itemLine('##', d.title, d.tags));
      note(d.note, '');
      writeChildren(key, d.children, '');
    }
  }

  // Options
  if (normNote(space.options.note) || space.options.items.length) {
    heading('# Options');
    note(space.options.note, '');
    for (const o of space.options.items) {
      heading(itemLine('## O' + o.id, o.title, STAGES.includes(o.stage) ? ['stage=' + o.stage, ...o.tags] : o.tags));
      note(o.note, '');
    }
  }

  // Criteria
  if (normNote(space.criteria.note) || space.criteria.items.length) {
    heading('# Criteria');
    note(space.criteria.note, '');
    for (const c of space.criteria.items) {
      const w = clampWeight(c.weight);
      const tokens = w === 1 ? [...c.tags] : ['w=' + w, ...c.tags];
      heading(itemLine('## C' + c.id, c.title, tokens));
      note(c.note, '');
    }
  }

  // Ratings
  const ratingBlocks = [];
  for (const o of space.options.items) {
    const row = space.ratings.cells[optionKey(o.id)];
    if (!row) continue;
    const lines = [];
    for (const c of space.criteria.items) {
      const cell = row[criterionKey(c.id)];
      if (!cell || !criterionIds.has(c.id)) continue;
      const cellNote = normNote(cell.note);
      const tags = cell.tags || [];
      let score = cell.score;
      if (score !== null && score !== undefined) score = Math.max(scale.min, Math.min(scale.max, Math.round(score)));
      else score = null;
      if (score === null && !cellNote && !tags.length) continue;
      lines.push({ text: `- C${c.id}: ${score === null ? '?' : score}${tagGroup(tags)}`, note: cellNote });
    }
    if (lines.length) ratingBlocks.push({ o, lines });
  }
  if (normNote(space.ratings.note) || ratingBlocks.length) {
    heading('# Ratings');
    note(space.ratings.note, '');
    for (const { o, lines } of ratingBlocks) {
      heading(itemLine('## O' + o.id, o.title, []));
      for (const l of lines) {
        out.push(l.text);
        note(l.note, '  ');
      }
    }
  }

  // Notes (passthrough, verbatim)
  const pass = trimBlankEdges((space.passthrough || []).map((l) => String(l).replace(/\s+$/, '')));
  if (pass.length) {
    heading('# Notes');
    out.push(...pass);
  }

  return out.map((l) => l.replace(/\s+$/, '')).join('\n') + '\n';
}

/** Default file name: <slugified-title>.zwicky.md */
export function fileName(title) {
  const slug = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return (slug || 'untitled') + '.zwicky.md';
}
