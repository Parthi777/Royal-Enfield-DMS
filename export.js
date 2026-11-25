// Excel and PDF reports from a simple table description sent by the page:
// { title, subtitle, sections: [{ heading, columns: [{ label, type }], rows: [[...]], totals: [...] }] }
// type: text | money | num | date (yyyy-mm-dd)
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const NAVY = '1E2A44', TEAL = '0F9D8A', MUTED = '667085', LINE = 'E3E7ED', ZEBRA = 'F6F8FB';
const FONT = { r: path.join(__dirname, 'fonts', 'IBMPlexSans-Regular.woff'), b: path.join(__dirname, 'fonts', 'IBMPlexSans-SemiBold.woff') };
// Indian grouping (₹12,34,567) in Excel
const INR_FMT = '[>=10000000]"₹"#\\,##\\,##\\,##0;[>=100000]"₹"#\\,##\\,##0;"₹"#,##0';

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const toDate = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fdate = (v) => (isDate(v) ? `${+v.slice(8)} ${MON[+v.slice(5, 7) - 1]} ${v.slice(0, 4)}` : String(v ?? ''));
const inr = (v) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n)) return '';
  return (n < 0 ? '-₹' : '₹') + Math.abs(Math.round(n)).toLocaleString('en-IN');
};
const show = (col, v) => (v === '' || v === null || v === undefined ? '' : col.type === 'money' ? inr(v) : col.type === 'date' ? fdate(v) : String(v));

function clean(p) {
  const out = { title: String(p.title || 'Report').slice(0, 120), subtitle: String(p.subtitle || '').slice(0, 300), sections: [] };
  for (const s of (p.sections || []).slice(0, 20)) {
    const columns = (s.columns || []).slice(0, 40).map((c) => ({ label: String(c.label || ''), type: ['money', 'num', 'date'].includes(c.type) ? c.type : 'text' }));
    const rows = (s.rows || []).slice(0, 20000).map((r) => columns.map((_, i) => (r[i] === null || r[i] === undefined ? '' : r[i])));
    out.sections.push({ heading: String(s.heading || '').slice(0, 80), columns, rows, totals: Array.isArray(s.totals) ? s.totals.slice(0, columns.length) : null });
  }
  return out;
}

async function toExcel(payload, meta) {
  const p = clean(payload);
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.user; wb.created = new Date();
  const used = new Set();
  for (const s of p.sections) {
    let name = (s.heading || p.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    let n = 2; while (used.has(name)) name = name.slice(0, 28) + ' ' + n++;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.getCell('A1').value = p.title + (s.heading && s.heading !== p.title ? ` · ${s.heading}` : '');
    ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF' + NAVY } };
    ws.getCell('A2').value = [p.subtitle, `${meta.showroom} · exported ${meta.when} by ${meta.user}`].filter(Boolean).join('   ·   ');
    ws.getCell('A2').font = { name: 'Arial', size: 9, color: { argb: 'FF' + MUTED } };
    const head = ws.getRow(4);
    s.columns.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.label;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'num' ? 'right' : 'left', wrapText: true };
    });
    head.height = 22;
    const widths = s.columns.map((c) => Math.max(10, c.label.length + 2));
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(5 + ri);
      s.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        let v = r[i];
        if (c.type === 'date' && isDate(v)) { cell.value = toDate(v); cell.numFmt = 'dd-mmm-yyyy'; }
        else if ((c.type === 'money' || c.type === 'num') && v !== '' && isFinite(Number(v))) { cell.value = Number(v); cell.numFmt = c.type === 'money' ? INR_FMT : '#,##0'; }
        else cell.value = v === '' ? null : String(v);
        cell.font = { name: 'Arial', size: 10 };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ZEBRA } };
        widths[i] = Math.min(48, Math.max(widths[i], show(c, v).length + 2));
      });
    });
    if (s.totals) {
      const row = ws.getRow(5 + s.rows.length);
      s.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1); const v = s.totals[i];
        if (v === null || v === undefined || v === '') return;
        if ((c.type === 'money' || c.type === 'num') && isFinite(Number(v))) { cell.value = Number(v); cell.numFmt = c.type === 'money' ? INR_FMT : '#,##0'; }
        else cell.value = String(v);
        cell.font = { name: 'Arial', size: 10, bold: true };
        cell.border = { top: { style: 'thin', color: { argb: 'FF' + NAVY } } };
      });
    }
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    if (s.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + s.rows.length, column: s.columns.length } };
  }
  if (!p.sections.length) wb.addWorksheet('Report');
  return wb.xlsx.writeBuffer();
}

