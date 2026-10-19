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
  assert.equal(space.problem, 'Which new car concept should we bring to market next?');
  assert.deepEqual(
    space.dims[0].params.map((p) => [p.title, p.mark, p.picks]),
    [['Existing platform', 'fixed', []]],
  );
  assert.equal(space.dims[0].params[0].note, 'Board decision: no new platform before the next model cycle.');
  const drive = space.dims.find((d) => d.title === 'Drivetrain');
  assert.deepEqual(
    drive.params.map((p) => [p.title, p.mark, p.picks]),
    [
      ['Petrol 100–200 hp', null, []],
      ['Petrol 200–300 hp', null, []],
      ['Diesel', null, [3]],
      ['Hybrid', null, [1]],
      ['Hydrogen', 'out', []],
      ['Electric', null, [2, 4, 5]],
    ],
  );
  const target = space.dims.find((d) => d.title === 'Target group');
  assert.equal(target.params[0].note, 'High Net Worth Individuals. Covered by our sister brand.');
  assert.deepEqual(
    space.options.map((o) => [o.id, o.title, o.extends]),
    [
      [1, 'Athletic hybrid SUV', null],
      [2, 'City coupé', null],
      [4, 'City coupé with rail partnership', 2],
      [5, 'Long-distance coupé', 4],
      [3, 'Family hauler', null],
    ],
  );
  assert.deepEqual(
    space.criteria.map((c) => [c.id, c.weight]),
    [
      [1, 3],
      [2, 2],
      [3, 1],
    ],
  );
  assert.deepEqual(space.ratings.O1.C1, {
    score: 4,
    note: 'Two target groups; assumes LOHAS and WOOPIEs overlap little.',
    tags: [],
  });
  assert.equal(space.ratings.O3.C3, undefined);
});

test('car concept: several picks in one dimension, none in another', () => {
  const { space } = parse(read('car-concept.zwicky.md'));
  const target = space.dims.find((d) => d.title === 'Target group');
  assert.deepEqual(
    target.params.filter((p) => p.picks.includes(1)).map((p) => p.title),
    ['LOHAS', 'WOOPIEs'],
  );
  const front = space.dims.find((d) => d.title === 'Front design');
  assert.ok(front.params.every((p) => !p.picks.includes(2)));
});

