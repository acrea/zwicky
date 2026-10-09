import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize, fileName, normNote } from '../src/js/format.js';
import { createSpace, addDimension, addParameter, addOption, addCriterion, setRating } from '../src/js/model.js';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const read = (name) => readFileSync(examples + name, 'utf8');
const canonical = readdirSync(examples).filter((f) => f.endsWith('.zwicky.md') && !f.startsWith('messy'));

const roundTrip = (text) => serialize(parse(text).space);

// ---------------------------------------------------------------- fixtures

test('there are canonical fixtures', () => {
  assert.ok(canonical.length >= 2, canonical.join(', '));
});

for (const name of canonical) {
  test(`fixture ${name}: empty report and byte-identical round trip`, () => {
    const text = read(name);
    const { space, report } = parse(text);
    assert.deepEqual(report, []);
    assert.equal(serialize(space), text);
  });
}

test('car concept: parsed content', () => {
  const { space } = parse(read('car-concept.zwicky.md'));
  assert.equal(space.meta.title, 'Car Concept (demo)');
  assert.deepEqual(space.meta.scale, { min: 1, max: 5 });
  assert.equal(space.problem.note, 'Which new car concept should we bring to market next?');
  const market = space.problem.dims[0];
  assert.equal(market.title, 'Market');
  assert.deepEqual(
    market.children.map((p) => [p.title, p.mark]),
    [
      ['Urban commuters', 'focus'],
      ['Families', null],
      ['Long-distance travellers', null],
      ['Luxury segment', 'out'],
    ],
  );
  const target = space.solution.dims.find((d) => d.title === 'Target group');
  assert.deepEqual(target.children.find((p) => p.title === 'LOHAS').picks, [1]);
  assert.equal(target.children[0].note, 'High Net Worth Individuals.');
  assert.deepEqual(
    space.options.items.map((o) => [o.id, o.title]),
    [
      [1, 'Athletic hybrid SUV'],
      [2, 'City coupé'],
      [3, 'Family hauler'],
    ],
  );
  assert.deepEqual(
    space.criteria.items.map((c) => [c.id, c.weight]),
    [
      [1, 3],
      [2, 2],
      [3, 1],
    ],
  );
  assert.deepEqual(space.ratings.cells.O1.C1, {
    score: 4,
    note: 'Two target groups; assumes LOHAS and WOOPIEs overlap little.',
    tags: [],
  });
  assert.equal(space.ratings.cells.O3.C3, undefined);
});

test('car concept: several picks in one dimension, none in another', () => {
  const { space } = parse(read('car-concept.zwicky.md'));
  const target = space.solution.dims.find((d) => d.title === 'Target group');
  assert.deepEqual(
    target.children.filter((p) => p.picks.includes(1)).map((p) => p.title),
    ['LOHAS', 'WOOPIEs'],
  );
  assert.ok(target.children.every((p) => !p.picks.includes(3)));
});

test('slide generator: a problem space without a solution space', () => {
  const { space } = parse(read('slide-generator.zwicky.md'));
  assert.equal(space.problem.dims.length, 12);
  assert.equal(space.solution.dims.length, 0);
  assert.equal(space.options.items.length, 0);
});

// ---------------------------------------------------------------- tolerant reader

