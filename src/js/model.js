// zwicky. data model: shape, ids, invariants and scoring.
// Pure module: no DOM, importable in Node for tests.
//
// Shape (plain JSON, so history can snapshot it):
//
//   space = {
//     meta:      { title, scale: { min, max }, updated, extra: [[key, value], …] },
//     problem:   { note, dims: [Dimension] },
//     solution:  { note, dims: [Dimension] },
//     options:   { note, items: [{ uid, id, title, note, tags }] },
//     criteria:  { note, items: [{ uid, id, title, note, weight, tags }] },
//     ratings:   { note, cells: { O1: { C1: { score, note, tags } } } },
//     passthrough: [line, …],          // the "# Notes" section, verbatim
//   }
//
//   Dimension = { uid, kind: 'dim', title, note, tags, children: [Parameter | Dimension] }
//   Parameter = { uid, kind: 'param', title, note, mark, picks: [optionId], tags }
//
// The model is a tree (§4.7): a dimension's children may in future hold
// sub-dimensions. v1 only ever creates parameters directly under dimensions.
// `tags` keeps unknown {…} tokens so they survive a round trip.

export const FORMAT_VERSION = 1;
export const DEFAULT_SCALE = Object.freeze({ min: 1, max: 5 });
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 10;
export const DEFAULT_WEIGHT = 1;
export const OPTION_COLOURS = 8;
export const MARKS = ['focus', 'out'];
export const GRID_SECTIONS = ['problem', 'solution'];

let uidCounter = 0;
export function uid() {
  uidCounter += 1;
  return 'u' + uidCounter.toString(36);
}

// ---------------------------------------------------------------- titles

/**
 * Titles are single-line and never end in a "{…}" group, because that is how
 * tags are written in the file (docs/FORMAT.md). Line breaks become spaces and
 * the braces of a trailing group become parentheses: "Budget {in CHF}" -> "Budget (in CHF)".
 */
