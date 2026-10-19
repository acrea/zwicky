import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, serialize } from '../src/js/format.js';
import {
  createSpace,
  addDimension,
  addParameter,
  addOption,
  addCriterion,
  removeOption,
  removeCriterion,
  duplicateOption,
  removeNode,
  moveNode,
  moveParameter,
  findNode,
  toggleMark,
  togglePick,
  isSelected,
  looksDecided,
  setRating,
  getRating,
  scoreOption,
  rankOptions,
  scoreFraction,
  colourSlot,
  optionProfile,
  rowLetter,
  coordinate,
  nodeHasContent,
  clampAllScores,
  clone,
  baseChain,
  optionLook,
  canExtend,
  setExtends,
  extendOption,
  extensionsOf,
} from '../src/js/model.js';

const car = () => parse(readFileSync(new URL('../examples/car-concept.zwicky.md', import.meta.url), 'utf8')).space;

/** A space with n options and the given criteria weights, unrated. */
function scoring(weights, options = 3) {
  const s = createSpace();
  for (let i = 0; i < options; i++) addOption(s, 'O' + (i + 1));
  for (const w of weights) addCriterion(s).weight = w;
  return s;
}

// ---------------------------------------------------------------- scoring

test('weighted score and rank of the car concept demo', () => {
  const s = car();
  assert.ok(Math.abs(scoreOption(s, 1).score - 23 / 6) < 1e-9);
  const ranks = rankOptions(s);
  assert.deepEqual(
    [...ranks.entries()].map(([id, r]) => [id, r.display, r.unrated, r.rank]),
    [
      [1, 3.8, 0, 1],
      [2, 3.3, 0, 3],
      [4, 3.5, 0, 2],
      [5, 3.2, 0, 4],
      [3, 3.2, 1, 4],
    ],
  );
});

test('unrated cells are skipped, not counted as zero', () => {
  const s = scoring([1, 1, 1]);
  setRating(s, 1, 1, { score: 4 });
  assert.deepEqual(scoreOption(s, 1), { score: 4, unrated: 2 });
  setRating(s, 1, 2, { score: 2 });
  assert.deepEqual(scoreOption(s, 1), { score: 3, unrated: 1 });
});

test('weight 0 excludes a criterion from the total', () => {
  const s = scoring([0, 2]);
  setRating(s, 1, 1, { score: 1 });
  setRating(s, 1, 2, { score: 5 });
  assert.equal(scoreOption(s, 1).score, 5);
  const only0 = scoring([0]);
  setRating(only0, 1, 1, { score: 3 });
  assert.equal(scoreOption(only0, 1).score, null);
  assert.equal(rankOptions(only0).get(1).rank, null);
});

test('ties share a rank (competition ranking) and unscored options have none', () => {
  const s = scoring([1], 4);
  setRating(s, 1, 1, { score: 4 });
  setRating(s, 2, 1, { score: 4 });
  setRating(s, 3, 1, { score: 2 });
  const r = rankOptions(s);
  assert.deepEqual(
    [1, 2, 3, 4].map((id) => r.get(id).rank),
    [1, 1, 3, null],
  );
});

test('ranks compare the displayed (one decimal) score', () => {
  const s = scoring([1, 2, 5]);
  // O1: (3 + 2·4) / 3 = 3.667   O2: (2·3 + 5·4) / 7 = 3.714   both show 3.7
  setRating(s, 1, 1, { score: 3 });
  setRating(s, 1, 2, { score: 4 });
  setRating(s, 2, 2, { score: 3 });
  setRating(s, 2, 3, { score: 4 });
  const r = rankOptions(s);
  assert.notEqual(r.get(1).score, r.get(2).score);
  assert.equal(r.get(1).display, 3.7);
  assert.equal(r.get(2).display, 3.7);
  assert.equal(r.get(1).rank, 1);
  assert.equal(r.get(2).rank, 1);
});