test('slide generator: a box with options but no evaluation yet', () => {
  const { space } = parse(read('slide-generator.zwicky.md'));
  assert.equal(space.dims.length, 12);
  assert.deepEqual(
    space.dims.slice(0, 2).map((d) => d.params.map((p) => p.mark)),
    [['fixed'], ['fixed']],
  );
  assert.equal(space.options.length, 2);
  assert.equal(space.criteria.length, 0);
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
    [10, /# Problem holds only the problem statement/],
    [12, /Only # Problem takes a note; a note under # Box/],
    [16, /Unknown tag "draft"/],
    [17, /Unknown tag "beta"/],
    [18, /Unknown option O7/],
    [22, /Title "Budget \{in CHF\}" may not end in \{…\}; read as "Budget \(in CHF\)"/],
    [23, /is fixed, so it counts for every option; picks O1 dropped/],
    [24, /both "out" and "fixed"; kept "out"/],
    [28, /Sub-dimension "Mit Einschränkung" flattened/],
    [32, /kept under # Notes/],
    [34, /Duplicate pick O1/],
    [39, /O1 cannot extend O1/],
    [41, /extends more than one option; "extends=O3" dropped/],
    [42, /Duplicate id O2; re-assigned as O3/],
    [42, /Unknown option O9; "extends" dropped/],
    [43, /without an id; assigned O4/],
    [47, /Weight 12 .* set to 10/],
    [48, /Duplicate id C1; re-assigned as C2/],
    [50, /without an id; assigned C3/],
    [51, /Unknown section "# Appendix"/],
    [55, /Score 7 .* set to 5/],
    [56, /Score 0 .* set to 1/],
    [58, /unknown criterion C9/],
    [63, /unknown option O8/],
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
  const { space, report } = parse('---\nzwicky: 2\n---\n# Box\n## D\n* a\n+ b\n> note of b\n    - c\n');
  assert.deepEqual(report, []);
  assert.deepEqual(
    space.dims[0].params.map((p) => [p.title, p.note]),
    [
      ['a', ''],
      ['b', 'note of b'],
      ['c', ''],
    ],
  );
});

test('blank and bare ">" lines inside notes', () => {
  const src = '---\nzwicky: 2\n---\n\n# Problem\n> one\n>\n> three\n\n# Box\n## D\n- p\n\n  > after a blank line\n\n  > second group\n';
  const { space } = parse(src);
  assert.equal(space.problem, 'one\n\nthree');
  assert.equal(space.dims[0].params[0].note, 'after a blank line\n\nsecond group');
  assert.equal(
    serialize(space),
    '---\nzwicky: 2\nscale: 1-5\n---\n\n# Problem\n> one\n>\n> three\n\n# Box\n\n## D\n- p\n  > after a blank line\n  >\n  > second group\n',
  );
});

test('missing sections and no front matter', () => {
  const { space, report } = parse('## Lonely heading\n- item\n');
  assert.ok(space);
  assert.equal(report[0].level, 'info');
  assert.match(report[0].message, /No front matter; read as zwicky format version 2/);
  assert.match(report[1].message, /Heading outside a known section/);
  assert.deepEqual(space.passthrough, ['## Lonely heading', '- item']);
});

test('front matter: unknown keys keep their order, duplicate keys warn, bad scale falls back', () => {
  const src = '---\nb: 2\nzwicky: 2\na: x: y\nscale: five\nb: 3\n---\n';
  const { space, report } = parse(src);
  assert.deepEqual(space.meta.extra, [
    ['b', '3'],
    ['a', 'x: y'],
  ]);
  assert.deepEqual(space.meta.scale, { min: 1, max: 5 });
  assert.ok(report.some((r) => /Scale "five"/.test(r.message)));
  assert.ok(report.some((r) => /Duplicate front matter key "b"/.test(r.message)));
  assert.equal(serialize(space), '---\nzwicky: 2\nscale: 1-5\nb: 3\na: x: y\n---\n');
});

test('other format versions are refused, not misread', () => {
  const newer = parse('---\nzwicky: 3\ntitle: Future\n---\n# Box\n');
  assert.equal(newer.space, null);
  assert.equal(newer.report[0].level, 'error');
  assert.match(newer.report[0].message, /version 3; this app reads version 2/);
  const older = parse('---\nzwicky: 1\n---\n# Problem\n## Market\n- Commuters {focus}\n');
  assert.equal(older.space, null);
  assert.match(older.report[0].message, /version 1, from an older zwicky/);
  const invalid = parse('---\nzwicky: two\n---\n');
  assert.ok(invalid.space);
  assert.match(invalid.report[0].message, /"two" is not valid; read as version 2/);
});

test('marks: fixed and out, exclusive, the first one wins; marked parameters carry no picks', () => {
  const src = '---\nzwicky: 2\n---\n# Box\n## D\n- a {fixed}\n- b {out}\n- c {out fixed}\n- d {fixed O1 later}\n- e {O1}\n# Options\n## O1 X\n';
  const { space, report } = parse(src);
  assert.deepEqual(
    space.dims[0].params.map((p) => [p.mark, p.picks, p.tags]),
    [
      ['fixed', [], []],
      ['out', [], []],
      ['out', [], []],
      ['fixed', [], ['later']],
      [null, [1], []],
    ],
  );
  assert.ok(report.some((r) => r.line === 8 && /both "out" and "fixed"; kept "out"/.test(r.message)));
  assert.ok(report.some((r) => r.line === 9 && /picks O1 dropped/.test(r.message)));
  assert.match(serialize(space), /\n- a \{fixed\}\n- b \{out\}\n- c \{out\}\n- d \{fixed later\}\n- e \{O1\}\n/);
});

test('# Problem holds only the statement; other sections hold no note', () => {
  const src = '---\nzwicky: 2\n---\n# Problem\n> Why?\n## Market\n- a\n# Options\n> Options note.\n## O1 X\n';
  const { space, report } = parse(src);
  assert.equal(space.problem, 'Why?');
  assert.equal(space.dims.length, 0);
  assert.deepEqual(space.passthrough, ['## Market', '- a', '', '> Options note.']);
  assert.equal(report.length, 2);
  assert.match(report[1].message, /a note under # Options is not used/);
});

test('an empty problem statement and an empty box are not written', () => {
  const s = createSpace();
  s.problem = '  \n ';
  addOption(s, 'Lonely');
  assert.equal(serialize(s), '---\nzwicky: 2\nscale: 1-5\n---\n\n# Options\n\n## O1 Lonely\n');
});

test('rating values: "?", empty, decimals and custom scales', () => {
  const src =
    '---\nzwicky: 2\nscale: 0-10\n---\n# Options\n## O1 A\n# Criteria\n## C1 X\n## C2 Y\n## C3 Z\n# Ratings\n## O1 A\n- C1: 10\n- C2: 3.5\n  > why\n- C3:\n';
  const { space, report } = parse(src);
  assert.deepEqual(space.meta.scale, { min: 0, max: 10 });
  assert.equal(space.ratings.O1.C1.score, 10);
  assert.deepEqual(space.ratings.O1.C2, { score: null, note: 'why', tags: [] });
  assert.equal(space.ratings.O1.C3, undefined);
  assert.match(report[0].message, /"3.5" is not a whole number/);
  assert.match(serialize(space), /- C2: \?\n  > why\n$/);
});

test('ratings headings without an id are dropped with a report', () => {
  const src = '---\nzwicky: 2\n---\n# Options\n## O1 A\n# Criteria\n## C1 X\n# Ratings\n## A\n- C1: 3\n';
  const { space, report } = parse(src);
  assert.deepEqual(space.ratings, {});
  assert.match(report[0].message, /has no option id/);
});

test('### without a parent dimension becomes a dimension; deeper headings are passthrough', () => {
  const { space, report } = parse('---\nzwicky: 2\n---\n# Box\n### Sub\n- a\n#### Deep\n');
  assert.equal(space.dims[0].title, 'Sub');
  assert.match(report[0].message, /no parent dimension/);
  assert.deepEqual(space.passthrough, ['#### Deep']);
});

test('### sub-dimensions are flattened, with their note', () => {
  const src = '---\nzwicky: 2\n---\n# Box\n## Slide-Typen\n* Ohne Einschränkung\n### Mit Einschränkung\n> Nur Slides mit vorgängig definiertem Template.\n* Strukturelle Slides\n* Offerten-Slides\n';
  assert.equal(
    roundTrip(src),
    '---\nzwicky: 2\nscale: 1-5\n---\n\n# Box\n\n## Slide-Typen\n> Mit Einschränkung: Nur Slides mit vorgängig definiertem Template.\n- Ohne Einschränkung\n- Mit Einschränkung › Strukturelle Slides\n- Mit Einschränkung › Offerten-Slides\n',
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
    '{}{}{}\n- {\n## {fixed}\n',
    '\r\r\r# Box\r## D\r- x {out}\r',
    '> > > nested\n# Options\n## O0 zero\n## O-1\n## O1x\n',
    '## \\{x}\n# Criteria\n## C1 {w=abc w=-3}\n',
  ];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const atoms = ['#', '##', '###', '- ', '* ', '> ', '  > ', '{', '}', '\\', 'O1', 'C2', ':', ' ', '\n', '\r\n', 'w=3', 'fixed', 'out', 'Box', 'Problem', '---', 'ä', '?'];
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
  s.problem = 'What do we solve?';
  const d = addDimension(s, 0, 'Dim {x}');
  addParameter(s, d.uid, 0, '{fixed}').mark = 'fixed';
  addParameter(s, d.uid, 1, 'ends with \\{y}');
  addParameter(s, d.uid, 2, '  spaced  \n title ');
  const p = addParameter(s, d.uid, 3, 'with note');
  p.note = '\n\n  indented  \r\nline two   \n\n';
  const o = addOption(s, 'Opt {beta}');
  p.picks.push(o.id);
  const c = addCriterion(s, '');
  c.weight = 0;
  setRating(s, o.id, c.id, { score: 9 });
  const once = serialize(s);
  assert.equal(serialize(parse(once).space), once);
  assert.equal(parse(once).report.length, 0, JSON.stringify(parse(once).report));
  const back = parse(once).space;
  assert.equal(back.meta.title, 'Edited space');
  assert.equal(back.problem, 'What do we solve?');
  assert.deepEqual(
    back.dims[0].params.map((x) => x.title),
    ['(fixed)', 'ends with \\{y}', 'spaced title', 'with note'],
  );
  assert.equal(back.dims[0].title, 'Dim (x)');
  assert.equal(back.dims[0].params[0].mark, 'fixed');
  assert.equal(back.dims[0].params[3].note, '  indented\nline two');
  assert.deepEqual(back.dims[0].params[3].picks, [1]);
  assert.equal(back.options[0].title, 'Opt (beta)');
  assert.equal(back.ratings.O1.C1.score, 5);
});

test('titles never end in a {…} group; braces elsewhere stay', () => {
  const s = createSpace();
  const d = addDimension(s);
  for (const t of ['a {b}', 'a{b}', '{b} a', 'Set {a, b} of tags', 'x {}', '{x}']) addParameter(s, d.uid, Infinity, t);
  const out = serialize(s);
  assert.match(out, /\n- a \(b\)\n- a\{b\}\n- \{b\} a\n- Set \{a, b\} of tags\n- x \(\)\n- \(x\)\n/);
  assert.equal(roundTrip(out), out);
  assert.deepEqual(parse(out).report, []);
});

test('a trailing {…} after the tag group is read as part of the title and fixed', () => {
  const { space, report } = parse('---\nzwicky: 2\n---\n# Box\n## D\n- Budget {in CHF} {out}\n');
  const p = space.dims[0].params[0];
  assert.equal(p.title, 'Budget (in CHF)');
  assert.equal(p.mark, 'out');
  assert.equal(report.length, 1);
  assert.equal(report[0].level, 'info');
});

test('empty space', () => {
  const out = serialize(createSpace());
  assert.equal(out, '---\nzwicky: 2\nscale: 1-5\n---\n');
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
  s.problem = '<script>alert(2)</script>';
  const d = addDimension(s, 0, '<script>alert(1)</script>');
  addParameter(s, d.uid, 0, '<img src=x onerror=alert(1)>').note = '<b>bold</b>';
  const back = parse(serialize(s)).space;
  assert.equal(back.meta.title, '<img src=x onerror=alert(1)>');
  assert.equal(back.problem, '<script>alert(2)</script>');
  assert.equal(back.dims[0].title, '<script>alert(1)</script>');
  assert.equal(back.dims[0].params[0].note, '<b>bold</b>');
});

test('normNote and fileName', () => {
  assert.equal(normNote(' \n a  \r\n\n b \n\n'), ' a\n\n b');
  assert.equal(fileName('Slide-Generator (intern)'), 'slide-generator-intern.zwicky.md');
  assert.equal(fileName('Größe & Übersicht'), 'grosse-ubersicht.zwicky.md');
  assert.equal(fileName(''), 'untitled.zwicky.md');
});

// ---------------------------------------------------------------- extensions

test('options carry {extends=O<n>}; it is written first, before unknown tags', () => {
  const text = [
    '---',
    'zwicky: 2',
    'scale: 1-5',
    '---',
    '',
    '# Options',
    '',
    '## O1 Small start',
    '',
    '## O2 Next step {extends=O1 later}',
    '',
    '## O3 Third step {extends=O2}',
    '',
  ].join('\n');
  const { space, report } = parse(text);
  assert.deepEqual(report.filter((r) => r.level !== 'info'), []);
  assert.deepEqual(space.options.map((o) => [o.extends, o.tags]), [[null, []], [1, ['later']], [2, []]]);
  assert.equal(serialize(space), text);
});

test('a link to an unknown option, to itself or in a loop is dropped with a report', () => {
  const { space, report } = parse('---\nzwicky: 2\n---\n# Options\n## O1 A {extends=O2}\n## O2 B {extends=O1}\n## O3 C {extends=O3}\n## O4 D {extends=O7}\n');
  assert.deepEqual(space.options.map((o) => o.extends), [2, null, null, null]);
  assert.match(report.find((r) => r.line === 6).message, /O2 cannot extend O1/);
  assert.match(report.find((r) => r.line === 7).message, /O3 cannot extend O3/);
  assert.match(report.find((r) => r.line === 8).message, /Unknown option O7/);
});

test('a link to a deleted option is not written', () => {
  const { space } = parse('---\nzwicky: 2\n---\n# Options\n## O1 A\n## O2 B {extends=O1}\n');
  space.options.shift();
  assert.doesNotMatch(serialize(space), /extends/);
});

test('stages from earlier drafts are only unknown keys and tags now', () => {
  const { space, report } = parse('---\nzwicky: 2\nstages: Pilot, Rollout, Full\n---\n# Options\n## O1 X {stage=2}\n');
  assert.deepEqual(space.meta.extra, [['stages', 'Pilot, Rollout, Full']]);
  assert.deepEqual(space.options[0].tags, ['stage=2']);
  assert.ok(report.some((r) => /Unknown tag "stage=2" kept/.test(r.message)));
});
