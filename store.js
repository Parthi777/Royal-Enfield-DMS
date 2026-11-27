// Data access: Google Sheets (live) or an in-memory copy (DEMO_MODE).
// Both expose: get(ranges[]) -> [[[...]]] and write([{range, values}]).
// Values are UNFORMATTED (numbers stay numbers, dates are serial numbers).

const fs = require('fs');
const path = require('path');
const { colIndex } = require('./schema');
const { recompute } = require('./demo-calc');

function parseA1(a1) {
  // 'Vehicle Sales'!A3:AL1002  or  Users!A3
  const m = a1.match(/^(?:'((?:[^']|'')+)'|([^!]+))!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('Bad range ' + a1);
  const sheet = (m[1] || m[2]).replace(/''/g, "'");
  const c1 = colIndex(m[3]), r1 = +m[4];
  const c2 = m[5] ? colIndex(m[5]) : c1, r2 = m[6] ? +m[6] : r1;
  return { sheet, c1, r1, c2, r2 };
}

class GoogleStore {
  constructor({ sheetId, credentials }) {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = google.sheets({ version: 'v4', auth });
    this.sheetId = sheetId;
    this.email = credentials.client_email;
  }
  async get(ranges) {
    const res = await this.api.spreadsheets.values.batchGet({
      spreadsheetId: this.sheetId, ranges,
      valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    return res.data.valueRanges.map((v) => v.values || []);
  }
  async write(data) {
    if (!data.length) return;
    await this.api.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
  }
}

// Without the Google Sheet, entries live here. With a save file (on the Railway volume) they are written
// to disk after every change, so restarts and updates never lose them; a dated copy is kept for 14 days.
class MemoryStore {
  constructor(template, saveFile = null) {
    this.saveFile = saveFile;
    const start = saveFile && fs.existsSync(saveFile) ? saveFile : template;
    this.grid = JSON.parse(fs.readFileSync(start, 'utf8'));   // { sheet: { "row": [values from col A] } }
    recompute(this.grid);   // fill the computed columns the way the sheet's formulas would
    this.email = 'demo-mode';
    this.loadedFrom = start;
  }
  persist() {
    if (!this.saveFile) return;
    const body = JSON.stringify(this.grid);
    const tmp = this.saveFile + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.saveFile);   // atomic: a crash mid-write leaves the old file whole
    const dir = path.dirname(this.saveFile);
    const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(dir, `app-data-${day}.json`), body);
    const old = fs.readdirSync(dir).filter((f) => /^app-data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  }
  async get(ranges) {
    return ranges.map((a1) => {
      const { sheet, c1, r1, c2, r2 } = parseA1(a1);
      const g = this.grid[sheet] || {};
      const out = [];
      for (let r = r1; r <= r2; r++) {
        const row = g[r] || [];
        out.push(row.slice(c1 - 1, c2).map((v) => (v === null || v === undefined ? '' : v)));
      }
      while (out.length && out[out.length - 1].every((v) => v === '')) out.pop();
      return out;
    });
  }
  async write(data) {
    for (const { range, values } of data) {
      const { sheet, c1, r1 } = parseA1(range);
      const g = (this.grid[sheet] = this.grid[sheet] || {});
      values.forEach((vals, i) => {
        const row = (g[r1 + i] = g[r1 + i] || []);
        vals.forEach((v, j) => {
          let val = v;
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v)) val = isoToSerial(v);
          else if (typeof v === 'string' && v !== '' && !isNaN(v) && !/^0\d/.test(v)) val = Number(v);
          row[c1 - 1 + j] = val;
        });
      });
    }
    recompute(this.grid);
    this.persist();
  }
}

function isoToSerial(s) {
  const [d, t] = s.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  let serial = (Date.UTC(y, m - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
  if (t) {
    const [hh, mm, ss] = t.split(':').map(Number);
    serial += (hh * 3600 + mm * 60 + (ss || 0)) / 86400;
  }
  return serial;
}

function makeStore() {
  if (process.env.DEMO_MODE === 'true' || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const dir = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : null);
    let saveFile = null;
    if (dir) { fs.mkdirSync(dir, { recursive: true }); saveFile = path.join(dir, 'app-data.json'); }
    return { store: new MemoryStore(path.join(__dirname, 'demo-data.json'), saveFile), demo: true, saveFile };
  }
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  const credentials = JSON.parse(raw);
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID is not set');
  return { store: new GoogleStore({ sheetId, credentials }), demo: false };
}

module.exports = { makeStore, parseA1, isoToSerial };