test('score fraction for bars', () => {
  assert.equal(scoreFraction(1, { min: 1, max: 5 }), 0);
  assert.equal(scoreFraction(3, { min: 1, max: 5 }), 0.5);
  assert.equal(scoreFraction(null, { min: 1, max: 5 }), 0);
});

// ---------------------------------------------------------------- ratings

test('setRating clamps, keeps notes without scores and removes empty ratings', () => {
  const s = scoring([1], 1);
  setRating(s, 1, 1, { score: 9 });
  assert.equal(getRating(s, 1, 1).score, 5);
  setRating(s, 1, 1, { score: null, note: 'assumption' });
  assert.deepEqual(getRating(s, 1, 1), { score: null, note: 'assumption', tags: [] });
  setRating(s, 1, 1, { note: '' });
  assert.equal(getRating(s, 1, 1), null);
  assert.deepEqual(s.ratings, {});
});

test('clampAllScores after a scale change', () => {
  const s = scoring([1], 1);
  setRating(s, 1, 1, { score: 5 });
  s.meta.scale = { min: 1, max: 3 };
  clampAllScores(s);
  assert.equal(getRating(s, 1, 1).score, 3);
});

// ---------------------------------------------------------------- ids and options

test('option ids are max + 1 and never renumbered', () => {
  const s = createSpace();
  const a = addOption(s, 'a');
  const b = addOption(s, 'b');
  const c = addOption(s, 'c');
  removeOption(s, b.id);
  assert.deepEqual(
    s.options.map((o) => o.id),
    [1, 3],
  );
  assert.equal(addOption(s, 'd').id, 4);
  assert.equal(a.id, 1);
  assert.equal(c.id, 3);
});

test('deleting an option removes its picks and ratings', () => {
  const s = car();
  removeOption(s, 1);
  for (const d of s.dims) for (const p of d.params) assert.ok(!p.picks.includes(1));
  assert.equal(s.ratings.O1, undefined);
  assert.ok(s.ratings.O2);
});

test('deleting an option turns its direct extensions into options of their own', () => {
  const s = car();
  removeOption(s, 4);
  assert.deepEqual(s.options.map((o) => [o.id, o.extends]), [[1, null], [2, null], [5, null], [3, null]]);
});

test('deleting a criterion removes its ratings', () => {
  const s = car();
  removeCriterion(s, 3);
  assert.equal(s.ratings.O1.C3, undefined);
  assert.equal(s.ratings.O1.C1.score, 4);
});

test('duplicating an option copies title, note, link, picks and ratings', () => {
  const s = car();
  const copy = duplicateOption(s, 2);
  assert.equal(copy.id, 6);
  assert.deepEqual(
    s.options.map((o) => o.id),
    [1, 2, 6, 4, 5, 3],
  );
  assert.deepEqual(
    optionProfile(s, 6).map((r) => r.params.map((p) => p.title)),
    optionProfile(s, 2).map((r) => r.params.map((p) => p.title)),
  );
  assert.deepEqual(s.ratings.O6, s.ratings.O2);
  assert.notEqual(s.ratings.O6, s.ratings.O2);
  assert.equal(duplicateOption(s, 5).extends, 4, 'a copy of an extension extends the same option');
});

test('option colours: stable by id, from O9 on they repeat', () => {
  assert.deepEqual([1, 8, 9, 17].map(colourSlot), [1, 8, 1, 1]);
});

test('option profile lists picks and fixed parameters per dimension, including empty ones', () => {
  const s = car();
  const profile = optionProfile(s, 3);
  assert.equal(profile.length, s.dims.length);
  const platform = profile.find((r) => r.dim.title === 'Platform');
  assert.deepEqual(
    platform.params.map((p) => p.title),
    ['Existing platform'],
  );
  const front = profile.find((r) => r.dim.title === 'Front design');
  assert.deepEqual(front.params, []);
  const drivetrain = profile.find((r) => r.dim.title === 'Drivetrain');
  assert.deepEqual(
    drivetrain.params.map((p) => p.title),
    ['Diesel'],
  );
});