function toPdf(payload, meta) {
  const p = clean(payload);
  const wide = p.sections.some((s) => s.columns.length > 6);
  const doc = new PDFDocument({ size: 'A4', layout: wide ? 'landscape' : 'portrait', margins: { top: 40, bottom: 44, left: 36, right: 36 }, bufferPages: true, info: { Title: p.title, Author: meta.showroom } });
  doc.registerFont('r', FONT.r); doc.registerFont('b', FONT.b);
  const W = doc.page.width - 72, X0 = 36;
  const bottom = () => doc.page.height - 50;

  // report header (first page)
  doc.font('b').fontSize(9).fillColor('#' + TEAL).text(meta.showroom, X0, 36);
  doc.font('b').fontSize(17).fillColor('#' + NAVY).text(p.title, X0, 50, { width: W });
  if (p.subtitle) doc.font('r').fontSize(9.5).fillColor('#' + MUTED).text(p.subtitle, { width: W });
  doc.moveDown(0.8);

  for (const s of p.sections) {
    const cols = s.columns;
    if (!cols.length) continue;
    // column widths: numbers and dates get exactly what they need (never wrap),
    // text columns share the rest by their natural width
    const pad = 4, FS = cols.length > 9 ? 7.5 : 8.5;
    const sample = s.rows.slice(0, 400).concat(s.totals ? [s.totals] : []);
    const natural = cols.map((c, i) => {
      doc.font('b').fontSize(FS);
      let w = doc.widthOfString(c.label);
      doc.font('r').fontSize(FS);
      for (const r of sample) w = Math.max(w, doc.widthOfString(show(c, r[i]) || ''));
      return w + pad * 2 + 2;
    });
    const fixed = cols.map((c) => c.type !== 'text');
    let fixedW = natural.reduce((a, w, i) => a + (fixed[i] ? w : 0), 0);
    const textNat = natural.map((w, i) => (fixed[i] ? 0 : Math.min(w, 260)));
    const textSum = textNat.reduce((a, b) => a + b, 0);
    let room = W - fixedW;
    if (room < 60 * fixed.filter((f) => !f).length) {            // too many number columns: scale everything
      const k = W / natural.reduce((a, b) => a + b, 0); natural.forEach((w, i) => (natural[i] = w * k)); fixedW *= k; room = W - fixedW;
    }
    const widths = cols.map((c, i) => (fixed[i] ? natural[i] : textSum ? Math.max(50, (textNat[i] / textSum) * room) : room));
    const over = widths.reduce((a, b) => a + b, 0) - W;           // keep the table inside the page
    if (over > 0.5) { const t = widths.reduce((a, w, i) => a + (fixed[i] ? 0 : w), 0); cols.forEach((c, i) => { if (!fixed[i] && t) widths[i] -= over * (widths[i] / t); }); }
    const align = (c) => (c.type === 'money' || c.type === 'num' ? 'right' : 'left');

    const drawHead = () => {
      const h = 18;
      if (doc.y + h + 16 > bottom()) doc.addPage();
      const y = doc.y;
      doc.rect(X0, y, W, h).fill('#' + NAVY);
      let x = X0;
      cols.forEach((c, i) => {
        doc.font('b').fontSize(FS).fillColor('#FFFFFF').text(c.label, x + pad, y + 5, { width: widths[i] - pad * 2, align: align(c), lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + h;
    };
    if (s.heading) {
      if (doc.y + 60 > bottom()) doc.addPage();
      doc.font('b').fontSize(11.5).fillColor('#' + NAVY).text(s.heading, X0, doc.y + 6, { width: W });
      doc.moveDown(0.3);
    }
    drawHead();
    const drawRow = (vals, opts = {}) => {
      doc.font(opts.bold ? 'b' : 'r').fontSize(FS);
      const texts = cols.map((c, i) => show(c, vals[i]));
      const h = Math.max(...texts.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottom()) { doc.addPage(); drawHead(); doc.font(opts.bold ? 'b' : 'r').fontSize(FS); }
      const y = doc.y;
      if (opts.zebra) doc.rect(X0, y, W, h).fill('#' + ZEBRA);
      if (opts.bold) doc.moveTo(X0, y).lineTo(X0 + W, y).lineWidth(0.8).strokeColor('#' + NAVY).stroke();
      let x = X0;
      texts.forEach((t, i) => {
        doc.fillColor('#1E2A44').text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: align(cols[i]) });
        x += widths[i];
      });
      doc.moveTo(X0, y + h).lineTo(X0 + W, y + h).lineWidth(0.4).strokeColor('#' + LINE).stroke();
      doc.y = y + h;
    };
    if (!s.rows.length) {
      doc.font('r').fontSize(9).fillColor('#' + MUTED).text('No entries.', X0 + pad, doc.y + 6);
      doc.moveDown(0.6);
    }
    s.rows.forEach((r, i) => drawRow(r, { zebra: i % 2 === 1 }));
    if (s.totals) drawRow(s.totals, { bold: true });
    doc.x = X0;
    doc.moveDown(1);
  }

  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;            // writing inside the bottom margin must not add pages
    const y = doc.page.height - 30;
    doc.font('r').fontSize(7.5).fillColor('#' + MUTED)
      .text(`${p.title} · exported ${meta.when} by ${meta.user}`, X0, y, { width: W / 2, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, X0 + W / 2, y, { width: W / 2, align: 'right', lineBreak: false });
  }
  return new Promise((resolve) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

module.exports = { toExcel, toPdf };
