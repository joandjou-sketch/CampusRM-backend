'use strict';

const PDFDocument = require('pdfkit');

const ROW_HEIGHT = 20;
const HEADER_GAP = 6;

/**
 * Streams a titled, paginated table as a downloadable PDF.
 * @param {import('express').Response} res
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {string} options.filename
 * @param {{label: string, value: string|((row: object) => *)}[]} options.columns
 * @param {object[]} options.rows
 */
function streamTablePdf(res, { title, subtitle, filename, columns, rows }) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: columns.length > 6 ? 'landscape' : 'portrait',
    margin: 40,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(title);
  if (subtitle) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text(subtitle);
  }
  doc.fillColor('#111111');
  doc.moveDown(1);

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usableWidth / columns.length;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  function drawHeaderRow(y) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
    columns.forEach((col, i) => {
      doc.text(String(col.label), startX + i * colWidth, y, { width: colWidth - 8, ellipsis: true });
    });
    doc
      .moveTo(startX, y + ROW_HEIGHT - HEADER_GAP)
      .lineTo(startX + usableWidth, y + ROW_HEIGHT - HEADER_GAP)
      .strokeColor('#cccccc')
      .stroke();
  }

  let y = doc.y;
  drawHeaderRow(y);
  y += ROW_HEIGHT;

  doc.font('Helvetica').fontSize(9).fillColor('#333333');
  rows.forEach((row) => {
    if (y + ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeaderRow(y);
      y += ROW_HEIGHT;
      doc.font('Helvetica').fontSize(9).fillColor('#333333');
    }
    columns.forEach((col, i) => {
      const raw = typeof col.value === 'function' ? col.value(row) : row[col.value];
      const text = raw === null || raw === undefined ? '' : String(raw);
      doc.text(text, startX + i * colWidth, y, { width: colWidth - 8, ellipsis: true });
    });
    y += ROW_HEIGHT;
  });

  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#777777').text('No data for the selected period.', startX, y);
  }

  doc.end();
}

module.exports = { streamTablePdf };
