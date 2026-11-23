import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skillDoc, readVersion } from '../build.mjs';
import { parse, serialize } from '../src/js/format.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const skill = skillDoc();

test('skill: front matter has a valid name and description', () => {
  const m = /^---\nname: (.*)\ndescription: (.*)\n---\n/.exec(skill);
  assert.ok(m, 'front matter with name and description');
  assert.equal(m[1], 'zwicky');
  assert.ok(m[2].length > 0 && m[2].length <= 1024, `description is ${m[2].length} characters`);
  assert.doesNotMatch(m[2], /[<>]/, 'no angle brackets in the description');
});

test('skill: carries the version, the full specification and the example', () => {
  assert.ok(skill.includes(`zwicky ${readVersion()}`));
  assert.ok(skill.includes(read('docs/FORMAT.md').trimEnd()));
  assert.doesNotMatch(skill, /\{\{VERSION\}\}|<!-- @(EXAMPLE|FORMAT) -->/);
});

test('skill: its example file is canonical', () => {
  const example = /## A complete canonical file\n\n```markdown\n([\s\S]*?)```\n/.exec(skill)[1];
  const { space, report } = parse(example);
  assert.deepEqual(report, []);
  assert.equal(serialize(space), example);
});

test('skill: the committed dist/skill/SKILL.md is up to date', () => {
  assert.equal(read('dist/skill/SKILL.md'), skill, "run 'node build.mjs'");
});
