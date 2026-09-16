import { create } from 'fontkit';
import bidiFactory from 'bidi-js';
const bidi = bidiFactory();
const fonts = new Map();
const scripts = [
  [/\p{Script=Arabic}/u, 'Arabic'], [/\p{Script=Hebrew}/u, 'Hebrew'],
  [/\p{Script=Devanagari}/u, 'Devanagari'], [/\p{Script=Thai}/u, 'Thai'],
  [/\p{Script=Bengali}/u, 'Bengali'], [/\p{Script=Armenian}/u, 'Armenian'],
  [/\p{Script=Georgian}/u, 'Georgian'], [/\p{Script=Tamil}/u, 'Tamil'], [/\p{Script=Telugu}/u, 'Telugu'],
  [/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u, 'CJKjp'],
];
async function loadFont(file) {
  if (!fonts.has(file)) fonts.set(file, (async () => {
    const response = await fetch(new URL(`./fonts/${file}`, import.meta.url));
    if (!response.ok) throw new Error('Could not load the print font. Please retry.');
    return create(new Uint8Array(await response.arrayBuffer()));
  })().catch(error => { fonts.delete(file); throw error; }));
  return fonts.get(file);
}

// Split by resolved bidi level and font, then shape each logical run. Reorder
// runs, never individual Arabic/Indic characters, so joining remains intact.
export async function shapeText(text, family = 'display') {
  text = text.normalize('NFC');
  const primary = await loadFont(family === 'display' ? 'BarlowCondensed-Medium.ttf' : 'DMSans-Regular.ttf');
  const fallback = await loadFont('NotoSans-Regular.ttf');
  const embedding = bidi.getEmbeddingLevels(text);
  const runs = [];
  let offset = 0;
  for (const character of text) {
    let font = primary;
    const code = character.codePointAt(0);
    const script = scripts.find(([pattern]) => pattern.test(character))?.[1];
    if (script) font = await loadFont(`NotoSans${script}-Regular.${script === 'CJKjp' ? 'otf' : 'ttf'}`);
    else if (!primary.hasGlyphForCodePoint(code)) font = fallback;
    if (!font.hasGlyphForCodePoint(code) && !/[\p{Cf}\s]/u.test(character)) {
      const error = new Error(`The print font does not contain “${character}”. Edit the print title to continue.`);
      error.code = 'UNSUPPORTED_PRINT_CHARACTER';
      throw error;
    }
    const level = embedding.levels[offset];
    const previous = runs.at(-1);
    // Common punctuation inherits the preceding script when that font supports it.
    if (previous && /[\p{Script=Common}\p{Script=Inherited}]/u.test(character) && previous.font.hasGlyphForCodePoint(code)) font = previous.font;
    if (previous?.font === font && previous.level === level) previous.text += character;
    else runs.push({ text: character, font, level });
    offset += character.length;
  }
  const maxLevel = Math.max(0, ...runs.map(run => run.level));
  for (let level = maxLevel; level >= 1; level--) {
    for (let start = 0; start < runs.length;) {
      if (runs[start].level < level) { start++; continue; }
      let end = start + 1;
      while (end < runs.length && runs[end].level >= level) end++;
      runs.splice(start, end - start, ...runs.slice(start, end).reverse());
      start = end;
    }
  }
  let advance = 0;
  const glyphs = [];
  for (const run of runs) {
    const mirrored = run.level % 2 ? Array.from(run.text, c => bidi.getMirroredCharacter(c) || c).join('') : run.text;
    const layout = run.font.layout(mirrored, { rtlm: false }, undefined, undefined, run.level % 2 ? 'rtl' : 'ltr');
    const unit = run.font.unitsPerEm;
    for (let i = 0; i < layout.glyphs.length; i++) {
      const position = layout.positions[i];
      glyphs.push({ d: layout.glyphs[i].path.toSVG(), x: advance + position.xOffset / unit, y: position.yOffset / unit, unit });
      advance += position.xAdvance / unit;
    }
  }
  return { glyphs, advance };
}

export async function outlineSvgText(markup) {
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (document.querySelector('parsererror, image, foreignObject')) throw new Error('Invalid vector artwork.');
  const root = document.documentElement;
  for (const text of Array.from(root.querySelectorAll('text'))) {
    const shaped = await shapeText(text.textContent, text.getAttribute('font-family')?.includes('Barlow') ? 'display' : 'ui');
    const size = Number(text.getAttribute('font-size'));
    const x = Number(text.getAttribute('x')), y = Number(text.getAttribute('y'));
    const available = Number(root.getAttribute('viewBox').split(/\s+/)[2]) - 28;
    const shrink = Math.min(1, available / Math.max(1, shaped.advance * size));
    const scale = size * shrink;
    const start = text.getAttribute('text-anchor') === 'end' ? x - shaped.advance * scale : x;
    const group = document.createElementNS(root.namespaceURI, 'g');
    group.setAttribute('aria-label', text.textContent);
    for (const attribute of ['fill', 'stroke', 'stroke-width', 'paint-order']) if (text.hasAttribute(attribute)) group.setAttribute(attribute, text.getAttribute(attribute));
    const title = document.createElementNS(root.namespaceURI, 'title');
    title.textContent = text.textContent;
    group.append(title);
    for (const glyph of shaped.glyphs) {
      if (!glyph.d) continue;
      const path = document.createElementNS(root.namespaceURI, 'path');
      path.setAttribute('d', glyph.d);
      path.setAttribute('transform', `translate(${start + glyph.x * scale} ${y - glyph.y * scale}) scale(${scale / glyph.unit} ${-scale / glyph.unit})`);
      // Keep the halo in artwork units after the font-unit transform.
      if (text.hasAttribute('stroke-width')) path.setAttribute('stroke-width', String(Number(text.getAttribute('stroke-width')) * glyph.unit / scale));
      group.append(path);
    }
    if (group.hasAttribute('stroke')) {
      const halo = group.cloneNode(true);
      halo.setAttribute('fill', 'none');
      group.removeAttribute('stroke');
      text.before(halo);
    }
    text.replaceWith(group);
  }
  root.querySelectorAll('style').forEach(style => style.remove());
  return new XMLSerializer().serializeToString(root);
}
