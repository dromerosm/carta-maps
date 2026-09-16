import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterSvg } from '../public/city-roads/low-resolution-export.mjs';
import { createLowResolutionPdf } from '../src/pdf-export-entry.mjs';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const artwork = { dataUrl, width: 1, height: 1 };
const dimensions = { widthMm: 300, heightMm: 300 };

test('SVG wraps only the raster image and discloses low resolution', () => {
  const svg = rasterSvg(artwork, dimensions);
  assert.match(svg, /Low resolution/);
  assert.equal((svg.match(/<image /g) || []).length, 1);
  assert.ok(svg.includes(dataUrl));
  assert.doesNotMatch(svg, /<(path|text|use|foreignObject)\b/);
  assert.match(svg, /width="300mm" height="300mm"/);
});

test('preview wrappers reject oversized artwork and external image URLs', async () => {
  for (const bad of [{ ...artwork, width: 2048 }, { ...artwork, dataUrl: 'https://example.com/map.png' }]) {
    assert.throws(() => rasterSvg(bad, dimensions), /Invalid/);
    await assert.rejects(createLowResolutionPdf(bad, 'London', dimensions), /Invalid/);
  }
});

test('PDF embeds the raster at its original pixel size and retains optional crop margins', async () => {
  const outputs = [];
  for (const includeCropMarks of [false, true]) {
    const pdf = await createLowResolutionPdf(artwork, 'London · Low resolution', { ...dimensions, includeCropMarks });
    const text = await pdf.text();
    assert.match(text, /^%PDF-/);
    assert.match(text, /\/Subtype \/Image/);
    assert.match(text, /\/Width 1\s+\/Height 1/);
    assert.match(text, /\/TrimBox/);
    outputs.push(text.match(/\/MediaBox \[([^\]]+)\]/)[1].split(/\s+/).map(Number));
  }
  const extra = 24 * 72 / 25.4;
  assert.ok(Math.abs(outputs[1][2] - outputs[0][2] - extra) < 0.001);
  assert.ok(Math.abs(outputs[1][3] - outputs[0][3] - extra) < 0.001);
});
