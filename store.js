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
  constructor(template, saveFile = null, grid = null) {
    this.saveFile = saveFile;
    const start = grid ? 'database' : saveFile && fs.existsSync(saveFile) ? saveFile : template;
    this.grid = grid || JSON.parse(fs.readFileSync(start, 'utf8'));   // { sheet: { "row": [values from col A] } }
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

// PostgreSQL on Railway: the main database. Every row of every tab is one record (sheet, row_no, values).
// All rows are loaded at start (a showroom has thousands, not millions); each change is saved in one
// transaction before the app answers, so a restart or update never loses an entry. A daily JSON copy is
// also kept on the volume for 14 days.
class PgStore {
  constructor(url, template, legacyFile, backupDir) {
    const { Pool } = require('pg');
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const local = /\.railway\.internal$|^localhost$|^127\.|^\/|^$/.test(host);
    this.pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000,
      ssl: local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
    // a dropped idle connection (database restart, network blip) must not stop the app; the pool reconnects
    this.pool.on('error', (e) => console.error('Database connection lost:', e.message));
    this.template = template; this.legacyFile = legacyFile; this.backupDir = backupDir;
    this.email = 'postgres';
    this.ready = this.init();
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sheet_rows (
      sheet text NOT NULL, row_no integer NOT NULL, vals jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (sheet, row_no))`);
    const { rows } = await this.pool.query('SELECT sheet, row_no, vals FROM sheet_rows');
    if (rows.length) {
      const grid = {};
      for (const r of rows) (grid[r.sheet] = grid[r.sheet] || {})[r.row_no] = r.vals;
      this.mem = new MemoryStore(this.template, null, grid);
      this.loadedFrom = 'database';
    } else {
      // first start: bring in entries kept on the volume (if any), else start from the empty layout
      const start = this.legacyFile && fs.existsSync(this.legacyFile) ? this.legacyFile : this.template;
      this.mem = new MemoryStore(start);
      await this.save(Object.entries(this.mem.grid).flatMap(([sheet, g]) => Object.keys(g).map((row) => [sheet, Number(row)])));
      this.loadedFrom = start;
    }
    this.rowCount = Object.values(this.mem.grid).reduce((n, g) => n + Object.keys(g).length, 0);
  }
  async save(keys) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [sheet, row] of keys) {
        const vals = (this.mem.grid[sheet] || {})[row] || [];
        await client.query(`INSERT INTO sheet_rows (sheet, row_no, vals, updated_at) VALUES ($1, $2, $3, now())
          ON CONFLICT (sheet, row_no) DO UPDATE SET vals = EXCLUDED.vals, updated_at = now()`, [sheet, row, JSON.stringify(vals)]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }
  async get(ranges) { await this.ready; return this.mem.get(ranges); }
  async write(data) {
    await this.ready;
    const keys = [];
    for (const { range, values } of data) {
      const { sheet, r1 } = parseA1(range);
      values.forEach((_, i) => keys.push([sheet, r1 + i]));
    }
    const uniq = [...new Map(keys.map((k) => [k.join('|'), k])).values()];
    const before = uniq.map(([sh, r]) => [sh, r, this.mem.grid[sh] && this.mem.grid[sh][r] ? [...this.mem.grid[sh][r]] : undefined]);
    await this.mem.write(data);
    try {
      await this.save(uniq);
    } catch (e) {
      // the database did not take it: undo the change in memory, so the screen never shows unsaved data
      console.error('Database save failed:', e.message);
      for (const [sh, r, row] of before) {
        if (row === undefined) { if (this.mem.grid[sh]) delete this.mem.grid[sh][r]; } else (this.mem.grid[sh] = this.mem.grid[sh] || {})[r] = row;
      }
      recompute(this.mem.grid);
      throw Object.assign(new Error('Could not save to the database. Please try again.'), { status: 503, keepMessage: true });
    }
    this.snapshot();
  }
  snapshot() {
    if (!this.backupDir || Date.now() - (this.lastSnap || 0) < 10 * 60000) return;
    this.lastSnap = Date.now();
    try {
      const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      fs.writeFileSync(path.join(this.backupDir, `db-backup-${day}.json`), JSON.stringify(this.mem.grid));
      const old = fs.readdirSync(this.backupDir).filter((f) => /^db-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
      for (const f of old) fs.unlinkSync(path.join(this.backupDir, f));
    } catch (e) { console.error('Backup copy failed:', e.message); }
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
  const volume = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : null);
  if (process.env.DATABASE_URL) {   // the database always wins: DEMO_MODE only matters without one
    if (volume) fs.mkdirSync(volume, { recursive: true });
    const store = new PgStore(process.env.DATABASE_URL, path.join(__dirname, 'demo-data.json'), volume && path.join(volume, 'app-data.json'), volume);
    return { store, demo: false, kind: 'postgres' };
  }
  if (process.env.DEMO_MODE === 'true' || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const dir = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : null);
    let saveFile = null;
    if (dir) { fs.mkdirSync(dir, { recursive: true }); saveFile = path.join(dir, 'app-data.json'); }
    return { store: new MemoryStore(path.join(__dirname, 'demo-data.json'), saveFile), demo: true, saveFile, kind: 'file' };
  }
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  const credentials = JSON.parse(raw);
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID is not set');
  return { store: new GoogleStore({ sheetId, credentials }), demo: false, kind: 'sheet' };
}

module.exports = { makeStore, parseA1, isoToSerial };
