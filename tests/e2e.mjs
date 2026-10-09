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

await check('loads the car concept demo on first launch', async () => {
  assert.equal(await page.inputValue('.doc-title'), 'Car Concept (demo)');
  assert.equal(await page.locator('.cell.dim:not(.ghost)').count(), 2);
});

await check('problem: digits set a stage, F cycles, X marks out of scope', async () => {
  const has = (cls) => cell('Families').evaluate((el, c) => el.classList.contains(c), cls);
  await cell('Families').click();
  assert.ok(await has('stage-2'), 'the demo has Families at stage 2');
  await page.keyboard.press('0');
  assert.ok(!(await has('stage-2')));
  await page.keyboard.press('f');
  assert.ok(await has('stage-1'));
  await page.keyboard.press('f');
  assert.ok(await has('stage-2'));
  await page.keyboard.press('3');
  assert.ok(await has('stage-3'));
  await page.keyboard.press('x');
  assert.ok((await has('mark-out')) && !(await has('stage-3')), 'out of scope replaces the stage');
  await page.keyboard.press('x');
  assert.ok(!(await has('mark-out')));
  await page.keyboard.press('2');
  assert.ok(await has('stage-2'));
  assert.match(await page.locator('.inspector').innerText(), /Horizon 2/);
});

await check('undo and redo', async () => {
  await page.keyboard.press('Control+z');
  assert.ok(!(await cell('Families').evaluate((el) => el.classList.contains('stage-2'))));
  await page.keyboard.press('Control+Shift+z');
  assert.ok(await cell('Families').evaluate((el) => el.classList.contains('stage-2')));
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
  await cell('Urban commuters').click();
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('.cell.selected .title').innerText(), /Families/);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.cell.selected .title').innerText(), 'Reuse an existing platform');
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

await check('+ Dimension adds a row and moves to its ghost cell', async () => {
  await page.locator('.ghost-row .cell').click();
  await page.keyboard.type('Regulation');
  await page.keyboard.press('Enter');
  await page.locator('.cell.dim .title', { hasText: 'Regulation' }).waitFor();
  await page.keyboard.type('EU only');
  await page.keyboard.press('Enter');
  await cell('EU only').waitFor();
});

await check('Alt+arrows move parameters and dimensions', async () => {
  await cell('Second').click();
  await page.keyboard.press('Alt+ArrowLeft');
  const s = await space();
  const titles = s.problem.dims[1].children.map((p) => p.title);
  assert.deepEqual(titles.slice(-2), ['Second', 'Brand new']);
  await page.keyboard.press('Alt+ArrowUp');
  const s2 = await space();
  assert.equal(s2.problem.dims[0].title, 'Constraints');
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
  assert.ok(await cell('Brand new').evaluate((el) => el.classList.contains('has-note')));
  await cell('Brand new').click();
  await page.keyboard.press('Control+z');
  assert.ok(!(await cell('Brand new').evaluate((el) => el.classList.contains('has-note'))));
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

await check('solution: O1 is active and drawn as a path', async () => {
  await page.click('#tab-solution');
  await page.waitForSelector('svg.paths polyline');
  assert.equal(await page.locator('.cell.picked').count(), 8);
});

await check('chip click enters pick mode; clicking cells toggles picks', async () => {
  await page.locator('.chip', { hasText: 'City coupé' }).click();
  assert.equal(await page.locator('.pick-hint').count(), 1);
  await cell('sporty').click();
  let s = await space();
  assert.deepEqual(s.solution.dims[0].children.find((p) => p.title === 'sporty').picks, [2]);
  await cell('sporty').click();
  s = await space();
  assert.deepEqual(s.solution.dims[0].children.find((p) => p.title === 'sporty').picks, []);
  await page.keyboard.press('Space');
  s = await space();
  assert.deepEqual(s.solution.dims[0].children.find((p) => p.title === 'sporty').picks, [2]);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pick-hint').count(), 0);
});

await check('digit keys toggle picks for O1–O9', async () => {
  await cell('slim').click();
  await page.keyboard.press('3');
  const s = await space();
  assert.deepEqual(s.solution.dims[0].children.find((p) => p.title === 'slim').picks, [3]);
  assert.equal(await cell('slim').locator('.marker').innerText(), '3');
});

await check('compare draws every option; line styles add dashes', async () => {
  await page.getByRole('button', { name: 'Compare' }).click();
  assert.equal(await page.locator('svg.paths g.path').count(), 3);
  await page.getByRole('button', { name: 'Line styles' }).click();
  assert.ok((await page.locator('svg.paths polyline[stroke-dasharray]').count()) >= 2);
  await page.getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('button', { name: 'Line styles' }).click();
});

await check('+ Option, rename in the inspector, duplicate and delete', async () => {
  await page.locator('.chip.add').click();
  await page.keyboard.type('Robo taxi');
  await page.keyboard.press('Enter');
  // the chip label updates on the next animation frame, so wait for it
  await page.locator('.chip', { hasText: 'Robo taxi' }).waitFor({ timeout: 5000 });
  assert.match(await page.locator('.chip', { hasText: 'O4' }).innerText(), /Robo taxi/);
  await page.keyboard.press('Escape'); // leave pick mode, so a click only selects
  await cell('Electric').click();
  await page.keyboard.press('4');
  await page.locator('.chip', { hasText: 'O4' }).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.keyboard.press('Enter');
  const s = await space();
  assert.deepEqual(s.options.items.map((o) => o.id), [1, 2, 3, 4, 5], 'after duplicate: ' + JSON.stringify(s.options.items.map((o) => o.id)));
  assert.ok(s.solution.dims[1].children.find((p) => p.title === 'Electric').picks.includes(5));
  await page.locator('.chip', { hasText: 'O5' }).click();
  await page.getByRole('button', { name: 'Delete option' }).click();
  await page.locator('dialog[open] .btn.danger').click();
  await page.waitForFunction(() => window.zwicky.space.options.items.length === 4); // the dialog closes asynchronously
  const s2 = await space();
  assert.deepEqual(s2.options.items.map((o) => o.id), [1, 2, 3, 4], 'after delete: ' + JSON.stringify(s2.options.items.map((o) => o.id)));
  assert.ok(!s2.solution.dims[1].children.find((p) => p.title === 'Electric').picks.includes(5));
});

await check('evaluation: profiles list picks per dimension', async () => {
  await page.click('#tab-evaluation');
  await page.locator('.profile-table').waitFor();
  const cols = await page.locator('.profile-table thead .opt-head').count();
  assert.equal(cols, (await space()).options.items.length);
  assert.match(await page.locator('.profile-table tbody tr').first().innerText(), /athletic/);
});

await check('evaluation: digits score, weights and totals update, Delete clears', async () => {
  await page.locator('[data-key="rating:3:3"]').click();
  await page.keyboard.press('2');
  let s = await space();
  assert.equal(s.ratings.cells.O3.C3.score, 2);
  await page.keyboard.press('Delete');
  s = await space();
  assert.equal(s.ratings.cells.O3?.C3, undefined);
  await page.locator('[data-key="weight:1"]').click();
  await page.keyboard.press('1');
  await page.keyboard.press('0');
  s = await space();
  assert.equal(s.criteria.items[0].weight, 10);
  // O1: (10*4 + 2*3 + 1*5) / 13 = 3.9
  assert.equal(await page.locator('.total-row td').first().locator('.total-val').innerText(), '3.9');
  assert.equal(await page.locator('.rank-row td').first().innerText(), '1st');
});

await check('evaluation: add a criterion from the ghost row and reorder with Alt+Up', async () => {
  await page.locator('.ecell.ghost').click();
  await page.keyboard.type('Cost of ownership');
  await page.keyboard.press('Enter');
  let s = await space();
  assert.equal(s.criteria.items.at(-1).title, 'Cost of ownership');
  await page.locator('[data-key="crit:4"]').click();
  await page.keyboard.press('Alt+ArrowUp');
  s = await space();
  assert.deepEqual(s.criteria.items.map((c) => c.id), [1, 2, 4, 3]);
});

await check('evaluation: Enter on a rating writes its note in the inspector', async () => {
  await page.locator('[data-key="rating:2:1"]').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Assumes a dealer network.');
  await page.locator('[data-key="rating:2:2"]').click();
  const s = await space();
  assert.equal(s.ratings.cells.O1.C2.note, 'Assumes a dealer network.');
  assert.equal(s.ratings.cells.O1.C2.score, 3);
  assert.ok(await page.locator('[data-key="rating:2:1"]').evaluate((el) => el.classList.contains('has-note')));
});

await check('evaluation: sort by rank and show all notes are view-only', async () => {
  const before = JSON.stringify((await space()).options.items.map((o) => o.id));
  await page.getByRole('button', { name: 'Sort options by rank' }).click();
  await page.getByRole('button', { name: 'Show all notes' }).click();
  assert.ok((await page.locator('.cell-note').count()) >= 3);
  assert.equal(JSON.stringify((await space()).options.items.map((o) => o.id)), before);
  const ranks = await page.locator('.rank-row td').allInnerTexts();
  assert.equal(ranks[0], '1st');
  await page.getByRole('button', { name: 'Sort options by rank' }).click();
  await page.getByRole('button', { name: 'Show all notes' }).click();
});

await check('print view: one section per tab, paths, footnotes', async () => {
  const info = await z(() => {
    window.zwicky.activateOption(1); // the print shows the active option's path, as on screen
    const root = window.zwicky.preparePrint();
    const out = {
      sections: root.querySelectorAll('.print-section').length,
      paths: root.querySelectorAll('svg.paths g.path').length,
      footnotes: root.querySelectorAll('.footnotes li').length,
      marks: root.querySelectorAll('sup.fn').length,
    };
    root.remove();
    return out;
  });
  assert.equal(info.sections, 3);
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
  assert.match(text, /^---\nzwicky: 1\ntitle: Car Concept \(demo\)\nscale: 1-5\nupdated: \d{4}-\d\d-\d\d\n---\n/);
  assert.equal(await page.locator('.status.dirty').count(), 0);
});

await check('M moves a problem dimension to the solution; a confirm names the dropped marks; undo restores', async () => {
  await page.click('#tab-problem');
  const before = await space();
  const market = before.problem.dims.find((d) => d.title === 'Market');
  assert.ok(market.children.some((p) => p.mark), 'Market has marks to drop');
  const dim = (title) => page.locator('.cell.dim', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
  await dim('Market').click();
  await page.keyboard.press('m');
  await page.locator('dialog[open]').waitFor();
  assert.match(await page.locator('dialog[open]').innerText(), /(loses its|lose their) stage or out-of-scope mark/);
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.waitForFunction(() => window.zwicky.space.solution.dims.at(-1).title === 'Market');
  const s = await space();
  assert.equal(s.problem.dims.some((d) => d.title === 'Market'), false);
  assert.equal(s.solution.dims.at(-1).title, 'Market');
  assert.ok(s.solution.dims.at(-1).children.every((p) => p.mark === null));
  assert.equal(await page.getAttribute('#tab-solution', 'aria-selected'), 'true');
  assert.ok(await dim('Market').evaluate((el) => el.classList.contains('selected') || el.getAttribute('aria-selected') === 'true'));
  await page.keyboard.press('Control+z');
  assert.deepEqual((await space()).problem, before.problem);
  assert.deepEqual((await space()).solution, before.solution);
});

await check('the inspector moves a solution dimension to the problem; cancel keeps it, picks are dropped on confirm', async () => {
  await page.click('#tab-solution');
  const dim = (title) => page.locator('.cell.dim', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
  await dim('Drivetrain').click();
  await page.getByRole('button', { name: /Move to Problem/ }).click();
  await page.locator('dialog[open]').waitFor();
  assert.match(await page.locator('dialog[open]').innerText(), /picks? by (an option|options) (is|are) removed/);
  await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
  assert.ok((await space()).solution.dims.some((d) => d.title === 'Drivetrain'));
  await page.getByRole('button', { name: /Move to Problem/ }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.waitForFunction(() => window.zwicky.space.problem.dims.at(-1).title === 'Drivetrain');
  const s = await space();
  const moved = s.problem.dims.at(-1);
  assert.equal(moved.title, 'Drivetrain');
  assert.ok(moved.children.every((p) => p.picks.length === 0));
  assert.match(await md(), /# Problem[\s\S]*## Drivetrain[\s\S]*# Solution/);
  await page.keyboard.press('Control+z');
  assert.ok((await space()).solution.dims.some((d) => d.title === 'Drivetrain'));
});

await check('legend names the stages; the scope filter greys out later stages and their options', async () => {
  await page.click('#tab-problem');
  const legend = await page.locator('.legend').innerText();
  for (const t of ['Rows', 'Cells', 'Horizon 1', 'Horizon 2', 'Horizon 3', 'Out of scope']) assert.ok(legend.includes(t), t);
  const beyond = (title) => cell(title).evaluate((el) => el.classList.contains('beyond-scope'));
  await page.locator('.scope-filter').getByRole('button', { name: 'Horizon 1' }).click();
  assert.equal(await beyond('Urban commuters'), false);
  assert.equal(await beyond('Long-distance travellers'), true);
  assert.equal(await beyond('Luxury segment'), true);
  await page.locator('.scope-filter').getByRole('button', { name: 'Horizon 3' }).click();
  assert.equal(await beyond('Long-distance travellers'), false);
  assert.equal(await beyond('Luxury segment'), true);
  await page.click('#tab-solution');
  await page.locator('.scope-filter').getByRole('button', { name: 'Horizon 2' }).click();
  const chipBeyond = (id) => page.locator('.chip', { hasText: id }).evaluate((el) => el.classList.contains('beyond-scope'));
  assert.equal(await chipBeyond('O1'), true, 'O1 addresses stage 3');
  assert.equal(await chipBeyond('O2'), false);
  assert.match(await page.locator('.chip', { hasText: 'O2' }).innerText(), /Horizon 1/);
  await page.locator('.scope-filter').getByRole('button', { name: 'All' }).click();
  assert.equal(await chipBeyond('O1'), false);
});

await check('the stage of an option is set in the inspector and saved as {stage=n}', async () => {
  await page.click('#tab-solution');
  await page.locator('.chip', { hasText: 'O2' }).dblclick();
  await page.keyboard.press('Escape');
  await page.locator('.inspector').getByRole('button', { name: 'Horizon 2' }).click();
  assert.match(await md(), /## O2 City coupé \{stage=2\}/);
  await page.locator('.inspector').getByRole('button', { name: 'Horizon 2' }).click();
  assert.match(await md(), /## O2 City coupé\n/);
  await page.keyboard.press('Control+z');
  assert.match(await md(), /## O2 City coupé \{stage=2\}/);
  await page.keyboard.press('Control+z');
  assert.match(await md(), /## O2 City coupé \{stage=1\}/);
});

await check('renaming the stages updates the legend and the file', async () => {
  await page.click('#tab-problem');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const input = page.locator('.inspector input.stage-1');
  await input.fill('Pilot');
  await input.blur();
  await page.waitForTimeout(50);
  assert.match(await page.locator('.legend').innerText(), /Pilot/);
  assert.match(await md(), /\nstages: Pilot, Horizon 2, Horizon 3\n/);
  await page.keyboard.press('Control+z');
  assert.doesNotMatch(await md(), /stages:/);
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
  await page.click('#tab-solution');
  await z(() => {
    window.zwicky.setCursor('solution', null);
    document.activeElement.blur();
  });
  const before = await md();
  for (const k of ['Delete', 'x', '1', 'Enter']) await page.keyboard.press(k);
  assert.equal(await md(), before);
  assert.equal(await page.locator('.inline-edit').count(), 0);
  await page.keyboard.press('ArrowDown');
  assert.ok(await z(() => window.zwicky.state.cursor.solution !== null), 'an arrow selects the first cell');
});

await check('Tab from the top bar reaches the grid and moves the cursor there', async () => {
  await page.click('#tab-problem');
  await page.locator('.doc-title').focus();
  let inGrid = false;
  for (let i = 0; i < 40 && !inGrid; i++) {
    await page.keyboard.press('Tab');
    inGrid = await page.evaluate(() => !!document.activeElement.closest('.grid'));
  }
  assert.ok(inGrid, 'grid not reachable by Tab');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('selected')));
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('param')));
});

await check('import from text shows the report for messy input', async () => {
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Import from text …' }).click();
  await page.locator('.import-text').fill('# Solution\n## D\n- a {O9}\n');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('dialog[open] .report').waitFor();
  assert.match(await page.locator('dialog[open] .report').innerText(), /Unknown option O9/);
  await page.keyboard.press('Escape');
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

await check('no console errors and zero network requests', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

await browser.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
