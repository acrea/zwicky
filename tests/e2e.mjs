// Optional browser checks for dist/zwicky.html. Needs Playwright (not a project
// dependency): `npm i -g playwright`, then `node build.mjs && node tests/e2e.mjs`.
// Not picked up by `node --test`, which stays dependency-free.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return require(execSync('npm root -g').toString().trim() + '/playwright');
  }
}

const { chromium } = loadPlaywright();
const URL_ = 'file://' + fileURLToPath(new URL('../dist/zwicky.html', import.meta.url));
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (err) {
    results.push(['FAIL', name, err.message.split('\n').slice(0, 8).join(' | ')]);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => !/^(file|data|blob):/.test(r.url()) && requests.push(r.url()));
page.on('dialog', (d) => {
  if (d.type() === 'beforeunload') return d.accept(); // the unsaved-changes warning
  errors.push('native dialog: ' + d.message());
  d.dismiss();
});

const z = (fn, arg) => page.evaluate(fn, arg);
const cell = (title) => page.locator('.cell.param', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
const space = () => z(() => JSON.parse(JSON.stringify(window.zwicky.space)));
const md = () => z(() => window.zwicky.markdown());

await page.goto(URL_);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.grid');

const dim = (title) => page.locator('.cell.dim', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
const param = (s, title) => s.dims.flatMap((d) => d.params).find((p) => p.title === title);
const chip = (id) => page.locator(`.chip[data-id="${id}"]`);
const has = (title, cls) => cell(title).evaluate((el, c) => el.classList.contains(c), cls);

await check('loads the car concept demo on first launch, on the Box tab', async () => {
  assert.equal(await page.inputValue('.doc-title'), 'Car Concept (demo)');
  assert.equal(await page.locator('.cell.dim:not(.ghost)').count(), 9);
  assert.equal(await page.getAttribute('#tab-box', 'aria-selected'), 'true');
  assert.deepEqual(await page.locator('.tab').allInnerTexts(), ['Box', 'Evaluation']);
  assert.match(await page.locator('.note-band textarea').inputValue(), /Which new car concept/);
});

await check('F marks a parameter fixed, X marks it out; the marks exclude each other', async () => {
  await cell('sporty').click();
  await page.keyboard.press('f');
  assert.ok(await has('sporty', 'mark-fixed'));
  assert.equal(param(await space(), 'sporty').mark, 'fixed');
  assert.match(await page.locator('.inspector').innerText(), /Fixed: already decided/);
  await page.keyboard.press('x');
  assert.ok((await has('sporty', 'mark-out')) && !(await has('sporty', 'mark-fixed')));
  await page.keyboard.press('x');
  assert.ok(!(await has('sporty', 'mark-out')));
  assert.equal(param(await space(), 'sporty').mark, null);
  assert.match(await md(), /\n- sporty\n/);
});

await check('marking a picked parameter out asks first; cancel keeps it, confirm drops the picks', async () => {
  await cell('Electric').click();
  await page.keyboard.press('x');
  await page.locator('dialog[open]').waitFor();
  assert.match(await page.locator('dialog[open]').innerText(), /picked by O2, O4, O5/);
  await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
  assert.deepEqual([param(await space(), 'Electric').mark, param(await space(), 'Electric').picks], [null, [2, 4, 5]]);
  await page.keyboard.press('x');
  await page.getByRole('button', { name: 'Mark as out' }).click();
  await page.waitForFunction(() => window.zwicky.markdown().includes('- Electric {out}'));
  assert.deepEqual(param(await space(), 'Electric').picks, []);
  await page.keyboard.press('Control+z');
  assert.deepEqual([param(await space(), 'Electric').mark, param(await space(), 'Electric').picks], [null, [2, 4, 5]]);
});

await check('marking a picked parameter fixed needs no confirm: every option has it now', async () => {
  await cell('Diesel').click();
  await page.keyboard.press('f');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual([param(await space(), 'Diesel').mark, param(await space(), 'Diesel').picks], ['fixed', []]);
  assert.match(await page.locator('.toast').innerText(), /every option has it now/);
  await page.keyboard.press('Control+z');
  assert.deepEqual([param(await space(), 'Diesel').mark, param(await space(), 'Diesel').picks], [null, [3]]);
});

await check('fixed and out parameters cannot be picked', async () => {
  const before = await md();
  await cell('Existing platform').click();
  await page.keyboard.press('2');
  assert.match(await page.locator('.toast').innerText(), /is fixed: every option has it already/);
  await cell('Hydrogen').click();
  await page.keyboard.press('2');
  assert.match(await page.locator('.toast').innerText(), /is out: no option can pick it/);
  assert.equal(await md(), before);
  assert.equal(await page.locator('.inspector .pick-list').count(), 0, 'no "Picked by" list for a marked parameter');
});

await check('undo and redo', async () => {
  await cell('cheeky').click();
  await page.keyboard.press('f');
  await page.keyboard.press('Control+z');
  assert.ok(!(await has('cheeky', 'mark-fixed')));
  await page.keyboard.press('Control+Shift+z');
  assert.ok(await has('cheeky', 'mark-fixed'));
  await page.keyboard.press('f');
});

await check('Enter edits a title inline; Enter commits; Esc cancels', async () => {
  await cell('Families').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type(' with kids');
  await page.keyboard.press('Enter');
  await cell('Families with kids').waitFor();
  await page.keyboard.press('F2');
  await page.keyboard.type('zzz');
  await page.keyboard.press('Escape');
  await cell('Families with kids').waitFor();
});

await check('a trailing {…} typed in a title becomes (…)', async () => {
  await cell('Families with kids').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Families {2+ kids}');
  await page.keyboard.press('Enter');
  await cell('Families \\(2\\+ kids\\)').waitFor();
});

await check('arrows move the selection; printable keys do not edit a regular cell', async () => {
  await cell('aggressive').click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.cell.selected .title').innerText(), 'edgy (new edge)');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.cell.selected .title').innerText(), 'Petrol 200–300 hp');
  await page.keyboard.press('q');
  assert.equal(await page.locator('.inline-edit').count(), 0);
});

