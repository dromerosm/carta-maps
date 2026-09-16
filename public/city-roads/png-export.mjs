const LONG_EDGE = 2048;

export function socialPngSize(width, height, longEdge = LONG_EDGE) {
  if (![1024, 2048].includes(longEdge)) throw new Error('Invalid image resolution.');
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid image dimensions.');
  const scale = longEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Rasterize the outlined export, so layer order, title and credits match PDF/SVG.
// Fixed pixel dimensions keep memory bounded independently of the print size.
export async function createSocialPng(svg, frame, longEdge = LONG_EDGE) {
  const svgDocument = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = svgDocument.documentElement;
  if (root.localName !== 'svg' || svgDocument.querySelector('parsererror, image, foreignObject, script, text, style')) throw new Error('Could not prepare the image.');
  const viewBox = root.getAttribute('viewBox')?.trim().split(/\s+/).map(Number);
  if (viewBox?.length !== 4) throw new Error('Invalid image dimensions.');
  const size = socialPngSize(frame?.[0] ?? viewBox[2], frame?.[1] ?? viewBox[3], longEdge);
  root.setAttribute('width', String(size.width));
  root.setAttribute('height', String(size.height));
  // The screen frame is rounded to CSS pixels; use the chosen ratio for sharing.
  root.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  const canvas = document.createElement('canvas');
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Image preparation timed out. Please try again.')), 30000);
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not render the image. Please try again.'));
      image.src = url;
    });
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');
    context.fillStyle = root.querySelector(':scope > rect[fill]')?.getAttribute('fill') || '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not save the PNG. Please try again.')), 'image/png'));
    return { blob, ...size };
  } finally {
    clearTimeout(timer);
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
