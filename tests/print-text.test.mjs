import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shapeText } from '../src/print-text-entry.mjs';
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const name = new URL(url).pathname.split('/').at(-1);
  assert.match(name, /^(NotoSans[\w]*|BarlowCondensed-Medium|DMSans-Regular)(?:-Regular)?\.(ttf|otf)$/);
  return new Response(await readFile(new URL(`../public/city-roads/fonts/${name}`, import.meta.url)));
};
after(() => { globalThis.fetch = originalFetch; });

test('print fonts shape supported city names into finite vector geometry', async () => {
  for (const name of ['Zaragoza', 'Αθήνα', 'Київ', '東京', '北京', '서울', 'القاهرة', 'ירושלים', 'दिल्ली', 'กรุงเทพมหานคร', 'ঢাকা', 'Երևան', 'თბილისი', 'சென்னை', 'హైదరాబాద్', 'القاهرة (Cairo) 2026']) {
    const shaped = await shapeText(name);
    assert.ok(shaped.advance > 0, name);
    assert.ok(shaped.glyphs.some(g => g.d.startsWith('M')), name);
    assert.ok(shaped.glyphs.every(g => [g.x, g.y, g.unit].every(Number.isFinite)), name);
    assert.ok(shaped.glyphs.every(g => !/NaN|Infinity/.test(g.d)), name);
  }
});

test('equivalent accents keep the same outlines and unsupported glyphs are actionable', async () => {
  assert.deepEqual(await shapeText('Cádiz'), await shapeText('Ca\u0301diz'));
  await assert.rejects(shapeText('City 🚀'), error => error.code === 'UNSUPPORTED_PRINT_CHARACTER' && error.message.includes('🚀') && error.message.includes('Edit the print title'));
});
