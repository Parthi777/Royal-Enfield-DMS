// Business logic on top of the store: rows, masters, users, approvals, ledger, dashboard.
const { FIRST_ROW, LAST_ROW, SHEETS, MASTERS, MASTER_LISTS, colIndex, colLetter, inputCols } = require('./schema');

const IST_MIN = 330;
const APPROVAL_MINUTES = 30;

// ---------- date helpers (sheet works in IST serial days) ----------
const serialToIso = (s) => {
  if (typeof s !== 'number' || !isFinite(s)) return s;
  const d = new Date(Math.round((s - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
};
const nowSerialIst = () => Date.now() / 86400000 + 25569 + IST_MIN / 1440;
const istStamp = (offsetMin = 0) => {
  const d = new Date(Date.now() + (IST_MIN + offsetMin) * 60000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const todayIst = () => istStamp().slice(0, 10);
const q = (name) => `'${name.replace(/'/g, "''")}'`;
const isEmpty = (v) => v === '' || v === null || v === undefined;

class DataService {
  constructor(store) {
    this.store = store;
    this.cache = new Map();
    this.locks = new Map();
  }

  // ---------- low level ----------
  async get(ranges, { fresh = false } = {}) {
    const key = ranges.join('|');
    const hit = this.cache.get(key);
    if (!fresh && hit && Date.now() - hit.t < 15000) return hit.v;
    const v = await this.store.get(ranges);
    this.cache.set(key, { t: Date.now(), v });
    return v;
  }
  async write(data) {
    await this.store.write(data);
    this.cache.clear();
  }
  async withLock(name, fn) {
    const prev = this.locks.get(name) || Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    this.locks.set(name, prev.then(() => next));
    await prev;
    try { return await fn(); } finally { release(); }
  }

  // ---------- sheets ----------
  async rows(key, opts = {}) {
    const sh = SHEETS[key];
    if (!sh) throw httpError(404, 'Unknown sheet');
    const [grid] = await this.get([`${q(sh.name)}!A${FIRST_ROW}:${sh.last}${LAST_ROW}`], opts);
    const ins = inputCols(sh);
    const out = [];
    grid.forEach((vals, i) => {
      const rec = { _row: FIRST_ROW + i };
      let any = false;
      sh.cols.forEach((c) => {
        let v = vals[colIndex(c.c) - 1];
        if (isEmpty(v)) v = '';
        if (c.type === 'date' && v !== '') v = serialToIso(v);
        rec[c.c] = v;
      });
      ins.forEach((c) => { if (rec[c.c] !== '') any = true; });
      if (any) out.push(rec);
    });
    return out;
  }

  async masters(opts = {}) {
    const [grid] = await this.get([`Masters!A3:K150`], opts);
    const lists = {};
    Object.values(MASTERS).forEach((n) => (lists[n] = []));
    grid.forEach((row) => {
      Object.entries(MASTERS).forEach(([col, name]) => {
        const v = row[colIndex(col) - 1];
        if (!isEmpty(v)) lists[name].push(v);
      });
    });
    const opening = {};
    lists.accounts.forEach((a, i) => (opening[a] = Number(grid[i]?.[colIndex('J') - 1]) || 0));
    delete lists.opening;
    return { lists, opening };
  }

  // ---------- Masters page ----------
  // where each list value is used: { list: { value: [{ sheet, c, row }] } }
  async usage() {
    const keys = Object.keys(SHEETS);
    const all = await Promise.all(keys.map((k) => this.rows(k, { fresh: true })));
    const out = {};
    keys.forEach((k, i) => SHEETS[k].cols.filter((c) => c.type === 'list' && c.list).forEach((c) => {
      all[i].forEach((r) => {
        const v = String(r[c.c]);
        if (v === '') return;
        const m = (out[c.list] = out[c.list] || {});
        (m[v] = m[v] || []).push({ sheet: SHEETS[k].name, c: c.c, row: r._row });
      });
    }));
    return out;
  }

  async masterPage() {
    const [{ lists, opening }, usage] = await Promise.all([this.masters({ fresh: true }), this.usage()]);
    const count = {};
    for (const [list, m] of Object.entries(usage)) count[list] = Object.fromEntries(Object.entries(m).map(([v, refs]) => [v, refs.length]));
    return { defs: MASTER_LISTS, lists, opening, used: count };
  }

  // items: [{ value, was, opening }] in the new order; was = the saved name it replaces (null for a new item)
  async saveMaster(user, key, items) {
    const def = MASTER_LISTS.find((d) => d.key === key);
    if (!def) throw httpError(404, 'Unknown list');
    if (def.locked) throw httpError(400, `${def.label} can't be changed: the sheet's rules work with these values only.`);
    if (!Array.isArray(items)) throw httpError(400, 'Send the list items');
    return this.withLock('Masters', async () => {
      const { lists, opening } = await this.masters({ fresh: true });
      const cur = lists[key].map(String);
      const seen = new Set(), out = [];
      for (const it of items) {
        const value = String(it?.value ?? '').trim().replace(/\s+/g, ' ');
        if (!value) throw httpError(400, 'An item is empty: type a name or remove it.');
        if (value.length > 60) throw httpError(400, `"${value.slice(0, 20)}…" is too long (60 characters at most).`);
        if (/^[=+\-@]/.test(value)) throw httpError(400, `"${value}": a name can't start with = + - or @.`);
        const k = value.toLowerCase();
        if (seen.has(k)) throw httpError(400, `"${value}" is in the list twice.`);
        seen.add(k);
        const was = it.was !== null && it.was !== undefined && cur.includes(String(it.was)) ? String(it.was) : null;
        let op = 0;
        if (def.opening) {
          op = it.opening === '' || it.opening === null || it.opening === undefined ? 0 : Number(it.opening);
          if (!isFinite(op)) throw httpError(400, `Opening balance of ${value} is not a number.`);
          op = Math.round(op * 100) / 100;
        }
        out.push({ value, was, opening: op });
      }
      if (!out.length) throw httpError(400, 'Keep at least one item.');
      if (out.length > def.max) throw httpError(400, `${def.label}: ${def.max} at most (that's what the sheet's dashboard has room for).`);
      const wasUsed = new Set();
      for (const o of out) {
        if (!o.was) continue;
        if (wasUsed.has(o.was)) throw httpError(400, `"${o.was}" can't become two items.`);
        wasUsed.add(o.was);
      }
      const removed = cur.filter((v) => !wasUsed.has(v));
      const renamed = out.filter((o) => o.was && o.was !== o.value);
      for (const f of def.fixed || []) {
        if (!cur.includes(f)) continue;
        if (removed.includes(f) || renamed.some((o) => o.was === f)) throw httpError(400, `"${f}" can't be renamed or removed: the sheet's formulas use it.`);
      }
      const usage = (await this.usage())[key] || {};
      if (def.opening) {
        const busy = removed.find((v) => usage[v]?.length);
        if (busy) throw httpError(400, `"${busy}" has ${usage[busy].length} saved entries, so it can't be removed. Rename it instead.`);
      }

      // write the list (and opening balances) top to bottom, blanking the rest
      const rows = 148;
      const col = (fn) => Array.from({ length: rows }, (_, i) => [i < out.length ? fn(out[i]) : '']);
      const writes = [{ range: `Masters!${def.col}3:${def.col}${2 + rows}`, values: col((o) => o.value) }];
      if (def.opening) writes.push({ range: `Masters!${def.opening}3:${def.opening}${2 + rows}`, values: col((o) => o.opening) });
      // carry renames into saved entries so old rows still match
      let moved = 0;
      for (const o of renamed) for (const ref of usage[o.was] || []) {
        writes.push({ range: `${q(ref.sheet)}!${ref.c}${ref.row}`, values: [[o.value]] });
        moved++;
      }
      await this.write(writes);

      const logs = [];
      for (const o of renamed) logs.push([def.label, o.was, `${o.value}${usage[o.was]?.length ? ` (and ${usage[o.was].length} saved entries)` : ''}`]);
      for (const o of out.filter((x) => !x.was)) logs.push([def.label, '(new)', o.value]);
      for (const v of removed) logs.push([def.label, v, '(removed)']);
      if (def.opening) for (const o of out) {
        const before = o.was ? (opening[o.was] || 0) : 0;
        if (o.was && before !== o.opening) logs.push([`${def.label}: opening balance of ${o.value}`, before, o.opening]);
      }
      if (logs.length) await this.logMany(user.email, 'Masters', logs);
      return { saved: out.length, entriesUpdated: moved };
    });
  }

  async engines() {
    const stock = await this.rows('stock');
    return stock.filter((r) => r.E !== '').map((r) => ({
      engine: String(r.E), model: r.B, variant: r.C, colour: r.D, frame: r.F,
      status: r.H || 'Available', to: r.I, value: r.G, row: r._row,
    }));
  }

  // ---------- edit requests ----------
  async requests() {
    const [grid] = await this.get([`'Edit Requests'!A3:I1002`]);
    return grid.map((r, i) => ({
      id: 3 + i, at: r[0], by: String(r[1] || '').toLowerCase(), sheet: r[2], row: Number(r[3]) || 0,
      entry: r[4] || '', reason: r[5] || '', status: r[6] || (r[0] !== '' && r[0] !== undefined ? 'Pending' : ''),
      decidedBy: r[7] || '', until: typeof r[8] === 'number' ? r[8] : null,
    })).filter((x) => x.sheet);
  }

  async approvalFor(sheetName, row, email) {
    const now = nowSerialIst();
    return (await this.requests()).find((x) => x.status === 'Approved' && x.sheet === sheetName && x.row === row &&
      x.by === email && x.until && x.until > now) || null;
  }

  async requestEdit(user, key, row, reason) {
    const sh = SHEETS[key];
    if (!sh) throw httpError(404, 'Unknown sheet');
    reason = String(reason || '').trim();
    if (!reason) throw httpError(400, 'Please write what you want to change and why');
    const rec = (await this.rows(key)).find((r) => r._row === row);
    if (!rec) throw httpError(404, 'Row not found');
    const entry = sh.cols.filter((c) => c.type !== 'auto').slice(0, 4).map((c) => rec[c.c]).filter((v) => v !== '').join(' · ');
    return this.withLock('Edit Requests', async () => {
      const [grid] = await this.get([`'Edit Requests'!A3:A1002`], { fresh: true });
      let idx = grid.findIndex((r) => isEmpty(r[0]));
      if (idx < 0) idx = grid.length;
      const at = 3 + idx;
      await this.write([{ range: `'Edit Requests'!A${at}:G${at}`, values: [[istStamp(), user.email, sh.name, row, safeText(entry), safeText(reason), 'Pending']] }]);
      return { id: at };
    });
  }

  async decide(user, id, status) {
    if (!['Approved', 'Rejected'].includes(status)) throw httpError(400, 'Bad status');
    const req = (await this.requests()).find((x) => x.id === id);
    if (!req) throw httpError(404, 'Request not found');
    const until = status === 'Approved' ? istStamp(APPROVAL_MINUTES) : '';
    await this.write([{ range: `'Edit Requests'!G${id}:I${id}`, values: [[status, user.email, until]] }]);
    await this.log(user.email, req.sheet, `Row ${req.row}`, `Edit ${status.toLowerCase()} for ${req.by}: ${req.reason}`, '');
    return { ok: true };
  }

  async logMany(user, sheet, rows) {
    await this.withLock('Edit Log', async () => {
      const [grid] = await this.get([`'Edit Log'!A2:A5000`], { fresh: true });
      let idx = grid.findIndex((r) => isEmpty(r[0]));
      if (idx < 0) idx = grid.length;
      const r = 2 + idx, stamp = istStamp();
      await this.write([{ range: `'Edit Log'!A${r}:F${r + rows.length - 1}`, values: rows.map(([cell, a, b]) => [stamp, user, sheet, cell, safeText(String(a)), safeText(String(b))]) }]);
    });
  }

  async log(user, sheet, cell, oldVal, newVal) {
    await this.withLock('Edit Log', async () => {
      const [grid] = await this.get([`'Edit Log'!A2:A5000`], { fresh: true });
      let idx = grid.findIndex((r) => isEmpty(r[0]));
      if (idx < 0) idx = grid.length;
      const r = 2 + idx;
      await this.write([{ range: `'Edit Log'!A${r}:F${r}`, values: [[istStamp(), user, sheet, cell, safeText(String(oldVal)), safeText(String(newVal))]] }]);
    });
  }

  // ---------- create / update ----------
  async create(user, key, body) {
    const sh = SHEETS[key];
    if (!sh) throw httpError(404, 'Unknown sheet');
    const ctx = await this.context();
    const vals = await this.clean(sh, body, ctx, { create: true });
    return this.withLock(sh.name, async () => {
      const all = await this.rows(key, { fresh: true });
      await this.checkRules(key, vals, all, null, ctx);
      const used = new Set(all.map((r) => r._row));
      let row = FIRST_ROW;
      while (used.has(row) && row <= LAST_ROW) row++;
      if (row > LAST_ROW) throw httpError(400, 'Sheet is full (1,000 rows). Ask the admin to extend it.');
      await this.write(cellWrites(sh, row, vals));
      return { row };
    });
  }

  async update(user, key, row, body) {
    const sh = SHEETS[key];
    if (!sh) throw httpError(404, 'Unknown sheet');
    const ctx = await this.context();
    const vals = await this.clean(sh, body, ctx, { create: false });
    return this.withLock(sh.name, async () => {
      const all = await this.rows(key, { fresh: true });
      const cur = all.find((r) => r._row === row);
      if (!cur) throw httpError(404, 'Row not found');
      const changed = {}, locked = [];
      for (const [c, v] of Object.entries(vals)) {
        if (String(cur[c]) === String(v)) continue;
        changed[c] = v;
        if (cur[c] !== '') locked.push(c);
      }
      if (!Object.keys(changed).length) return { row, changed: 0 };
      if (locked.length && user.perms?.[key] !== 'edit') {
        const ok = await this.approvalFor(sh.name, row, user.email);
        if (!ok) throw httpError(403, 'Saved values are locked. Send an edit request to the Admin first.');
      }
      await this.checkRules(key, { ...pickInputs(sh, cur), ...changed }, all, row, ctx, changed);
      await this.write(cellWrites(sh, row, changed));
      for (const c of locked) {
        const label = sh.cols.find((x) => x.c === c).label;
        await this.log(user.email, sh.name, `${c}${row} (${label})`, cur[c], changed[c] === '' ? '(cleared)' : changed[c]);
      }
      return { row, changed: Object.keys(changed).length };
    });
  }

  async context() {
    const [{ lists }, engines] = await Promise.all([this.masters(), this.engines()]);
    return { lists, engines };
  }

  // normalise + validate the input fields of one row
  async clean(sh, body, ctx, { create }) {
    const out = {};
    for (const col of inputCols(sh)) {
      if (!(col.c in body)) { if (create) out[col.c] = ''; continue; }
      let v = body[col.c];
      v = v === null || v === undefined ? '' : String(v).trim();
      if (v !== '') {
        if (col.type === 'date') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw httpError(400, `${col.label}: pick a date`);
        } else if (col.type === 'money') {
          const n = Number(v.replace(/[,₹\s]/g, ''));
          if (!isFinite(n) || n < 0) throw httpError(400, `${col.label}: enter an amount`);
          v = n;
        } else if (col.type === 'phone') {
          v = v.replace(/\D/g, '');
          if (v.length !== 10) throw httpError(400, `${col.label}: mobile number must be 10 digits`);
        } else if (col.type === 'list') {
          if (!(ctx.lists[col.list] || []).map(String).includes(v)) throw httpError(400, `${col.label}: pick from the list`);
        } else if (col.type === 'engine') {
          if (!ctx.engines.some((e) => e.engine === v)) throw httpError(400, `${col.label}: engine not in Vehicle Stock`);
        } else {
          v = v.slice(0, 200);
        }
      }
      out[col.c] = v;
    }
    if (create) {
      const missing = inputCols(sh).filter((c) => c.req && out[c.c] === '');
      if (missing.length) throw httpError(400, 'Please fill: ' + missing.map((c) => c.label).join(', '));
    }
    return out;
  }

  async checkRules(key, v, all, row, ctx, changed = null) {
    const others = all.filter((r) => r._row !== row);
    // money into a bank account (GPay, UPI, NEFT, card...) needs its UTR / reference number
    for (const c of SHEETS[key].cols.filter((x) => x.refOf)) {
      const touched = !changed || [c.c, c.refOf, c.amountOf].some((k) => k in changed);
      const amt = Number(v[c.amountOf]) || 0, acc = String(v[c.refOf] || '');
      if (touched && amt > 0 && acc && !/cash/i.test(acc) && !String(v[c.c] || '').trim()) {
        const what = SHEETS[key].cols.find((x) => x.c === c.amountOf).label;
        throw httpError(400, `${what} went to ${acc}: enter its UTR / reference no (GPay, UPI, NEFT, card).`);
      }
    }
    if (key === 'stock' && v.E !== undefined && v.E !== '') {
      if (others.some((r) => String(r.E).toLowerCase() === String(v.E).toLowerCase())) throw httpError(400, 'This engine number is already in stock');
    }
    if (key === 'bookings' && v.J) {
      const e = ctx.engines.find((x) => x.engine === v.J);
      if (others.some((r) => String(r.J) === v.J)) throw httpError(400, 'This engine is already allotted to another booking');
      if (e && e.status === 'Sold') throw httpError(400, 'This engine is already sold');
      if (e && v.D && e.model !== v.D) throw httpError(400, `Engine ${v.J} is a ${e.model}, booking is for ${v.D}`);
    }
    if (key === 'sales') {
      if (v.D && others.some((r) => String(r.D) === v.D)) throw httpError(400, 'This engine is already sold');
      if (v.I === 'Cash' && (v.J || Number(v.AB) > 0 || Number(v.AC) > 0)) throw httpError(400, 'Cash sale: leave financier and DD empty');
      if (v.I === 'HP' && !v.J) throw httpError(400, 'HP sale: pick the financier');
      for (const [a, d, acc, n] of [['S', 'T', 'U', 1], ['V', 'W', 'X', 2], ['Y', 'Z', 'AA', 3]]) {
        if (Number(v[a]) > 0 && (!v[d] || !v[acc])) throw httpError(400, `Payment ${n} needs a date and account`);
      }
      if (Number(v.AC) > 0 && (!v.AD || !v.AE)) throw httpError(400, 'DD received needs a date and account');
    }
    if (key === 'bank') {
      if (Number(v.E) > 0 && Number(v.F) > 0) throw httpError(400, 'Fill only Credit or Debit, not both');
      if (v.G && v.G === v.B) throw httpError(400, 'Contra account cannot be the same account');
    }
    if (key === 'expenses' && Number(v.F) > 0 && Number(v.G) > 0) throw httpError(400, 'Fill only Received or Paid, not both');
  }

  // ---------- bank ledger (same rules as the sheet) ----------
  async ledger() {
    const [{ lists, opening }, bk, sl, sv, ex, be] = await Promise.all([
      this.masters(), this.rows('bookings'), this.rows('sales'), this.rows('service'), this.rows('expenses'), this.rows('bank'),
    ]);
    const lines = [];
    const add = (date, account, inAmt, outAmt, text, from) => {
      if (!account || !date || (!inAmt && !outAmt)) return;
      lines.push({ date, account, in: inAmt || 0, out: outAmt || 0, text, from });
    };
    const utr = (x) => (x ? ` · UTR ${x}` : '');
    bk.forEach((r) => add(r.A, r.H, +r.G || 0, 0, `Booking advance – ${r.B} (${r.D})${utr(r.Q)}`, `Bookings · row ${r._row}`));
    sl.forEach((r) => {
      add(r.T, r.U, +r.S || 0, 0, `Payment 1 – ${r.B} (${r.E})${utr(r.AM)}`, `Vehicle Sales · row ${r._row}`);
      add(r.W, r.X, +r.V || 0, 0, `Payment 2 – ${r.B} (${r.E})${utr(r.AN)}`, `Vehicle Sales · row ${r._row}`);
      add(r.Z, r.AA, +r.Y || 0, 0, `Payment 3 – ${r.B} (${r.E})${utr(r.AO)}`, `Vehicle Sales · row ${r._row}`);
      add(r.AD, r.AE, +r.AC || 0, 0, `DD received – ${r.B} (${r.J})`, `Vehicle Sales · row ${r._row}`);
    });
    sv.forEach((r) => add(r.A, r.F, +r.E || 0, 0, `Service – ${r.B} ${r.C}`.trim() + utr(r.H), `Service · row ${r._row}`));
    ex.forEach((r) => add(r.A, r.E, +r.F || 0, +r.G || 0, `${r.B} [${r.D}]`, `Expenses · row ${r._row}`));
    be.forEach((r) => {
      add(r.A, r.B, +r.E || 0, +r.F || 0, `${r.C} [${r.D}]`, `Bank Entries · row ${r._row}`);
      if (r.G) add(r.A, r.G, +r.F || 0, +r.E || 0, `${r.C} [${r.D}] · contra ${r.B}`, `Bank Entries · row ${r._row}`);
    });
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const accounts = lists.accounts.map((a) => {
      const own = lines.filter((l) => l.account === a);
      let bal = opening[a] || 0;
      const rows = own.map((l) => ({ ...l, balance: (bal += l.in - l.out) }));
      return {
        account: a, opening: opening[a] || 0,
        received: own.reduce((s, l) => s + l.in, 0), paid: own.reduce((s, l) => s + l.out, 0),
        closing: bal, lines: rows,
      };
    });
    const unposted = [
      ...bk.filter((r) => +r.G > 0 && !r.H).map((r) => +r.G),
      ...sl.flatMap((r) => [[r.S, r.U], [r.V, r.X], [r.Y, r.AA], [r.AC, r.AE]].filter(([a, acc]) => +a > 0 && !acc).map(([a]) => +a)),
      ...sv.filter((r) => +r.E > 0 && !r.F).map((r) => +r.E),
    ].reduce((s, x) => s + x, 0);
    return { accounts, unposted };
  }

  // ---------- dashboard (values computed by the sheet's own formulas) ----------
  async dashboard() {
    const [grid, d6] = await this.get([`Dashboard!B8:M160`, `Dashboard!D6`]);
    const cell = (r, c) => { const v = grid[r - 8]?.[colIndex(c) - 2]; return isEmpty(v) ? '' : v; };
    const tile = (r, c) => ({ label: cell(r, c), value: cell(r + 1, c), sub: cell(r + 2, c) });
    const card = (r, c) => ({ label: cell(r, c), value: cell(r + 1, c), sub: cell(r + 3, c) });
    const range = (r1, r2, fn) => { const o = []; for (let r = r1; r <= r2; r++) { const x = fn(r); if (x) o.push(x); } return o; };
    const money = new Set(['SERVICE AMOUNT', 'SALES VALUE (ON-ROAD)', 'BANK DEPOSIT', 'BANK TRANSFER', 'OPENING BALANCE', 'CLOSING BALANCE', 'STOCK VALUE']);
    const today = [...['B', 'D', 'F', 'H', 'J', 'L'].map((c) => tile(9, c)), ...['B', 'D', 'F', 'H', 'J', 'L'].map((c) => tile(13, c))]
      .map((t) => ({ ...t, money: money.has(t.label) }));
    const month = [...['B', 'E', 'H', 'K'].map((c) => card(18, c)), ...['B', 'E', 'H', 'K'].map((c) => card(23, c))]
      .map((t) => ({ ...t, money: !/SOLD|BOOKINGS/.test(t.label) }));
    return {
      reportDate: serialToIso(d6[0]?.[0]) || todayIst(),
      today, month,
      bank: range(30, 41, (r) => cell(r, 'B') && { account: cell(r, 'B'), opening: +cell(r, 'D') || 0, received: +cell(r, 'E') || 0, paid: +cell(r, 'F') || 0, closing: +cell(r, 'G') || 0 }),
      bankTotal: { opening: +cell(42, 'D') || 0, received: +cell(42, 'E') || 0, paid: +cell(42, 'F') || 0, closing: +cell(42, 'G') || 0 },
      monthly: range(46, 57, (r) => ({ month: serialToIso(cell(r, 'B')), sold: +cell(r, 'C') || 0, bookings: +cell(r, 'D') || 0, collections: +cell(r, 'E') || 0, service: +cell(r, 'G') || 0, expenses: +cell(r, 'H') || 0 })),
      models: range(62, 81, (r) => cell(r, 'B') && { model: cell(r, 'B'), available: +cell(r, 'D') || 0, allotted: +cell(r, 'E') || 0, sold: +cell(r, 'F') || 0, waiting: +cell(r, 'G') || 0 }),
      mix: range(86, 87, (r) => cell(r, 'B') && { mode: cell(r, 'B'), count: +cell(r, 'D') || 0 }),
      financiers: range(86, 101, (r) => cell(r, 'G') && +cell(r, 'J') > 0 && { name: cell(r, 'G'), count: +cell(r, 'J') || 0, dd: +cell(r, 'K') || 0 }),
      overdue: range(106, 120, (r) => cell(r, 'B') && { customer: cell(r, 'B'), mobile: cell(r, 'E'), model: cell(r, 'G'), commitment: serialToIso(cell(r, 'I')), late: +cell(r, 'K') || 0, advance: +cell(r, 'L') || 0 }),
      balances: range(125, 139, (r) => cell(r, 'B') && { customer: cell(r, 'B'), mobile: cell(r, 'E'), model: cell(r, 'G'), owes: +cell(r, 'I') || 0, dd: +cell(r, 'K') || 0, date: serialToIso(cell(r, 'M')) }),
      expenses: range(144, 156, (r) => cell(r, 'B') && +cell(r, 'E') > 0 && { category: cell(r, 'B'), paid: +cell(r, 'E') || 0 }),
      ageing: range(144, 147, (r) => cell(r, 'I') && { label: cell(r, 'I'), bikes: +cell(r, 'K') || 0 }),
    };
  }
}

function pickInputs(sh, rec) {
  const o = {};
  inputCols(sh).forEach((c) => (o[c.c] = rec[c.c]));
  return o;
}

// one range per cell, so formula columns between inputs are never touched
function cellWrites(sh, row, vals) {
  return Object.entries(vals).map(([c, v]) => {
    const col = sh.cols.find((x) => x.c === c);
    let val = v;
    if (col.type === 'text') val = safeText(v);
    if (col.type === 'phone' && v !== '') val = String(v);
    return { range: `${q(sh.name)}!${c}${row}`, values: [[val]] };
  });
}

// stop text from being read as a formula
function safeText(v) {
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { DataService, httpError, todayIst, colLetter };
