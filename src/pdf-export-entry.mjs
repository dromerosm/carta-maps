import { jsPDF } from 'jspdf';

// Embed only the bounded raster; map paths and font outlines never enter the PDF.
export async function createLowResolutionPdf(artwork, title = 'Carta · Low resolution', { includeCropMarks = true, widthMm = 300, heightMm } = {}) {
  const { dataUrl, width: pixelWidth, height: pixelHeight } = artwork;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || ![pixelWidth, pixelHeight].every(value => Number.isInteger(value) && value > 0 && value <= 1024) || !Number.isFinite(widthMm) || widthMm < 100 || widthMm > 1200) throw new Error('Invalid print artwork or size.');
  const mm = 72 / 25.4;
  const width = widthMm * mm;
  const height = heightMm === undefined ? width * pixelHeight / pixelWidth : heightMm * mm;
  if (!Number.isFinite(height) || height <= 0 || height > 1200 * mm) throw new Error('The print height must be at most 120 cm.');
  const margin = includeCropMarks ? 12 * mm : 0;
  const markGap = 3 * mm;
  const markLength = 6 * mm;
  const doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt', format: [width + margin * 2, height + margin * 2], compress: true, putOnlyUsedFonts: true });
  // jsPDF 4.2 serializes this page context as the PDF's finished artwork bounds.
  doc.internal.getCurrentPageInfo().pageContext.trimBox = {
    bottomLeftX: margin, bottomLeftY: margin,
    topRightX: margin + width, topRightY: margin + height,
  };
  doc.setProperties({ title, subject: 'Low-resolution city map · 1024 px maximum', creator: 'carta.example.com' });
  // The raster already contains the decorative frame. Keep its size and add space
  // outside it for cutting guides; the composition grid stays out of the print.
  doc.addImage(dataUrl, 'PNG', margin, margin, width, height);
  if (includeCropMarks) {
    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.setLineCap('butt');
    for (const [x, directionX] of [[margin, -1], [margin + width, 1]]) {
      for (const [y, directionY] of [[margin, -1], [margin + height, 1]]) {
        doc.line(x + directionX * markGap, y, x + directionX * (markGap + markLength), y);
        doc.line(x, y + directionY * markGap, x, y + directionY * (markGap + markLength));
      }
    }
  }
  return doc.output('blob');
}
