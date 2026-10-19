// zwicky. data model: shape, ids, invariants and scoring.
// Pure module: no DOM, importable in Node for tests.
//
// Shape (plain JSON, so history can snapshot it):
//
//   space = {
//     meta:     { title, scale: { min, max }, updated, extra: [[key, value], …] },
//     problem:  '',                     // the problem statement, shown above the box
//     dims:     [Dimension],            // the box: dimensions × parameters
//     options:  [{ uid, id, title, note, extends, tags }],
//     criteria: [{ uid, id, title, note, weight, tags }],
//     ratings:  { O1: { C1: { score, note, tags } } },
//     passthrough: [line, …],           // the "# Notes" section, verbatim
//   }
//
//   Dimension = { uid, title, note, tags, params: [Parameter] }
//   Parameter = { uid, title, note, mark, picks: [optionId], tags }
//
// A parameter is open (mark null), fixed or out. A fixed parameter is already
// decided: every option has it, which is computed (isSelected), not stored as
// picks. An out parameter is excluded and cannot be picked. Only open
// parameters carry picks.
//
// An option can extend another option (`extends` holds its id, or null): a later
// version of the same solution. An extension is a full option with its own
// picks; the link only groups it with the option it extends, so it is drawn in
// that option's colour with a dashed (then dotted) line. `tags` keeps unknown
// {…} tokens so they survive a round trip.

export const FORMAT_VERSION = 2;
export const DEFAULT_SCALE = Object.freeze({ min: 1, max: 5 });
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 10;
export const DEFAULT_WEIGHT = 1;
export const OPTION_COLOURS = 8;
export const MARKS = ['fixed', 'out'];

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
    problem: '',
    dims: [],
    options: [],
    criteria: [],
    ratings: {},
    passthrough: [],
  };
}

export function createDimension(title = '', note = '') {
  return { uid: uid(), title, note, tags: [], params: [] };
}

export function createParameter(title = '', note = '') {
  return { uid: uid(), title, note, mark: null, picks: [], tags: [] };
}

