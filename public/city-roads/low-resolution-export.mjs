import { outlineSvgText } from './print-text.mjs';
import { createSocialPng } from './png-export.mjs?v=2';

export async function createLowResolutionArtwork(source, frame) {
  const outlined = await outlineSvgText(source);
  const { blob, width, height } = await createSocialPng(outlined, frame, 1024);
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not prepare the preview.'));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, width, height };
}

export function rasterSvg({ dataUrl, width, height }, { widthMm, heightMm }) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || ![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 1024) || ![widthMm, heightMm].every(value => Number.isFinite(value) && value > 0 && value <= 1200)) throw new Error('Invalid preview artwork or size.');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${width} ${height}" role="img">
  <title>Carta · Low resolution</title>
  <desc>Raster preview, at most 1024 pixels on the longest edge. Map credits are included in the image.</desc>
  <image width="${width}" height="${height}" href="${dataUrl}"/>
</svg>`;
}
