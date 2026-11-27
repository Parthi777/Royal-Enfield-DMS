// One-time imports: imports/*.json are added once at start-up.
// Masters items are added if missing; stock is skipped when the engine no is already there;
// a booking is skipped when the app sees it as a double entry. A marker on /data stops a second run.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'imports');
const MARK_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');

async function runImports(data) {
  if (!fs.existsSync(DIR)) return;
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
    const job = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const mark = path.join(MARK_DIR, `import-${job.name || f}.done`);
    if (fs.existsSync(mark)) continue;
    const user = { email: `Import ${job.name || f}`, name: 'Import' };
    const out = { masters: 0, stock: 0, bookings: 0, skipped: [] };
    for (const [key, add] of Object.entries(job.masters || {})) {
      const { lists } = await data.masters({ fresh: true });
      const cur = (lists[key] || []).map(String);
      const have = new Set(cur.map((v) => v.toLowerCase()));
      const extra = add.filter((v) => !have.has(String(v).toLowerCase()));
      if (!extra.length) continue;
      await data.saveMaster(user, key, [...cur.map((v) => ({ value: v, was: v })), ...extra.map((v) => ({ value: v }))]);
      out.masters += extra.length;
    }
    for (const [key, rows] of [['stock', job.stock || []], ['bookings', job.bookings || []]]) {
      for (const r of rows) {
        try { await data.create(user, key, r); out[key]++; }
        catch (e) { out.skipped.push(`${key} ${r.E || r.B || ''}: ${e.message}`); }
      }
    }
    console.log(`IMPORT ${f}: ${out.masters} master items, ${out.stock} stock, ${out.bookings} bookings added; ${out.skipped.length} skipped`);
    out.skipped.forEach((s) => console.log('  skipped ' + s));
    try { fs.mkdirSync(MARK_DIR, { recursive: true }); fs.writeFileSync(mark, JSON.stringify({ at: new Date().toISOString(), ...out }, null, 1)); } catch (e) { console.log('IMPORT marker not saved: ' + e.message); }
  }
}
module.exports = { runImports };