await check('typing on the ghost cell adds parameters', async () => {
  await page.locator('.row').nth(1).locator('.cell.ghost').click();
  await page.keyboard.type('Brand new');
  await page.keyboard.press('Enter');
  await cell('Brand new').waitFor();
  assert.equal(await page.locator('.cell.selected').getAttribute('data-type'), 'ghost');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await cell('Second').waitFor();
});

await check('+ Dimension adds a row; a single open parameter gets the "already decided?" hint', async () => {
  await page.locator('.ghost-row .cell').click();
  await page.keyboard.type('Regulation');
  await page.keyboard.press('Enter');
  await dim('Regulation').waitFor();
  await page.keyboard.type('EU only');
  await page.keyboard.press('Enter');
  await cell('EU only').click();
  assert.match(await page.locator('.insp-hint').innerText(), /Already decided\?/);
  await dim('Regulation').click();
  assert.equal(await page.locator('.insp-hint').count(), 1, 'the dimension shows the hint too');
  await page.locator('.insp-hint').getByRole('button', { name: 'Mark it as fixed' }).click();
  assert.ok(await has('EU only', 'mark-fixed'));
  assert.equal(await page.locator('.insp-hint').count(), 0);
});

await check('Alt+arrows move parameters and dimensions', async () => {
  await cell('Second').click();
  await page.keyboard.press('Alt+ArrowLeft');
  const s = await space();
  assert.deepEqual(s.dims[1].params.map((p) => p.title), ['Within three years', 'Second', 'Brand new']);
  await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual((await space()).dims.slice(0, 2).map((d) => d.title), ['Launch', 'Platform']);
});

await check('Delete removes without confirm when there is no note or pick', async () => {
  await cell('Second').click();
  await page.keyboard.press('Delete');
  assert.equal(await cell('Second').count(), 0);
  assert.equal(await page.locator('dialog[open]').count(), 0);
});

await check('the inspector edits the selected note; one undo step per typing session', async () => {
  await cell('Brand new').click();
  await page.locator('.inspector textarea').fill('A note\nwith two lines');
  await page.locator('.inspector textarea').blur();
  await page.waitForTimeout(50);
  assert.ok(await has('Brand new', 'has-note'));
  await cell('Brand new').click();
  await page.keyboard.press('Control+z');
  assert.ok(!(await has('Brand new', 'has-note')));
  await page.keyboard.press('Control+Shift+z');
});