// ---------------------------------------------------------------- box

test('coordinates', () => {
  assert.equal(rowLetter(0), 'A');
  assert.equal(rowLetter(25), 'Z');
  assert.equal(rowLetter(26), 'AA');
  assert.equal(rowLetter(27), 'AB');
  assert.equal(coordinate(2, 3), 'C4');
});

test('add, find, move and remove dimensions and parameters', () => {
  const s = createSpace();
  const d1 = addDimension(s, Infinity, 'one');
  const d2 = addDimension(s, Infinity, 'two');
  const a = addParameter(s, d1.uid, Infinity, 'a');
  const b = addParameter(s, d1.uid, Infinity, 'b');
  assert.equal(addParameter(s, a.uid, 0, 'not into a parameter'), null);
  assert.ok(moveNode(s, b.uid, 0));
  assert.deepEqual(
    d1.params.map((p) => p.title),
    ['b', 'a'],
  );
  assert.ok(moveNode(s, d2.uid, 0));
  assert.deepEqual(
    s.dims.map((d) => d.title),
    ['two', 'one'],
  );
  assert.ok(moveParameter(s, a.uid, d2.uid, 0));
  assert.deepEqual(
    d2.params.map((p) => p.title),
    ['a'],
  );
  assert.deepEqual(
    (({ kind, dim, row, index }) => [kind, dim, row, index])(findNode(s, a.uid)),
    ['param', d2, 0, 0],
  );
  assert.deepEqual(
    (({ kind, dim, row }) => [kind, dim, row])(findNode(s, d1.uid)),
    ['dim', d1, 1],
  );
  assert.equal(moveParameter(s, d1.uid, d2.uid, 0), false, 'only parameters move between dimensions');
  assert.equal(removeNode(s, d1.uid), d1);
  assert.equal(findNode(s, b.uid), null);
  assert.equal(findNode(s, 'nope'), null);
});

test('picks toggle and stay sorted', () => {
  const s = createSpace();
  const p = addParameter(s, addDimension(s).uid);
  togglePick(p, 3);
  togglePick(p, 1);
  assert.deepEqual(p.picks, [1, 3]);
  togglePick(p, 3);
  assert.deepEqual(p.picks, [1]);
});

test('marks: fixed and out are exclusive, toggle, and drop the picks', () => {
  const s = createSpace();
  const p = addParameter(s, addDimension(s).uid);
  p.picks = [1, 2];
  assert.deepEqual(toggleMark(p, 'fixed'), [1, 2]);
  assert.deepEqual([p.mark, p.picks], ['fixed', []]);
  assert.deepEqual(toggleMark(p, 'out'), []);
  assert.equal(p.mark, 'out');
  toggleMark(p, 'out');
  assert.equal(p.mark, null);
  toggleMark(p, 'focus');
  assert.equal(p.mark, null, 'only fixed and out are marks');
});

test('a fixed parameter is selected by every option; out and marked ones cannot be picked', () => {
  const s = createSpace();
  const d = addDimension(s);
  const fixed = addParameter(s, d.uid, Infinity, 'fixed');
  const out = addParameter(s, d.uid, Infinity, 'out');
  const open = addParameter(s, d.uid, Infinity, 'open');
  toggleMark(fixed, 'fixed');
  toggleMark(out, 'out');
  addOption(s, 'a');
  addOption(s, 'b');
  assert.equal(togglePick(fixed, 1), false);
  assert.equal(togglePick(out, 1), false);
  assert.equal(togglePick(open, 2), true);
  assert.deepEqual([fixed.picks, out.picks], [[], []]);
  assert.deepEqual([1, 2].map((id) => [isSelected(fixed, id), isSelected(out, id), isSelected(open, id)]), [
    [true, false, false],
    [true, false, true],
  ]);
  assert.deepEqual(
    optionProfile(s, 2)[0].params.map((p) => p.title),
    ['fixed', 'open'],
  );
  // a stray pick on a marked parameter never counts
  out.picks = [1];
  assert.equal(isSelected(out, 1), false);
});