test('messy input reads to the expected canonical output', () => {
  const input = read('messy-input.md');
  assert.ok(input.startsWith('\uFEFF'), 'fixture keeps its BOM');
  assert.ok(input.includes('\r\n'), 'fixture keeps CRLF line endings');
  assert.match(input, / +\r\n/, 'fixture keeps trailing spaces');
  const { space, report } = parse(input);
  assert.equal(serialize(space), read('messy-expected.zwicky.md'));

  const expected = [
    [13, /Unknown tag "draft"/],
    [14, /Unknown tag "beta"/],
    [15, /Unknown option O7/],
    [19, /Title "Budget \{in CHF\}" may not end in \{…\}; read as "Budget \(in CHF\)"/],
    [23, /Sub-dimension "Mit Einschränkung" flattened/],
    [27, /kept under # Notes/],
    [29, /Duplicate pick O1/],
    [37, /Duplicate id O2; re-assigned as O3/],
    [38, /without an id; assigned O4/],
    [42, /Weight 12 .* set to 10/],
    [43, /Duplicate id C1; re-assigned as C2/],
    [45, /without an id; assigned C3/],
    [46, /Unknown section "# Appendix"/],
    [50, /Score 7 .* set to 5/],
    [51, /Score 0 .* set to 1/],
    [53, /unknown criterion C9/],
    [58, /unknown option O8/],
  ];
  assert.equal(report.length, expected.length, JSON.stringify(report, null, 1));
  expected.forEach(([line, re], i) => {
    assert.equal(report[i].line, line, report[i].message);
    assert.match(report[i].message, re);
  });
});

test('messy expected output is itself canonical', () => {
  const text = read('messy-expected.zwicky.md');
  assert.equal(roundTrip(text), text);
});

test('+ and * bullets, any indentation of item notes', () => {
  const { space, report } = parse('---\nzwicky: 1\n---\n# Problem\n## D\n* a\n+ b\n> note of b\n    - c\n');
  assert.deepEqual(report, []);
  assert.deepEqual(
    space.problem.dims[0].children.map((p) => [p.title, p.note]),
    [
      ['a', ''],
      ['b', 'note of b'],
      ['c', ''],
    ],
  );
});

test('blank and bare ">" lines inside notes', () => {
  const src = '---\nzwicky: 1\n---\n\n# Problem\n> one\n>\n> three\n\n## D\n- p\n\n  > after a blank line\n\n  > second group\n';
  const { space } = parse(src);
  assert.equal(space.problem.note, 'one\n\nthree');
  assert.equal(space.problem.dims[0].children[0].note, 'after a blank line\n\nsecond group');
  assert.equal(
    serialize(space),
    '---\nzwicky: 1\nscale: 1-5\n---\n\n# Problem\n> one\n>\n> three\n\n## D\n- p\n  > after a blank line\n  >\n  > second group\n',
  );
});

test('missing sections and no front matter', () => {
  const { space, report } = parse('## Lonely heading\n- item\n');
  assert.ok(space);
  assert.equal(report[0].level, 'info');
  assert.match(report[0].message, /No front matter/);
  assert.match(report[1].message, /Heading outside a known section/);
  assert.deepEqual(space.passthrough, ['## Lonely heading', '- item']);
});

test('front matter: unknown keys keep their order, duplicate keys warn, bad scale falls back', () => {
  const src = '---\nb: 2\nzwicky: 1\na: x: y\nscale: five\nb: 3\n---\n';
  const { space, report } = parse(src);
  assert.deepEqual(space.meta.extra, [
    ['b', '3'],
    ['a', 'x: y'],
  ]);
  assert.deepEqual(space.meta.scale, { min: 1, max: 5 });
  assert.ok(report.some((r) => /Scale "five"/.test(r.message)));
  assert.ok(report.some((r) => /Duplicate front matter key "b"/.test(r.message)));
  assert.equal(serialize(space), '---\nzwicky: 1\nscale: 1-5\nb: 3\na: x: y\n---\n');
});

test('a newer format version is refused, not misread', () => {
  const { space, report } = parse('---\nzwicky: 2\ntitle: Future\n---\n# Problem\n');
  assert.equal(space, null);
  assert.equal(report[0].level, 'error');
  assert.match(report[0].message, /version 2/);
});

test('both marks on one parameter keep the first', () => {
  const { space, report } = parse('---\nzwicky: 1\n---\n# Problem\n## D\n- p {out focus}\n');
  assert.equal(space.problem.dims[0].children[0].mark, 'out');
  assert.match(report[0].message, /both "out" and "focus"/);
});

test('marks in the solution and picks in the problem are kept as unknown tags', () => {
  const src = '---\nzwicky: 1\nscale: 1-5\n---\n\n# Problem\n\n## D\n- p {O1}\n\n# Solution\n\n## D\n- s {focus}\n\n# Options\n\n## O1 A\n';
  const { space, report } = parse(src);
  assert.equal(report.length, 2);
  assert.equal(serialize(space), src);
});

test('rating values: "?", empty, decimals and custom scales', () => {
  const src =
    '---\nzwicky: 1\nscale: 0-10\n---\n# Options\n## O1 A\n# Criteria\n## C1 X\n## C2 Y\n## C3 Z\n# Ratings\n## O1 A\n- C1: 10\n- C2: 3.5\n  > why\n- C3:\n';
  const { space, report } = parse(src);
  assert.deepEqual(space.meta.scale, { min: 0, max: 10 });
  assert.equal(space.ratings.cells.O1.C1.score, 10);
  assert.deepEqual(space.ratings.cells.O1.C2, { score: null, note: 'why', tags: [] });
  assert.equal(space.ratings.cells.O1.C3, undefined);
  assert.match(report[0].message, /"3.5" is not a whole number/);
  assert.match(serialize(space), /- C2: \?\n  > why\n$/);
});

test('ratings headings without an id are dropped with a report', () => {
  const src = '---\nzwicky: 1\n---\n# Options\n## O1 A\n# Criteria\n## C1 X\n# Ratings\n## A\n- C1: 3\n';
  const { space, report } = parse(src);
  assert.deepEqual(space.ratings.cells, {});
  assert.match(report[0].message, /has no option id/);
});

test('### without a parent dimension becomes a dimension; deeper headings are passthrough', () => {
  const { space, report } = parse('---\nzwicky: 1\n---\n# Solution\n### Sub\n- a\n#### Deep\n');
  assert.equal(space.solution.dims[0].title, 'Sub');
  assert.match(report[0].message, /no parent dimension/);
  assert.deepEqual(space.passthrough, ['#### Deep']);
});

test('the example from the brief: ### flattening with a note', () => {
  const src = '---\nzwicky: 1\n---\n# Problem\n## Slide-Typen\n* Ohne Einschränkung\n### Mit Einschränkung\n> Nur Slides mit vorgängig definiertem Template.\n* Strukturelle Slides\n* Offerten-Slides\n';
  assert.equal(
    roundTrip(src),
    '---\nzwicky: 1\nscale: 1-5\n---\n\n# Problem\n\n## Slide-Typen\n> Mit Einschränkung: Nur Slides mit vorgängig definiertem Template.\n- Ohne Einschränkung\n- Mit Einschränkung › Strukturelle Slides\n- Mit Einschränkung › Offerten-Slides\n',
  );
});

test('parsing never throws on garbage', () => {
  const samples = [
    '',
    '\uFEFF',
    '---',
    '---\n---',
    '---\nzwicky: x\n',
    '# Ratings\n- C1: 3\n> stray',
    '{}{}{}\n- {\n## {focus}\n',
    '\r\r\r# Problem\r## D\r- x {out}\r',
    '> > > nested\n# Options\n## O0 zero\n## O-1\n## O1x\n',
    '## \\{x}\n# Criteria\n## C1 {w=abc w=-3}\n',
  ];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const atoms = ['#', '##', '###', '- ', '* ', '> ', '  > ', '{', '}', '\\', 'O1', 'C2', ':', ' ', '\n', '\r\n', 'w=3', 'focus', '---', 'ä', '?'];
  for (let i = 0; i < 300; i++) {
    let s = '';
    for (let j = 0; j < 60; j++) s += atoms[Math.floor(rnd() * atoms.length)];
    samples.push(s);
  }
  for (const s of samples) {
    const { space, report } = parse(s);
    assert.ok(Array.isArray(report));
    assert.ok(report.every((r) => r.level !== 'error' || /version/.test(r.message)), JSON.stringify(report));
    if (space) {
      const once = serialize(space);
      assert.equal(serialize(parse(once).space), once, `not idempotent for ${JSON.stringify(s)}`);
    }
  }
});

// ---------------------------------------------------------------- canonical writer

test('serialize(parse(serialize(s))) === serialize(s) for an edited space', () => {
  const s = createSpace('  Edited\nspace  ');
  const d = addDimension(s, 'problem', 0, 'Dim {x}');
  addParameter(s, d.uid, 0, '{focus}').mark = 'focus';
  addParameter(s, d.uid, 1, 'ends with \\{y}');
  addParameter(s, d.uid, 2, '  spaced  \n title ');
  const p = addParameter(s, d.uid, 3, 'with note');
  p.note = '\n\n  indented  \r\nline two   \n\n';
  const o = addOption(s, 'Opt {beta}');
  const c = addCriterion(s, '');
  c.weight = 0;
  setRating(s, o.id, c.id, { score: 9 });
  const once = serialize(s);
  assert.equal(serialize(parse(once).space), once);
  assert.equal(parse(once).report.length, 0, JSON.stringify(parse(once).report));
  const back = parse(once).space;
  assert.equal(back.meta.title, 'Edited space');
  assert.deepEqual(
    back.problem.dims[0].children.map((x) => x.title),
    ['(focus)', 'ends with \\{y}', 'spaced title', 'with note'],
  );
  assert.equal(back.problem.dims[0].title, 'Dim (x)');
  assert.equal(back.problem.dims[0].children[0].mark, 'focus');
  assert.equal(back.problem.dims[0].children[3].note, '  indented\nline two');
  assert.equal(back.options.items[0].title, 'Opt (beta)');
  assert.equal(back.ratings.cells.O1.C1.score, 5);
});

test('titles never end in a {…} group; braces elsewhere stay', () => {
  const s = createSpace();
  const d = addDimension(s, 'problem');
  for (const t of ['a {b}', 'a{b}', '{b} a', 'Set {a, b} of tags', 'x {}', '{x}']) addParameter(s, d.uid, Infinity, t);
  const out = serialize(s);
  assert.match(out, /\n- a \(b\)\n- a\{b\}\n- \{b\} a\n- Set \{a, b\} of tags\n- x \(\)\n- \(x\)\n/);
  assert.equal(roundTrip(out), out);
  assert.deepEqual(parse(out).report, []);
});

test('a trailing {…} after the tag group is read as part of the title and fixed', () => {
  const { space, report } = parse('---\nzwicky: 1\n---\n# Problem\n## D\n- Budget {in CHF} {focus}\n');
  const p = space.problem.dims[0].children[0];
  assert.equal(p.title, 'Budget (in CHF)');
  assert.equal(p.mark, 'focus');
  assert.equal(report.length, 1);
  assert.equal(report[0].level, 'info');
});

test('empty space', () => {
  const out = serialize(createSpace());
  assert.equal(out, '---\nzwicky: 1\nscale: 1-5\n---\n');
  assert.equal(roundTrip(out), out);
});

test('canonical form: LF, no trailing spaces, single trailing newline, blank line before every # and ##', () => {
  const out = roundTrip(read('messy-input.md'));
  assert.ok(!out.includes('\r'));
  assert.ok(!/[ \t]$/m.test(out));
  assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'));
  const lines = out.split('\n');
  const notesStart = lines.indexOf('# Notes');
  lines.slice(0, notesStart).forEach((l, i) => {
    if (/^#{1,2} /.test(l)) assert.equal(lines[i - 1], '', `line ${i + 1}`);
    if (l === '' && i > 0) assert.match(lines[i + 1], /^#{1,2} /, `blank line ${i + 1}`);
  });
});

test('untrusted text stays literal', () => {
  const s = createSpace('<img src=x onerror=alert(1)>');
  const d = addDimension(s, 'solution', 0, '<script>alert(1)</script>');
  addParameter(s, d.uid, 0, '<img src=x onerror=alert(1)>').note = '<b>bold</b>';
  const back = parse(serialize(s)).space;
  assert.equal(back.meta.title, '<img src=x onerror=alert(1)>');
  assert.equal(back.solution.dims[0].title, '<script>alert(1)</script>');
  assert.equal(back.solution.dims[0].children[0].note, '<b>bold</b>');
});

test('normNote and fileName', () => {
  assert.equal(normNote(' \n a  \r\n\n b \n\n'), ' a\n\n b');
  assert.equal(fileName('Slide-Generator (intern)'), 'slide-generator-intern.zwicky.md');
  assert.equal(fileName('Größe & Übersicht'), 'grosse-ubersicht.zwicky.md');
  assert.equal(fileName(''), 'untitled.zwicky.md');
});
