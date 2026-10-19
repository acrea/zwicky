import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeShare, decodeShare, shareLink, sharePayload, ShareError, SHARE_PREFIX } from '../src/js/share.js';
import { parse, serialize } from '../src/js/format.js';

const car = readFileSync(new URL('../examples/car-concept.zwicky.md', import.meta.url), 'utf8');

test('a space survives encode and decode byte for byte, umlauts and long notes included', async () => {
  const slides = readFileSync(new URL('../examples/slide-generator.zwicky.md', import.meta.url), 'utf8');
  const long = car + '\n# Notes\n' + 'Größe, Übersicht, naïve café – “quotes” ✓ 🚗\n'.repeat(400);
  for (const md of [car, slides, long, '']) assert.equal(await decodeShare(await encodeShare(md)), md);
});

test('the payload is versioned, URL-safe and shorter than the file', async () => {
  const payload = await encodeShare(car);
  assert.match(payload, /^1\.[A-Za-z0-9_-]+$/);
  assert.ok(payload.length < car.length * 0.75, `${payload.length} vs ${car.length}`); // deflate, then base64 adds a third back
});

test('a link replaces any fragment of the page URL; sharePayload reads it back', async () => {
  const link = await shareLink('https://acrea.github.io/zwicky/#old', car);
  assert.ok(link.startsWith('https://acrea.github.io/zwicky/' + SHARE_PREFIX + '1.'));
  const payload = sharePayload(new URL(link).hash);
  assert.equal(await decodeShare(payload), car);
  assert.equal(sharePayload('#something-else'), null);
  assert.equal(sharePayload(''), null);
});

test('a truncated or altered link fails cleanly and never yields part of a space', async () => {
  const payload = await encodeShare(car);
  const broken = [
    payload.slice(0, Math.floor(payload.length / 2)),
    payload.slice(0, -3),
    payload.slice(0, 2),
    payload.replace(/.$/, payload.endsWith('A') ? 'B' : 'A').slice(0, -10),
    '1.' + payload.slice(2).replace(/[A-Za-z]/, '%'),
    'x.abc',
    '',
    'nonsense',
  ];
  for (const p of broken) {
    await assert.rejects(decodeShare(p), (err) => err instanceof ShareError && err.kind === 'damaged', JSON.stringify(p.slice(0, 20)));
  }
});

test('a link from a newer encoding is refused with its own message', async () => {
  const payload = await encodeShare(car);
  await assert.rejects(decodeShare('2' + payload.slice(1)), (err) => err instanceof ShareError && err.kind === 'version' && /newer zwicky/.test(err.message));
});

test('what a link carries opens like the file it came from', async () => {
  const back = parse(await decodeShare(await encodeShare(car)));
  assert.deepEqual(back.report, []);
  assert.equal(serialize(back.space), car);
});