export function cleanTitle(title) {
  return String(title ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()
    .replace(/(^|\s)\{([^{}]*)\}$/, '$1($2)');
}

// ---------------------------------------------------------------- creation

export function createSpace(title = '') {
  return {
    meta: { title, scale: { ...DEFAULT_SCALE }, updated: '', extra: [] },
    problem: { note: '', dims: [] },
    solution: { note: '', dims: [] },
    options: { note: '', items: [] },
    criteria: { note: '', items: [] },
    ratings: { note: '', cells: {} },
    passthrough: [],
  };
}

export function createDimension(title = '', note = '') {
  return { uid: uid(), kind: 'dim', title, note, tags: [], children: [] };
}

export function createParameter(title = '', note = '') {
  return { uid: uid(), kind: 'param', title, note, mark: null, picks: [], tags: [] };
}

export function createOption(id, title = '', note = '') {
  return { uid: uid(), id, title, note, tags: [] };
}

export function createCriterion(id, title = '', note = '', weight = DEFAULT_WEIGHT) {
  return { uid: uid(), id, title, note, weight, tags: [] };
}

export function clone(space) {
  return JSON.parse(JSON.stringify(space));
}

// ---------------------------------------------------------------- ids

export const optionKey = (id) => 'O' + id;
export const criterionKey = (id) => 'C' + id;

export function nextId(items) {
  let max = 0;
  for (const item of items) if (item.id > max) max = item.id;
  return max + 1;
}

/** Option colour slot 1..8, and line style 0.. (0 solid, 1 dashed, …) from the numeric id. */
export function optionColour(id) {
  const n = Math.max(1, id | 0) - 1;
  return { colour: (n % OPTION_COLOURS) + 1, style: Math.floor(n / OPTION_COLOURS) };
}

/** Row letters for coordinates: A..Z, AA..AZ, BA… */
export function rowLetter(index) {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function coordinate(rowIndex, cellIndex) {
  return rowLetter(rowIndex) + (cellIndex + 1);
}

// ---------------------------------------------------------------- lookup

export function parametersOf(dim) {
  return dim.children.filter((c) => c.kind === 'param');
}

/** Walks every node in a grid section, depth first. */
export function* walk(nodes, parent = null) {
  for (const node of nodes) {
    yield { node, parent };
    if (node.kind === 'dim') yield* walk(node.children, node);
  }
}

/** Finds a dimension or parameter by uid in either grid section. */
export function findNode(space, nodeUid) {
  for (const section of GRID_SECTIONS) {
    const top = space[section].dims;
    for (const { node, parent } of walk(top)) {
      if (node.uid === nodeUid) {
        const siblings = parent ? parent.children : top;
        return { node, parent, section, siblings, index: siblings.indexOf(node) };
      }
    }
  }
  return null;
}

export function findOption(space, id) {
  return space.options.items.find((o) => o.id === id) || null;
}

export function findCriterion(space, id) {
  return space.criteria.items.find((c) => c.id === id) || null;
}

// ---------------------------------------------------------------- grid edits

export function addDimension(space, section, index = Infinity, title = '') {
  const dims = space[section].dims;
  const dim = createDimension(title);
  dims.splice(Math.min(index, dims.length), 0, dim);
  return dim;
}

export function addParameter(space, dimUid, index = Infinity, title = '') {
  const found = findNode(space, dimUid);
  if (!found || found.node.kind !== 'dim') return null;
  const param = createParameter(title);
  const children = found.node.children;
  children.splice(Math.min(index, children.length), 0, param);
  return param;
}

/** Removes a dimension or parameter. Returns the removed node or null. */
export function removeNode(space, nodeUid) {
  const found = findNode(space, nodeUid);
  if (!found) return null;
  found.siblings.splice(found.index, 1);
  return found.node;
}

/** Moves a node among its siblings to `toIndex` (index after removal). */
export function moveNode(space, nodeUid, toIndex) {
  const found = findNode(space, nodeUid);
  if (!found) return false;
  const { siblings, index, node } = found;
  const target = Math.max(0, Math.min(toIndex, siblings.length - 1));
  if (target === index) return false;
  siblings.splice(index, 1);
  siblings.splice(target, 0, node);
  return true;
}

/** Moves a parameter into a (possibly different) dimension of the same section. */
export function moveParameter(space, paramUid, toDimUid, toIndex) {
  const from = findNode(space, paramUid);
  const to = findNode(space, toDimUid);
  if (!from || !to || from.node.kind !== 'param' || to.node.kind !== 'dim') return false;
  if (from.section !== to.section) return false;
  from.siblings.splice(from.index, 1);
  const children = to.node.children;
  children.splice(Math.max(0, Math.min(toIndex, children.length)), 0, from.node);
  return true;
}

/** Sets a problem mark; setting the current mark again clears it. */
export function toggleMark(param, mark) {
  if (!MARKS.includes(mark)) return;
  param.mark = param.mark === mark ? null : mark;
}

/** Deleting asks for a confirm only if the node (or a child) has a note or a pick (§3.1). */
export function nodeHasContent(node) {
  if (node.note) return true;
  if (node.kind === 'param') return node.picks.length > 0;
  return node.children.some(nodeHasContent);
}

// ---------------------------------------------------------------- picks

export function isPicked(param, optionId) {
  return param.picks.includes(optionId);
}

export function togglePick(param, optionId) {
  const i = param.picks.indexOf(optionId);
  if (i >= 0) param.picks.splice(i, 1);
  else {
    param.picks.push(optionId);
    param.picks.sort((a, b) => a - b);
  }
}

/** Picked parameters per solution dimension, in grid order. */
export function optionProfile(space, optionId) {
  return space.solution.dims.map((dim) => ({
    dim,
    params: parametersOf(dim).filter((p) => p.picks.includes(optionId)),
  }));
}

// ---------------------------------------------------------------- options

export function addOption(space, title = '', index = Infinity) {
  const items = space.options.items;
  const option = createOption(nextId(items), title);
  items.splice(Math.min(index, items.length), 0, option);
  return option;
}

/** Copies an option's title, note, picks and ratings into a new option right after it. */
export function duplicateOption(space, id) {
  const items = space.options.items;
  const source = findOption(space, id);
  if (!source) return null;
  const copy = createOption(nextId(items), source.title, source.note);
  copy.tags = [...source.tags];
  items.splice(items.indexOf(source) + 1, 0, copy);
  for (const { node } of walk(space.solution.dims)) {
    if (node.kind === 'param' && node.picks.includes(id)) togglePick(node, copy.id);
  }
  const cells = space.ratings.cells[optionKey(id)];
  if (cells) space.ratings.cells[optionKey(copy.id)] = JSON.parse(JSON.stringify(cells));
  return copy;
}

/** Deletes an option with its picks and ratings. */
export function removeOption(space, id) {
  const items = space.options.items;
  const i = items.findIndex((o) => o.id === id);
  if (i < 0) return false;
  items.splice(i, 1);
  for (const { node } of walk(space.solution.dims)) {
    if (node.kind === 'param') node.picks = node.picks.filter((p) => p !== id);
  }
  for (const { node } of walk(space.problem.dims)) {
    if (node.kind === 'param') node.picks = node.picks.filter((p) => p !== id);
  }
  delete space.ratings.cells[optionKey(id)];
  return true;
}

export function moveItem(items, from, to) {
  if (from < 0 || from >= items.length) return false;
  const target = Math.max(0, Math.min(to, items.length - 1));
  if (target === from) return false;
  const [item] = items.splice(from, 1);
  items.splice(target, 0, item);
  return true;
}

// ---------------------------------------------------------------- criteria

export function addCriterion(space, title = '', index = Infinity) {
  const items = space.criteria.items;
  const criterion = createCriterion(nextId(items), title);
  items.splice(Math.min(index, items.length), 0, criterion);
  return criterion;
}

export function removeCriterion(space, id) {
  const items = space.criteria.items;
  const i = items.findIndex((c) => c.id === id);
  if (i < 0) return false;
  items.splice(i, 1);
  const key = criterionKey(id);
  for (const ok of Object.keys(space.ratings.cells)) {
    delete space.ratings.cells[ok][key];
    if (Object.keys(space.ratings.cells[ok]).length === 0) delete space.ratings.cells[ok];
  }
  return true;
}

export function clampWeight(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return DEFAULT_WEIGHT;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, n));
}