export function createOption(id, title = '', note = '') {
  return { uid: uid(), id, title, note, extends: null, tags: [] };
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

/** Colour slot 1..8 from the numeric id; from O9 on the colours repeat. */
export function colourSlot(id) {
  return ((Math.max(1, id | 0) - 1) % OPTION_COLOURS) + 1;
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

/**
 * Finds a dimension or parameter by uid. Returns
 * { node, kind: 'dim' | 'param', dim, row, index, siblings }, where `dim` is the
 * dimension itself or the parameter's dimension, `row` its index, and `index`
 * the node's index among `siblings`. Null if there is no such node.
 */
export function findNode(space, nodeUid) {
  for (let row = 0; row < space.dims.length; row++) {
    const dim = space.dims[row];
    if (dim.uid === nodeUid) return { node: dim, kind: 'dim', dim, row, index: row, siblings: space.dims };
    const index = dim.params.findIndex((p) => p.uid === nodeUid);
    if (index >= 0) return { node: dim.params[index], kind: 'param', dim, row, index, siblings: dim.params };
  }
  return null;
}

export function findOption(space, id) {
  return space.options.find((o) => o.id === id) || null;
}

export function findCriterion(space, id) {
  return space.criteria.find((c) => c.id === id) || null;
}

/** Every parameter of the box, in grid order. */
export function allParameters(space) {
  return space.dims.flatMap((d) => d.params);
}

// ---------------------------------------------------------------- box edits

export function addDimension(space, index = Infinity, title = '') {
  const dim = createDimension(title);
  space.dims.splice(Math.min(index, space.dims.length), 0, dim);
  return dim;
}

export function addParameter(space, dimUid, index = Infinity, title = '') {
  const found = findNode(space, dimUid);
  if (!found || found.kind !== 'dim') return null;
  const param = createParameter(title);
  const params = found.node.params;
  params.splice(Math.min(index, params.length), 0, param);
  return param;
}

/** Removes a dimension or parameter. Returns the removed node or null. */
export function removeNode(space, nodeUid) {
  const found = findNode(space, nodeUid);
  if (!found) return null;
  found.siblings.splice(found.index, 1);
  return found.node;
}

/** Moves a dimension or parameter among its siblings to `toIndex` (index after removal). */
export function moveNode(space, nodeUid, toIndex) {
  const found = findNode(space, nodeUid);
  if (!found) return false;
  return moveItem(found.siblings, found.index, toIndex);
}

/** Moves a parameter into a (possibly different) dimension at `toIndex`. */
export function moveParameter(space, paramUid, toDimUid, toIndex) {
  const from = findNode(space, paramUid);
  const to = findNode(space, toDimUid);
  if (!from || !to || from.kind !== 'param' || to.kind !== 'dim') return false;
  from.siblings.splice(from.index, 1);
  const params = to.node.params;
  params.splice(Math.max(0, Math.min(toIndex, params.length)), 0, from.node);
  return true;
}

/** Deleting asks for a confirm only if the node (or a parameter) has a note or a pick. */
export function nodeHasContent(node) {
  if (node.note) return true;
  if (node.params) return node.params.some(nodeHasContent);
  return node.picks.length > 0;
}

// ---------------------------------------------------------------- marks and picks

/**
 * Sets a parameter's mark ('fixed' or 'out'); setting the current mark again
 * opens the parameter. A marked parameter carries no picks: fixed already
 * counts for every option, out cannot be picked. Returns the dropped picks.
 */
export function toggleMark(param, mark) {
  if (!MARKS.includes(mark)) return [];
  param.mark = param.mark === mark ? null : mark;
  const dropped = param.mark ? param.picks : [];
  if (param.mark) param.picks = [];
  return dropped;
}

/** Whether option `optionId` has the parameter: picked, or fixed for all. */
export function isSelected(param, optionId) {
  if (param.mark === 'fixed') return true;
  return param.mark === null && param.picks.includes(optionId);
}

/** Toggles a pick on an open parameter. Returns false if the parameter is marked. */
export function togglePick(param, optionId) {
  if (param.mark) return false;
  const i = param.picks.indexOf(optionId);
  if (i >= 0) param.picks.splice(i, 1);
  else {
    param.picks.push(optionId);
    param.picks.sort((a, b) => a - b);
  }
  return true;
}

/** Selected parameters per dimension, in grid order (fixed ones included). */
export function optionProfile(space, optionId) {
  return space.dims.map((dim) => ({ dim, params: dim.params.filter((p) => isSelected(p, optionId)) }));
}

/**
 * A dimension with exactly one open parameter is often a constraint in
 * disguise: the value is already decided and could be marked fixed.
 */
export function looksDecided(dim) {
  return dim.params.length === 1 && dim.params[0].mark === null;
}

// ---------------------------------------------------------------- extensions

/** The chain of options an option extends, nearest first: O6 → [O4, O1]. Stops at a missing option or a loop. */
export function baseChain(space, id) {
  const chain = [];
  const seen = new Set([id]);
  let option = findOption(space, id);
  while (option && option.extends !== null && !seen.has(option.extends)) {
    seen.add(option.extends);
    option = findOption(space, option.extends);
    if (option) chain.push(option);
  }
  return chain;
}

/** How an option is drawn: the colour of the option its chain starts from, and its depth (0 solid, 1 dashed, 2+ dotted). */
export function optionLook(space, id) {
  const chain = baseChain(space, id);
  const root = chain.length ? chain[chain.length - 1].id : id;
  return { colour: colourSlot(root), depth: chain.length };
}

/** Whether option `id` may extend option `baseId`: it exists, and the link makes no loop. */
export function canExtend(space, id, baseId) {
  if (baseId === null) return true;
  if (baseId === id || !findOption(space, baseId)) return false;
  return !baseChain(space, baseId).some((o) => o.id === id);
}

/** Links option `id` to the option it extends (null unlinks). Returns false if the link is not allowed. */
export function setExtends(space, id, baseId) {
  const option = findOption(space, id);
  if (!option || !canExtend(space, id, baseId)) return false;
  option.extends = baseId;
  return true;
}

/** The options that extend option `id`, directly or further down the chain. */
export function extensionsOf(space, id) {
  return space.options.filter((o) => baseChain(space, o.id).some((b) => b.id === id));
}

/**
 * Starts an extension of option `id`: a new option that extends it, with the
 * same picks, placed after the option and its existing extensions.
 */
export function extendOption(space, id) {
  const items = space.options;
  const base = findOption(space, id);
  if (!base) return null;
  const ext = createOption(nextId(items), '');
  ext.extends = id;
  const family = new Set([base, ...extensionsOf(space, id)]);
  let at = items.indexOf(base) + 1;
  while (at < items.length && family.has(items[at])) at += 1;
  items.splice(at, 0, ext);
  for (const p of allParameters(space)) if (p.picks.includes(id)) togglePick(p, ext.id);
  return ext;
}

// ---------------------------------------------------------------- options

export function addOption(space, title = '', index = Infinity) {
  const items = space.options;
  const option = createOption(nextId(items), title);
  items.splice(Math.min(index, items.length), 0, option);
  return option;
}

/** Copies an option's title, note, link, picks and ratings into a new option right after it. */
export function duplicateOption(space, id) {
  const items = space.options;
  const source = findOption(space, id);
  if (!source) return null;
  const copy = createOption(nextId(items), source.title, source.note);
  copy.extends = source.extends;
  copy.tags = [...source.tags];
  items.splice(items.indexOf(source) + 1, 0, copy);
  for (const p of allParameters(space)) if (p.picks.includes(id)) togglePick(p, copy.id);
  const cells = space.ratings[optionKey(id)];
  if (cells) space.ratings[optionKey(copy.id)] = JSON.parse(JSON.stringify(cells));
  return copy;
}

/** Deletes an option with its picks and ratings. Its extensions become options of their own. */
export function removeOption(space, id) {
  const i = space.options.findIndex((o) => o.id === id);
  if (i < 0) return false;
  space.options.splice(i, 1);
  for (const o of space.options) if (o.extends === id) o.extends = null;
  for (const p of allParameters(space)) p.picks = p.picks.filter((x) => x !== id);
  delete space.ratings[optionKey(id)];
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
  const items = space.criteria;
  const criterion = createCriterion(nextId(items), title);
  items.splice(Math.min(index, items.length), 0, criterion);
  return criterion;
}

export function removeCriterion(space, id) {
  const i = space.criteria.findIndex((c) => c.id === id);
  if (i < 0) return false;
  space.criteria.splice(i, 1);
  const key = criterionKey(id);
  for (const ok of Object.keys(space.ratings)) {
    delete space.ratings[ok][key];
    if (Object.keys(space.ratings[ok]).length === 0) delete space.ratings[ok];
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
  const row = space.ratings[optionKey(optionId)];
  return (row && row[criterionKey(criterionId)]) || null;
}

/**
 * Sets fields of a rating. `patch` may hold `score` (number or null) and `note`.
 * A rating with neither score nor note nor tags is removed (unrated).
 */
export function setRating(space, optionId, criterionId, patch) {
  const ok = optionKey(optionId);
  const ck = criterionKey(criterionId);
  const cells = space.ratings;
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
  for (const row of Object.values(space.ratings)) {
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
  for (const c of space.criteria) {
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
  for (const o of space.options) {
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
