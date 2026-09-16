import test from 'node:test';
import assert from 'node:assert/strict';
import { socialPngSize } from '../public/city-roads/png-export.mjs';

test('social PNG sizes preserve every offered frame with a bounded pixel budget', () => {
  for (const [w, h, expected] of [
    [1, 1, { width: 2048, height: 2048 }],
    [5, 7, { width: 1463, height: 2048 }],
    [7, 5, { width: 2048, height: 1463 }],
    [16, 9, { width: 2048, height: 1152 }],
    [9, 16, { width: 1152, height: 2048 }],
  ]) {
    assert.deepEqual(socialPngSize(w, h), expected);
    assert.deepEqual(socialPngSize(w * 100000, h * 100000), expected, 'Large print dimensions must not create a huge canvas');
    assert.ok(expected.width * expected.height <= 2048 ** 2);
  }
});

test('invalid PNG dimensions fail before allocating a canvas', () => {
  for (const value of [0, -1, NaN, Infinity, undefined]) {
    assert.throws(() => socialPngSize(value, 1), /Invalid image dimensions/);
    assert.throws(() => socialPngSize(1, value), /Invalid image dimensions/);
  }
});

test('PDF and SVG previews use a smaller pixel budget than social PNG', () => {
  assert.deepEqual(socialPngSize(16, 9, 1024), { width: 1024, height: 576 });
  assert.deepEqual(socialPngSize(5, 7, 1024), { width: 731, height: 1024 });
  assert.deepEqual(socialPngSize(1, 1, 1024), { width: 1024, height: 1024 });
  assert.throws(() => socialPngSize(1, 1, 4096), /Invalid image resolution/);
});