// ---------------------------------------------------------------- ratings

export function clampScore(score, scale) {
  if (score === null || score === undefined) return null;
  return Math.max(scale.min, Math.min(scale.max, Math.round(score)));
}

export function getRating(space, optionId, criterionId) {
  const row = space.ratings.cells[optionKey(optionId)];
  return (row && row[criterionKey(criterionId)]) || null;
}

/**
 * Sets fields of a rating. `patch` may hold `score` (number or null) and `note`.
 * A rating with neither score nor note nor tags is removed (unrated).
 */
export function setRating(space, optionId, criterionId, patch) {
  const ok = optionKey(optionId);
  const ck = criterionKey(criterionId);
  const cells = space.ratings.cells;
  const current = (cells[ok] && cells[ok][ck]) || { score: null, note: '', tags: [] };
  const next = { ...current, ...patch };
  if ('score' in patch) next.score = clampScore(patch.score, space.meta.scale);
  if (next.score === null && !next.note && next.tags.length === 0) {
    if (cells[ok]) {
      delete cells[ok][ck];
      if (Object.keys(cells[ok]).length === 0) delete cells[ok];
    }
    return null;
  }
  if (!cells[ok]) cells[ok] = {};
  cells[ok][ck] = next;
  return next;
}

/** Clamps every stored score to the current scale (after the scale changed). */
export function clampAllScores(space) {
  for (const row of Object.values(space.ratings.cells)) {
    for (const cell of Object.values(row)) cell.score = clampScore(cell.score, space.meta.scale);
  }
}

// ---------------------------------------------------------------- scoring

export const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Weighted score of one option: Σ weight × score ÷ Σ weight over rated criteria
 * with weight > 0. `score` is null when nothing counts. `unrated` counts all
 * criteria without a score (an unrated cell is not the same as zero).
 */
export function scoreOption(space, optionId) {
  let sumWeighted = 0;
  let sumWeights = 0;
  let unrated = 0;
  for (const c of space.criteria.items) {
    const r = getRating(space, optionId, c.id);
    const s = r ? r.score : null;
    if (s === null) {
      unrated += 1;
      continue;
    }
    if (c.weight > 0) {
      sumWeighted += c.weight * s;
      sumWeights += c.weight;
    }
  }
  return { score: sumWeights > 0 ? sumWeighted / sumWeights : null, unrated };
}

/**
 * Scores and ranks all options. Ranks use the score rounded to one decimal
 * (what the user sees), so equal displayed scores share a rank; standard
 * competition ranking (1, 1, 3). Options without a score get rank null.
 * Returns a Map optionId -> { score, display, unrated, rank }.
 */
export function rankOptions(space) {
  const results = new Map();
  for (const o of space.options.items) {
    const { score, unrated } = scoreOption(space, o.id);
    results.set(o.id, { score, display: score === null ? null : round1(score), unrated, rank: null });
  }
  const scored = [...results.values()].filter((r) => r.display !== null);
  for (const r of scored) {
    r.rank = 1 + scored.filter((other) => other.display > r.display).length;
  }
  return results;
}

/** Fraction 0..1 of a score within the scale, for bars. */
export function scoreFraction(score, scale) {
  if (score === null) return 0;
  const span = scale.max - scale.min;
  return span > 0 ? Math.max(0, Math.min(1, (score - scale.min) / span)) : 0;
}
