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
  setRating,
  getRating,
  scoreOption,
  rankOptions,
  scoreFraction,
  optionColour,
  optionProfile,
  rowLetter,
  coordinate,
  nodeHasContent,
  clampAllScores,
  clone,
  moveDimensionToSection,
  moveLosses,
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
      [2, 3.3, 0, 2],
      [3, 3.2, 1, 3],
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
  assert.deepEqual(s.ratings.cells, {});
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
    s.options.items.map((o) => o.id),
    [1, 3],
  );
  assert.equal(addOption(s, 'd').id, 4);
  assert.equal(a.id, 1);
  assert.equal(c.id, 3);
});

test('deleting an option removes its picks and ratings', () => {
  const s = car();
  removeOption(s, 1);
  for (const d of s.solution.dims) for (const p of d.children) assert.ok(!p.picks.includes(1));
  assert.equal(s.ratings.cells.O1, undefined);
  assert.ok(s.ratings.cells.O2);
});

test('deleting a criterion removes its ratings', () => {
  const s = car();
  removeCriterion(s, 3);
  assert.equal(s.ratings.cells.O1.C3, undefined);
  assert.equal(s.ratings.cells.O1.C1.score, 4);
});

test('duplicating an option copies title, note, picks and ratings', () => {
  const s = car();
  const copy = duplicateOption(s, 2);
  assert.equal(copy.id, 4);
  assert.deepEqual(
    s.options.items.map((o) => o.id),
    [1, 2, 4, 3],
  );
  assert.deepEqual(
    optionProfile(s, 4).map((r) => r.params.map((p) => p.title)),
    optionProfile(s, 2).map((r) => r.params.map((p) => p.title)),
  );
  assert.deepEqual(s.ratings.cells.O4, s.ratings.cells.O2);
  assert.notEqual(s.ratings.cells.O4, s.ratings.cells.O2);
});

test('option colours: stable by id, O9 wraps to colour 1 with the next line style', () => {
  assert.deepEqual(optionColour(1), { colour: 1, style: 0 });
  assert.deepEqual(optionColour(8), { colour: 8, style: 0 });
  assert.deepEqual(optionColour(9), { colour: 1, style: 1 });
  assert.deepEqual(optionColour(17), { colour: 1, style: 2 });
});

test('option profile lists picks per dimension, including empty ones', () => {
  const s = car();
  const profile = optionProfile(s, 3);
  assert.equal(profile.length, s.solution.dims.length);
  const target = profile.find((r) => r.dim.title === 'Target group');
  assert.deepEqual(target.params, []);
  const drivetrain = profile.find((r) => r.dim.title === 'Drivetrain');
  assert.deepEqual(
    drivetrain.params.map((p) => p.title),
    ['Diesel'],
  );
});

// ---------------------------------------------------------------- grid

test('coordinates', () => {
  assert.equal(rowLetter(0), 'A');
  assert.equal(rowLetter(25), 'Z');
  assert.equal(rowLetter(26), 'AA');
  assert.equal(rowLetter(27), 'AB');
  assert.equal(coordinate(2, 3), 'C4');
});

test('add, move and remove dimensions and parameters', () => {
  const s = createSpace();
  const d1 = addDimension(s, 'solution', Infinity, 'one');
  const d2 = addDimension(s, 'solution', Infinity, 'two');
  const a = addParameter(s, d1.uid, Infinity, 'a');
  const b = addParameter(s, d1.uid, Infinity, 'b');
  assert.ok(moveNode(s, b.uid, 0));
  assert.deepEqual(
    d1.children.map((p) => p.title),
    ['b', 'a'],
  );
  assert.ok(moveNode(s, d2.uid, 0));
  assert.deepEqual(
    s.solution.dims.map((d) => d.title),
    ['two', 'one'],
  );
  assert.ok(moveParameter(s, a.uid, d2.uid, 0));
  assert.deepEqual(
    d2.children.map((p) => p.title),
    ['a'],
  );
  assert.equal(findNode(s, a.uid).parent, d2);
  const other = addDimension(s, 'problem', 0, 'p');
  assert.equal(moveParameter(s, a.uid, other.uid, 0), false, 'no moves across sections');
  assert.equal(removeNode(s, d1.uid), d1);
  assert.equal(findNode(s, b.uid), null);
});