await check('delete asks for a confirm when the item has a note', async () => {
  await cell('Brand new').click();
  await page.keyboard.press('Delete');
  await page.locator('dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await cell('Brand new').count(), 1);
});

await check('untrusted titles render as literal text', async () => {
  await cell('Brand new').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('<img src=x onerror=alert(1)>');
  await page.keyboard.press('Enter');
  await cell('<img src=x onerror=alert\\(1\\)>').waitFor();
  assert.equal(await page.locator('.grid img').count(), 0);
});

await check('O1 is active and drawn as a path through its picks and every fixed parameter', async () => {
  await page.waitForSelector('svg.paths polyline');
  assert.equal(await page.locator('.cell.picked').count(), 8);
  const fixed = (await space()).dims.flatMap((d) => d.params).filter((p) => p.mark === 'fixed').length;
  assert.equal(fixed, 3, 'Platform, Launch and EU only');
  assert.equal(await page.locator('svg.paths g.path.active circle').count(), 8 + fixed);
});

await check('chip click enters pick mode; clicking cells toggles picks; marked cells refuse', async () => {
  await chip(2).click();
  assert.equal(await page.locator('.pick-hint').count(), 1);
  await cell('sporty').click();
  assert.deepEqual(param(await space(), 'sporty').picks, [2]);
  await cell('sporty').click();
  assert.deepEqual(param(await space(), 'sporty').picks, []);
  await page.keyboard.press('Space');
  assert.deepEqual(param(await space(), 'sporty').picks, [2]);
  await cell('Hydrogen').click();
  assert.deepEqual(param(await space(), 'Hydrogen').picks, []);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pick-hint').count(), 0);
});

await check('digit keys toggle picks for O1–O9', async () => {
  await cell('slim').click();
  await page.keyboard.press('3');
  assert.deepEqual(param(await space(), 'slim').picks, [3]);
  assert.equal(await cell('slim').locator('.marker').innerText(), '3');
});

await check('compare draws every option; extensions are dashed, then dotted, in the colour they start from', async () => {
  await page.getByRole('button', { name: 'Compare' }).click();
  assert.equal(await page.locator('svg.paths g.path').count(), 5);
  const dashes = await page.locator('svg.paths polyline').evaluateAll((els) => els.map((el) => el.getAttribute('stroke-dasharray')).filter(Boolean));
  assert.deepEqual(dashes.sort(), ['1.5 4', '6 4'], 'O4 dashed, O5 dotted');
  const colours = await z(() => [...document.querySelectorAll('.chip[data-id]')].map((c) => [c.dataset.id, c.style.getPropertyValue('--opt')]));
  const colour = Object.fromEntries(colours);
  assert.equal(colour['4'], colour['2']);
  assert.equal(colour['5'], colour['2']);
  assert.notEqual(colour['1'], colour['2']);
  assert.match(await chip(4).innerText(), /↳ O2/);
  assert.match(await chip(5).innerText(), /↳ O4/);
  await page.getByRole('button', { name: 'Compare' }).click();
  assert.equal(await page.getByRole('button', { name: 'Line styles' }).count(), 0);
});

await check('+ Option, rename in the inspector, duplicate and delete', async () => {
  await page.locator('.chip.add').click();
  await page.keyboard.type('Robo taxi');
  await page.keyboard.press('Enter');
  // the chip label updates on the next animation frame, so wait for it
  await page.locator('.chip', { hasText: 'Robo taxi' }).waitFor({ timeout: 5000 });
  assert.match(await chip(6).innerText(), /Robo taxi/);
  await page.keyboard.press('Escape'); // leave pick mode, so a click only selects
  await cell('Electric').click();
  await page.keyboard.press('6');
  await chip(6).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.keyboard.press('Enter');
  const s = await space();
  assert.deepEqual(s.options.map((o) => o.id), [1, 2, 4, 5, 3, 6, 7], 'after duplicate: ' + JSON.stringify(s.options.map((o) => o.id)));
  assert.ok(param(s, 'Electric').picks.includes(7));
  await chip(7).click();
  await page.getByRole('button', { name: 'Delete option' }).click();
  await page.locator('dialog[open] .btn.danger').click();
  await page.waitForFunction(() => window.zwicky.space.options.length === 6); // the dialog closes asynchronously
  const s2 = await space();
  assert.deepEqual(s2.options.map((o) => o.id), [1, 2, 4, 5, 3, 6], 'after delete: ' + JSON.stringify(s2.options.map((o) => o.id)));
  assert.ok(!param(s2, 'Electric').picks.includes(7));
});

await check('evaluation: profiles list picks per dimension, fixed parameters for every option', async () => {
  await page.click('#tab-evaluation');
  await page.locator('.profile-table').waitFor();
  const cols = await page.locator('.profile-table thead .opt-head').count();
  assert.equal(cols, (await space()).options.length);
  const platform = page.locator('.profile-table tbody tr', { hasText: 'Platform' });
  assert.equal(await platform.locator('li.fixed', { hasText: 'Existing platform' }).count(), cols);
  assert.match(await page.locator('.profile-table tbody tr', { hasText: 'Front design' }).innerText(), /athletic/);
});

await check('evaluation: the profile of an extension highlights what it adds to the option it extends', async () => {
  const added = await page.locator('.profile-table li.added').allInnerTexts();
  assert.deepEqual(added.sort(), ['5', 'Rail partnership for long distance', 'WOOPIEs']);
  assert.match(await page.locator('.profile-table thead .opt-head[data-option="5"]').innerText(), /↳ O4/);
});

await check('evaluation: digits score, weights and totals update, Delete clears', async () => {
  await page.locator('[data-key="rating:3:3"]').click();
  await page.keyboard.press('2');
  let s = await space();
  assert.equal(s.ratings.O3.C3.score, 2);
  await page.keyboard.press('Delete');
  s = await space();
  assert.equal(s.ratings.O3?.C3, undefined);
  await page.locator('[data-key="weight:1"]').click();
  await page.keyboard.press('1');
  await page.keyboard.press('0');
  s = await space();
  assert.equal(s.criteria[0].weight, 10);
  // O1: (10*4 + 2*3 + 1*5) / 13 = 3.9
  assert.equal(await page.locator('.total-row td').first().locator('.total-val').innerText(), '3.9');
  assert.equal(await page.locator('.rank-row td').first().innerText(), '1st');
});

await check('evaluation: add a criterion from the ghost row and reorder with Alt+Up', async () => {
  await page.locator('.ecell.ghost').click();
  await page.keyboard.type('Cost of ownership');
  await page.keyboard.press('Enter');
  let s = await space();
  assert.equal(s.criteria.at(-1).title, 'Cost of ownership');
  await page.locator('[data-key="crit:4"]').click();
  await page.keyboard.press('Alt+ArrowUp');
  s = await space();
  assert.deepEqual(s.criteria.map((c) => c.id), [1, 2, 4, 3]);
});

await check('evaluation: Enter on a rating writes its note in the inspector', async () => {
  await page.locator('[data-key="rating:2:1"]').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Assumes a dealer network.');
  await page.locator('[data-key="rating:2:2"]').click();
  const s = await space();
  assert.equal(s.ratings.O1.C2.note, 'Assumes a dealer network.');
  assert.equal(s.ratings.O1.C2.score, 3);
  assert.ok(await page.locator('[data-key="rating:2:1"]').evaluate((el) => el.classList.contains('has-note')));
});

await check('evaluation: sort by rank and show all notes are view-only', async () => {
  const before = JSON.stringify((await space()).options.map((o) => o.id));
  await page.getByRole('button', { name: 'Sort options by rank' }).click();
  await page.getByRole('button', { name: 'Show all notes' }).click();
  assert.ok((await page.locator('.cell-note').count()) >= 3);
  assert.equal(JSON.stringify((await space()).options.map((o) => o.id)), before);
  const ranks = await page.locator('.rank-row td').allInnerTexts();
  assert.equal(ranks[0], '1st');
  await page.getByRole('button', { name: 'Sort options by rank' }).click();
  await page.getByRole('button', { name: 'Show all notes' }).click();
});

await check('print view: one section per tab, the problem statement, paths, footnotes', async () => {
  const info = await z(() => {
    window.zwicky.activateOption(1); // the print shows the active option's path, as on screen
    const root = window.zwicky.preparePrint();
    const out = {
      sections: root.querySelectorAll('.print-section').length,
      statement: (root.querySelector('.print-note') || {}).textContent,
      fixed: root.querySelectorAll('.cell.mark-fixed').length,
      paths: root.querySelectorAll('svg.paths g.path').length,
      footnotes: root.querySelectorAll('.footnotes li').length,
      marks: root.querySelectorAll('sup.fn').length,
    };
    root.remove();
    return out;
  });
  assert.equal(info.sections, 2);
  assert.match(info.statement, /Which new car concept/);
  assert.equal(info.fixed, 3);
  assert.ok(info.paths >= 1);
  assert.ok(info.footnotes > 0);
  assert.equal(info.marks, info.footnotes);
});

await check('autosave restores the space after a reload, still marked unsaved', async () => {
  const before = await md();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.tab-body > *');
  assert.equal(await page.locator('#tab-evaluation[aria-selected="true"]').count(), 1, 'reopens the last tab');
  assert.equal(await md(), before);
  assert.equal(await page.locator('.status.dirty').count(), 1);
});

await check('save falls back to a download with the canonical file', async () => {
  await z(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  assert.equal(download.suggestedFilename(), 'car-concept-demo.zwicky.md');
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  assert.match(text, /^---\nzwicky: 2\ntitle: Car Concept \(demo\)\nscale: 1-5\nupdated: \d{4}-\d\d-\d\d\n---\n\n# Problem\n> Which new car concept/);
  assert.match(text, /\n- Existing platform \{fixed\}\n/);
  assert.equal(await page.locator('.status.dirty').count(), 0);
});

await check('legend explains fixed, out, paths and extensions; there is no scope filter', async () => {
  await page.click('#tab-box');
  const legend = await page.locator('.legend').innerText();
  for (const t of ['Rows', 'Cells', 'Fixed', 'Out', 'Paths', 'Extensions']) assert.ok(legend.includes(t), t);
  assert.equal(await page.locator('.legend-line').count(), 3);
  assert.equal(await page.getByText('Scope up to').count(), 0);
  assert.equal(await page.getByText(/Horizon/).count(), 0);
});

await check('Extend starts a linked option with the same picks, in pick mode; the link is saved as {extends=O<n>}', async () => {
  await chip(1).click();
  await page.keyboard.press('Escape');
  await page.locator('.inspector').getByRole('button', { name: 'Extend', exact: true }).click();
  await page.waitForFunction(() => window.zwicky.space.options.some((o) => o.extends === 1));
  const s = await space();
  const ext = s.options.find((o) => o.extends === 1);
  assert.equal(ext.id, 7);
  assert.deepEqual(s.options.map((o) => o.id), [1, 7, 2, 4, 5, 3, 6], 'placed right after O1');
  assert.ok(param(s, 'athletic').picks.includes(7), 'starts with the picks of O1');
  assert.equal(await page.locator('.pick-hint').count(), 1, 'pick mode is on');
  await page.keyboard.type('SUV, second generation');
  await page.keyboard.press('Enter');
  assert.match(await md(), /\n## O7 SUV, second generation \{extends=O1\}\n/);
  assert.match(await chip(7).innerText(), /↳ O1/);
  await page.keyboard.press('Escape');
});

await check('the Extends choice links and unlinks an option, and offers no loops', async () => {
  await chip(2).dblclick();
  await page.keyboard.press('Escape');
  const values = await page.locator('#inspector-extends option').evaluateAll((els) => els.map((el) => el.value));
  assert.deepEqual(values, ['', '1', '7', '3', '6'], 'O2 cannot extend O4 or O5, which extend O2');
  await page.locator('#inspector-extends').selectOption('3');
  assert.match(await md(), /\n## O2 City coupé \{extends=O3\}\n/);
  await page.locator('#inspector-extends').selectOption('');
  assert.match(await md(), /\n## O2 City coupé\n/);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.match(await md(), /\n## O2 City coupé\n/);
});

await check('every example opens without a report and saves back byte-identically (apart from updated)', async () => {
  for (const name of ['car-concept.zwicky.md', 'slide-generator.zwicky.md']) {
    const fixture = readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8');
    const title = /^title: (.*)$/m.exec(fixture)[1];
    await page.keyboard.press('Escape');
    await z(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('?');
    await page.locator('dialog[open] .examples button', { hasText: title }).click();
    // a "discard changes?" confirm appears only when the open space is unsaved
    const discard = page.locator('dialog[open] .btn.danger');
    await discard.waitFor({ timeout: 1000 }).then(() => discard.click(), () => {});
    // wait for the example's content, not just its title (the car demo may already be open)
    await page.waitForFunction((f) => window.zwicky.markdown() === f, fixture, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.locator('dialog[open]').count(), 0, name + ' showed a dialog (import report?)');
    // Save writes serialize(space) after setting `updated`; the download path has its own check above
    assert.equal(await md(), fixture, name);
  }
});

await check('with nothing selected, Delete and letters do nothing; an arrow selects the first cell', async () => {
  await page.click('#tab-box');
  await z(() => {
    window.zwicky.setCursor('box', null);
    document.activeElement.blur();
  });
  const before = await md();
  for (const k of ['Delete', 'x', 'f', '1', 'Enter']) await page.keyboard.press(k);
  assert.equal(await md(), before);
  assert.equal(await page.locator('.inline-edit').count(), 0);
  await page.keyboard.press('ArrowDown');
  assert.ok(await z(() => window.zwicky.state.cursor.box !== null), 'an arrow selects the first cell');
});

await check('Tab from the top bar reaches the grid and moves the cursor there', async () => {
  await page.locator('.doc-title').focus();
  let inGrid = false;
  for (let i = 0; i < 40 && !inGrid; i++) {
    await page.keyboard.press('Tab');
    inGrid = await page.evaluate(() => !!document.activeElement.closest('.grid'));
  }
  assert.ok(inGrid, 'grid not reachable by Tab');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('selected')));
  const before = await page.evaluate(() => document.activeElement.dataset.key);
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => [document.activeElement.dataset.key, document.activeElement.classList.contains('selected'), !!document.activeElement.closest('.grid')]);
  assert.notEqual(after[0], before, 'the arrow moved the cursor');
  assert.deepEqual(after.slice(1), [true, true], 'focus follows the cursor');
});

await check('import from text shows the report for messy input', async () => {
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Import from text …' }).click();
  await page.locator('.import-text').fill('# Box\n## D\n- a {O9}\n- b {fixed out}\n');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('dialog[open] .report').waitFor();
  const report = await page.locator('dialog[open] .report').innerText();
  assert.match(report, /Unknown option O9/);
  assert.match(report, /both "fixed" and "out"/);
  await page.keyboard.press('Escape');
});

await check('a file from zwicky 1.x is refused with a clear message', async () => {
  const before = await md();
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Import from text …' }).click();
  await page.locator('.import-text').fill('---\nzwicky: 1\n---\n# Problem\n## Market\n- Commuters {focus}\n');
  await page.getByRole('button', { name: 'Import' }).click();
  const discard = page.locator('dialog[open] .btn.danger');
  await discard.waitFor({ timeout: 1000 }).then(() => discard.click(), () => {});
  await page.locator('dialog[open]', { hasText: 'Cannot open this file' }).waitFor();
  assert.match(await page.locator('dialog[open]').innerText(), /format version 1, from an older zwicky/);
  await page.keyboard.press('Escape');
  assert.equal(await md(), before);
});

await check('the View menu offers density and coordinates, no theme switch', async () => {
  await page.locator('.menu-btn', { hasText: 'View' }).click();
  const items = await page.locator('.menu .menu-item').allInnerTexts();
  assert.ok(items.some((t) => /Roomy/.test(t)));
  assert.ok(!items.some((t) => /Acrea|Theme/.test(t)));
  await page.getByRole('menuitemradio', { name: 'Compact' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact');
  await page.locator('.menu-btn', { hasText: 'View' }).click();
  await page.getByRole('menuitemradio', { name: 'Normal' }).click();
});

await check('a cached space from zwicky 1.x is dropped quietly; the demo opens', async () => {
  await z(() => localStorage.setItem('zwicky.autosave', JSON.stringify({ markdown: '---\nzwicky: 1\ntitle: Old\n---\n# Problem\n', fileName: 'old.zwicky.md', dirty: true })));
  await page.reload();
  await page.waitForSelector('.tab-body > *');
  assert.equal(await page.inputValue('.doc-title'), 'Car Concept (demo)');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await z(() => Object.keys(localStorage).filter((k) => k.startsWith('zwicky.autosave')).length), 1, 'no backup copy is kept');
});

await check('no console errors and zero network requests', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

await browser.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
