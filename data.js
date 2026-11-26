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
  async requests(opts = {}) {
    const [grid] = await this.get([`'Edit Requests'!A3:I1002`], opts);
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
    const req = (await this.requests({ fresh: true })).find((x) => x.id === id);
    if (!req) throw httpError(404, 'Request not found');
    // a pending request can be approved or rejected; an approval can be withdrawn (Rejected); nothing else reopens
    const withdraw = req.status === 'Approved' && status === 'Rejected';
    if (req.status !== 'Pending' && !withdraw) throw httpError(400, `This request was already ${req.status.toLowerCase()}${req.decidedBy ? ' by ' + req.decidedBy : ''}.`);
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
      if (locked.length && user.perms?.[sh.perm || key] !== 'edit') {
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
    const [{ lists }, engines, sales] = await Promise.all([this.masters(), this.engines(), this.rows('sales')]);
    return { lists, engines, sold: new Set(sales.filter((r) => r.D !== '').map((r) => String(r.D))) };
  }

  // engines of saved sales, for the Sale Payments form
  async soldList() {
    const sales = await this.rows('sales');
    return sales.filter((r) => r.D !== '').map((r) => ({ engine: String(r.D), customer: r.B, model: r.E, date: r.A, row: r._row }));
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
          const [y, m, d] = v.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d));
          if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw httpError(400, `${col.label}: ${v} is not a real date`);
          if (y < 2000 || y > 2100) throw httpError(400, `${col.label}: check the year`);
        } else if (col.type === 'money') {
          const n = Number(v.replace(/[,₹\s]/g, ''));
          if (!isFinite(n) || n < 0) throw httpError(400, `${col.label}: enter an amount`);
          v = n;
        } else if (col.type === 'phone') {
          v = v.replace(/\D/g, '');
          if (v.length !== 10) throw httpError(400, `${col.label}: mobile number must be 10 digits`);
        } else if (col.type === 'list') {
          if (!(ctx.lists[col.list] || []).map(String).includes(v)) throw httpError(400, `${col.label}: pick from the list`);
        } else if (col.type === 'sold') {
          if (!ctx.sold.has(v)) throw httpError(400, `${col.label}: pick the engine no of a saved sale`);
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
      if (v.I === 'Cash' && (v.J || Number(v.S) > 0 || Number(v.AB) > 0 || Number(v.AC) > 0)) throw httpError(400, 'Cash sale: leave financier, document charges and DD empty');
      if (v.I === 'HP' && !v.J) throw httpError(400, 'HP sale: pick the financier');
      if (Number(v.AC) > 0 && (!v.AD || !v.AE)) throw httpError(400, 'DD received needs a date and account');
    }
    if (key === 'bank') {
      if (Number(v.E) > 0 && Number(v.F) > 0) throw httpError(400, 'Fill only Credit or Debit, not both');
      if (v.G && v.G === v.B) throw httpError(400, 'Contra account cannot be the same account');
    }
    // the same checks the sheet's Check column makes, enforced when the fields involved are saved
    const touch = (...cols) => !changed || cols.some((c) => c in changed);
    if (key === 'expenses' && touch('E') && !(Number(v.E) > 0)) throw httpError(400, 'Enter the amount paid');
    if (key === 'bank' && touch('E', 'F') && !(Number(v.E) > 0) && !(Number(v.F) > 0)) throw httpError(400, 'Enter the amount in Credit / in or Debit / out');
    if (key === 'bookings' && touch('A', 'I') && v.I && v.A && String(v.I) < String(v.A)) throw httpError(400, 'Commitment date can\'t be before the booking date');
  }

  // ---------- bank ledger (same rules as the sheet) ----------
  // every money movement, one line per account side. kind: receipt | payment | contra
  async ledger() {
    const [{ lists, opening }, bk, sl, sp, sv, ex, be] = await Promise.all([
      this.masters(), this.rows('bookings'), this.rows('sales'), this.rows('payments'), this.rows('service'), this.rows('expenses'), this.rows('bank'),
    ]);
    const lines = [];
    let seq = 0;
    const add = (date, account, inAmt, outAmt, text, from, kind, ref) => {
      if (!account || !date || (!inAmt && !outAmt)) return;
      lines.push({ date, account, in: inAmt || 0, out: outAmt || 0, text, from, kind, ref, seq: seq++ });
    };
    const utr = (x) => (x ? ` · UTR ${x}` : '');
    bk.forEach((r) => add(r.A, r.H, +r.G || 0, 0, `Booking advance – ${r.B} (${r.D})${utr(r.P)}`, `Bookings · row ${r._row}`, 'receipt', ['bookings', r._row]));
    sp.forEach((r) => add(r.A, r.E, +r.D || 0, 0, `Sale payment – ${r.C || ''} (${r.B})${utr(r.F)}${r.G ? ' · ' + r.G : ''}`, `Sale Payments · row ${r._row}`, 'receipt', ['payments', r._row]));
    sl.forEach((r) => add(r.AD, r.AE, +r.AC || 0, 0, `Finance DD – ${r.B} (${r.J || 'HP'})`, `Vehicle Sales · row ${r._row}`, 'receipt', ['sales', r._row]));
    sv.forEach((r) => add(r.A, r.F, +r.E || 0, 0, `Service – ${r.B} ${r.C}`.trim() + utr(r.G), `Service · row ${r._row}`, 'receipt', ['service', r._row]));
    ex.forEach((r) => add(r.A, r.D, 0, +r.E || 0, `${r.B} [${r.C}]${r.F ? ' · ' + r.F : ''}`, `Expenses · row ${r._row}`, 'payment', ['expenses', r._row]));
    be.forEach((r) => {
      const kind = r.G ? 'contra' : +r.E > 0 ? 'receipt' : 'payment';
      add(r.A, r.B, +r.E || 0, +r.F || 0, `${r.C} [${r.D}]`, `Bank Entries · row ${r._row}`, kind, ['bank', r._row]);
      if (r.G) add(r.A, r.G, +r.F || 0, +r.E || 0, `${r.C} [${r.D}] · contra ${r.B}`, `Bank Entries · row ${r._row}`, 'contra', ['bank', r._row]);
    });
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    const accounts = lists.accounts.map((a) => {
      const own = lines.filter((l) => l.account === a);
      let bal = opening[a] || 0;
      const rows = own.map((l) => ({ ...l, balance: (bal += l.in - l.out) }));
      return {
        account: a, cash: isCash(a), opening: opening[a] || 0,
        received: own.reduce((s, l) => s + l.in, 0), paid: own.reduce((s, l) => s + l.out, 0),
        closing: bal, lines: rows,
      };
    });
    const unposted = [
      ...bk.filter((r) => +r.G > 0 && !r.H).map((r) => +r.G),
      ...sp.filter((r) => +r.D > 0 && !r.E).map((r) => +r.D),
      ...sl.filter((r) => +r.AC > 0 && !r.AE).map((r) => +r.AC),
      ...sv.filter((r) => +r.E > 0 && !r.F).map((r) => +r.E),
    ].reduce((s, x) => s + x, 0);
    return { accounts, unposted };
  }

  // balance of each account at the start and end of a period, and what moved in between
  static balances(accounts, from, to) {
    return accounts.map((a) => {
      const before = a.lines.filter((l) => l.date < from), inside = a.lines.filter((l) => l.date >= from && l.date <= to);
      const open = a.opening + before.reduce((s, l) => s + l.in - l.out, 0);
      const inn = inside.reduce((s, l) => s + l.in, 0), out = inside.reduce((s, l) => s + l.out, 0);
      return { account: a.account, cash: a.cash, opening: open, received: inn, paid: out, closing: open + inn - out };
    });
  }

  // ---------- day book: every entry of one day, with opening and closing cash and bank ----------
  async daybook(date) {
    const { accounts } = await this.ledger();
    const bal = DataService.balances(accounts, date, date);
    const entries = accounts.flatMap((a) => a.lines.filter((l) => l.date === date).map((l) => ({ ...l, cash: a.cash })))
      .sort((x, y) => x.seq - y.seq || (x.in ? -1 : 1));
    const sum = (list, k) => list.reduce((s, x) => s + x[k], 0);
    const group = (cash) => { const g = bal.filter((b) => b.cash === cash); return { opening: sum(g, 'opening'), received: sum(g, 'received'), paid: sum(g, 'paid'), closing: sum(g, 'closing') }; };
    return { date, entries, accounts: bal, cash: group(true), bank: group(false) };
  }

  // ---------- dashboard: worked out from the entries themselves ----------
  async dashboard() {
    const [{ lists }, st, bk, sl, sp, sv, ex, be, L] = await Promise.all([
      this.masters(), this.rows('stock'), this.rows('bookings'), this.rows('sales'), this.rows('payments'),
      this.rows('service'), this.rows('expenses'), this.rows('bank'), this.ledger(),
    ]);
    const today = todayIst(), month = today.slice(0, 7), mStart = `${month}-01`;
    const inDay = (d) => d === today, inMonth = (d) => typeof d === 'string' && d.slice(0, 7) === month && d <= today;
    const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
    const group = (bal, cash) => { const g = bal.filter((b) => b.cash === cash); return { opening: sum(g, (b) => b.opening), received: sum(g, (b) => b.received), paid: sum(g, (b) => b.paid), closing: sum(g, (b) => b.closing) }; };

    const period = (pick, from) => {
      const sales = sl.filter((r) => pick(r.A)), books = bk.filter((r) => pick(r.A)), svc = sv.filter((r) => pick(r.A));
      const exps = ex.filter((r) => pick(r.A) && +r.E > 0);
      const deposits = be.filter((r) => pick(r.A) && r.D === 'Cash Deposit');
      const collections = sum(bk.filter((r) => pick(r.A)), (r) => r.G) + sum(sp.filter((r) => pick(r.A)), (r) => r.D)
        + sum(sl.filter((r) => pick(r.AD)), (r) => r.AC) + sum(svc, (r) => r.E);
      const bal = DataService.balances(L.accounts, from, today);
      return {
        sold: sales.length, hp: sales.filter((r) => r.I === 'HP').length, cashSales: sales.filter((r) => r.I === 'Cash').length,
        salesValue: sum(sales, (r) => r.Q), bookings: books.length, advance: sum(books, (r) => r.G),
        service: svc.length, serviceValue: sum(svc, (r) => r.E), collections,
        expenses: sum(exps, (r) => r.E), expenseCount: exps.length,
        deposit: sum(deposits, (r) => (+r.E || 0) + (+r.F || 0)), depositCount: deposits.length,
        cash: group(bal, true), bank: group(bal, false), accounts: bal,
      };
    };
    const T = period(inDay, today), M = period(inMonth, mStart);

    // follow-up lists
    const open = bk.filter((r) => r.M !== 'Delivered');
    const overdue = open.filter((r) => r.I && r.I < today).map((r) => ({ customer: r.B, mobile: r.C, model: r.D, commitment: r.I, late: Math.round((Date.parse(today) - Date.parse(r.I)) / 864e5), advance: +r.G || 0 }))
      .sort((a, b) => b.late - a.late);
    const balances = sl.filter((r) => (+r.AI || 0) >= 0.5 || (+r.AH || 0) >= 0.5)
      .map((r) => ({ customer: r.B, mobile: r.C, model: r.E, owes: Math.max(0, +r.AI || 0), dd: Math.max(0, +r.AH || 0), date: r.A }));

    // last 6 months: bikes sold and money collected from customers
    const months = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 - k, 1));
      const ym = d.toISOString().slice(0, 7), pick = (x) => typeof x === 'string' && x.slice(0, 7) === ym;
      months.push({ month: `${ym}-01`, sold: sl.filter((r) => pick(r.A)).length,
        collections: sum(bk.filter((r) => pick(r.A)), (r) => r.G) + sum(sp.filter((r) => pick(r.A)), (r) => r.D) + sum(sl.filter((r) => pick(r.AD)), (r) => r.AC) + sum(sv.filter((r) => pick(r.A)), (r) => r.E) });
    }
    // money in and out per day this month (for the chart)
    const days = [];
    for (let d = 1; d <= +today.slice(8, 10); d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const ls = L.accounts.flatMap((a) => a.lines.filter((l) => l.date === iso && l.kind !== 'contra'));
      days.push({ date: iso, in: sum(ls, (l) => l.in), out: sum(ls, (l) => l.out) });
    }
    // stock by model vs customers waiting
    const models = lists.models.map((m) => ({
      model: m,
      available: st.filter((r) => r.B === m && r.H === 'Available').length,
      allotted: st.filter((r) => r.B === m && r.H === 'Allotted').length,
      sold: sl.filter((r) => r.E === m && inMonth(r.A)).length,
      waiting: open.filter((r) => r.D === m && !r.J).length,
    }));
    const monthSales = sl.filter((r) => inMonth(r.A));
    const mix = ['Cash', 'HP'].map((mode) => ({ mode, count: monthSales.filter((r) => r.I === mode).length }));
    const financiers = [...new Set(monthSales.filter((r) => r.I === 'HP' && r.J).map((r) => r.J))]
      .map((n) => ({ name: n, count: monthSales.filter((r) => r.J === n).length, dd: sum(monthSales.filter((r) => r.J === n), (r) => r.AB) }));
    const expenses = [...new Set(ex.filter((r) => inMonth(r.A) && +r.E > 0).map((r) => r.C))]
      .map((c) => ({ category: c, paid: sum(ex.filter((r) => inMonth(r.A) && r.C === c), (r) => r.E) })).sort((a, b) => b.paid - a.paid);
    const instock = st.filter((r) => r.H === 'Available' || r.H === 'Allotted');
    const ageing = [{ label: '0–30 days', vehicles: instock.filter((r) => +r.J <= 30).length }, { label: '31–60 days', vehicles: instock.filter((r) => +r.J > 30 && +r.J <= 60).length },
      { label: '61–90 days', vehicles: instock.filter((r) => +r.J > 60 && +r.J <= 90).length }, { label: 'Over 90 days', vehicles: instock.filter((r) => +r.J > 90).length }];

    return {
      reportDate: today, today: T, month: M, unposted: L.unposted,
      openBookings: open.length, allottedOpen: open.filter((r) => r.J).length,
      customerDue: sum(balances, (b) => b.owes), ddPending: sum(balances, (b) => b.dd),
      overdue, balances, months, days, models, mix, financiers, expenses, ageing,
    };
  }
}

const isCash = (a) => /cash/i.test(String(a));

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