test('marks toggle; picks toggle and stay sorted', () => {
  const s = createSpace();
  const d = addDimension(s, 'problem');
  const p = addParameter(s, d.uid);
  toggleMark(p, 'focus');
  assert.equal(p.mark, 'focus');
  toggleMark(p, 'out');
  assert.equal(p.mark, 'out');
  toggleMark(p, 'out');
  assert.equal(p.mark, null);
  togglePick(p, 3);
  togglePick(p, 1);
  assert.deepEqual(p.picks, [1, 3]);
  togglePick(p, 3);
  assert.deepEqual(p.picks, [1]);
});

test('delete confirm is needed only for notes or picks', () => {
  const s = createSpace();
  const d = addDimension(s, 'solution');
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
  c.solution.dims[0].children[0].title = 'changed';
  assert.notEqual(s.solution.dims[0].children[0].title, 'changed');
});

// ---------------------------------------------------------------- moving dimensions between sections

test('a solution dimension moves to the problem with its parameters and notes; picks are dropped', () => {
  const s = car();
  const drive = s.solution.dims[1];
  drive.note = 'How the car is powered.';
  drive.children[3].note = 'Petrol and electric.';
  drive.children[3].tags.push('later');
  const titles = drive.children.map((p) => p.title);
  const solutionTitles = s.solution.dims.map((d) => d.title).filter((t) => t !== 'Drivetrain');
  assert.deepEqual(moveLosses(drive), { marks: 0, picks: 3 });
  assert.equal(moveDimensionToSection(s, drive.uid, 'problem'), drive);
  assert.deepEqual(s.solution.dims.map((d) => d.title), solutionTitles);
  assert.equal(s.problem.dims.at(-1), drive);
  assert.deepEqual(drive.children.map((p) => p.title), titles);
  assert.equal(drive.note, 'How the car is powered.');
  assert.equal(drive.children[3].note, 'Petrol and electric.');
  assert.deepEqual(drive.children[3].tags, ['later']);
  assert.ok(drive.children.every((p) => p.picks.length === 0));
  assert.deepEqual(optionProfile(s, 1).map((r) => r.dim.title), solutionTitles);
  assert.equal(findNode(s, drive.uid).section, 'problem');
  // the file reflects the move and parses back the same
  const md = serialize(s);
  assert.match(md, /# Problem[\s\S]*## Drivetrain[\s\S]*# Solution/);
  assert.deepEqual(serialize(parse(md).space), md);
});

test('a problem dimension moves to the solution; marks are dropped', () => {
  const s = car();
  const market = s.problem.dims[0];
  assert.deepEqual(moveLosses(market), { marks: 2, picks: 0 });
  moveDimensionToSection(s, market.uid, 'solution');
  assert.equal(s.problem.dims.includes(market), false);
  assert.equal(s.solution.dims.at(-1), market);
  assert.ok(market.children.every((p) => p.mark === null));
  assert.deepEqual(moveLosses(market), { marks: 0, picks: 0 });
});

test('moving a dimension to its own section, a parameter or an unknown uid does nothing', () => {
  const s = car();
  const before = clone(s);
  const dim = s.problem.dims[0];
  assert.equal(moveDimensionToSection(s, dim.uid, 'problem'), null);
  assert.equal(moveDimensionToSection(s, dim.children[0].uid, 'solution'), null);
  assert.equal(moveDimensionToSection(s, 'nope', 'solution'), null);
  assert.equal(moveDimensionToSection(s, dim.uid, 'options'), null);
  assert.deepEqual(s, before);
});