test('a dimension with one open parameter looks decided', () => {
  const s = createSpace();
  const d = addDimension(s);
  assert.equal(looksDecided(d), false);
  const p = addParameter(s, d.uid);
  assert.equal(looksDecided(d), true);
  toggleMark(p, 'fixed');
  assert.equal(looksDecided(d), false);
  toggleMark(p, 'fixed');
  addParameter(s, d.uid);
  assert.equal(looksDecided(d), false);
});

test('delete confirm is needed only for notes or picks', () => {
  const s = createSpace();
  const d = addDimension(s);
  const p = addParameter(s, d.uid, 0, 'x');
  assert.equal(nodeHasContent(p), false);
  assert.equal(nodeHasContent(d), false);
  p.picks.push(1);
  assert.equal(nodeHasContent(d), true);
  p.picks = [];
  d.note = 'n';
  assert.equal(nodeHasContent(d), true);
});

test('clone is deep and JSON-safe', () => {
  const s = car();
  const c = clone(s);
  assert.deepEqual(c, s);
  c.dims[0].params[0].title = 'changed';
  assert.notEqual(s.dims[0].params[0].title, 'changed');
});

// ---------------------------------------------------------------- extensions

test('the car demo: O4 extends O2, O5 extends O4; extensions take the colour of their first option', () => {
  const s = car();
  assert.deepEqual(baseChain(s, 5).map((o) => o.id), [4, 2]);
  assert.deepEqual(baseChain(s, 2), []);
  assert.deepEqual([1, 2, 4, 5].map((id) => optionLook(s, id)), [
    { colour: 1, depth: 0 },
    { colour: 2, depth: 0 },
    { colour: 2, depth: 1 },
    { colour: 2, depth: 2 },
  ]);
  assert.deepEqual(extensionsOf(s, 2).map((o) => o.id), [4, 5]);
  assert.deepEqual(extensionsOf(s, 4).map((o) => o.id), [5]);
});

test('links cannot point to the option itself, a missing option, or make a loop', () => {
  const s = car();
  assert.equal(canExtend(s, 2, 2), false);
  assert.equal(canExtend(s, 2, 9), false);
  assert.equal(canExtend(s, 2, 5), false, 'O5 already extends O2 through O4');
  assert.equal(canExtend(s, 1, 5), true);
  assert.equal(canExtend(s, 2, null), true);
  assert.equal(setExtends(s, 2, 5), false);
  assert.equal(s.options.find((o) => o.id === 2).extends, null);
  assert.equal(setExtends(s, 5, null), true);
  assert.deepEqual(optionLook(s, 5), { colour: 5, depth: 0 });
});

test('extending an option starts a new option with its picks, after its existing extensions', () => {
  const s = car();
  const ext = extendOption(s, 2);
  assert.equal(ext.id, 6);
  assert.equal(ext.extends, 2);
  assert.equal(ext.title, '');
  assert.deepEqual(s.options.map((o) => o.id), [1, 2, 4, 5, 6, 3]);
  assert.deepEqual(
    optionProfile(s, 6).map((r) => r.params.map((p) => p.title)),
    optionProfile(s, 2).map((r) => r.params.map((p) => p.title)),
  );
  assert.equal(s.ratings.O6, undefined, 'an extension starts unrated');
  const ext2 = extendOption(s, 1);
  assert.deepEqual(s.options.map((o) => o.id), [1, 7, 2, 4, 5, 6, 3]);
  assert.equal(ext2.extends, 1);
  assert.equal(extendOption(s, 99), null);
});
