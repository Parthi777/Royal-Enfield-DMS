const fs = require('fs');
// RE Showroom web app: username/password sign-in, roles with per-section access, data in the Google Sheet.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { makeStore } = require('./store');
const { DataService } = require('./data');
const { SHEETS } = require('./schema');
const { Accounts, MODULES, LEVELS, rank } = require('./accounts');
const { toExcel, toPdf } = require('./export');

const PORT = process.env.PORT || 3000;
const SHOWROOM = process.env.SHOWROOM_NAME || 'Pradhanaa Motors LLP';
const SESSION_HOURS = 12;

const { store, demo } = makeStore();
const data = new DataService(store);
const accounts = new Accounts();
// signing key: env if given, else one generated once and kept with the accounts
if (!accounts.db.secret) { accounts.db.secret = crypto.randomBytes(32).toString('hex'); accounts.save(); }
const SECRET = process.env.SESSION_SECRET || accounts.db.secret;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' });
  next();
});

// ---------- session cookie (signed, httpOnly) ----------
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function setSession(res, user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, ver: user.ver || 0, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  res.setHeader('Set-Cookie', `re_sess=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function readSession(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)re_sess=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const s = JSON.parse(Buffer.from(body, 'base64url').toString()); return s.exp > Date.now() ? s : null; } catch { return null; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const deny = (res, msg = 'You do not have access to this. Ask the Admin.') => res.status(403).json({ error: msg });

// signed in; `check` decides access for this route
const auth = (check) => (req, res, next) => {
  const s = readSession(req);
  const user = s && accounts.session(s.uid, s.ver);
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  if (user.mustChange && !req.path.startsWith('/api/auth/')) return res.status(403).json({ error: 'Please set a new password first', mustChange: true });
  if (check && !check(user, req)) return deny(res);
  next();
};
const can = (key, level) => (u, req) => rank(u.perms[typeof key === 'function' ? key(req) : key]) >= rank(level);
const sheetKey = (req) => req.params.key;
const sameOrigin = (req, res, next) => (req.get('X-RE-App') === '1' ? next() : res.status(400).json({ error: 'Bad request' }));

// ---------- public ----------
app.get('/healthz', (req, res) => res.json({ ok: true, demo }));
app.get('/api/config', (req, res) => res.json({ demo, showroom: SHOWROOM, needsSetup: accounts.needsSetup(), persistent: accounts.persistent }));

app.post('/api/auth/setup', sameOrigin, (req, res, next) => {
  try {
    accounts.setup(req.body || {});
    const user = accounts.login(req.body.username, req.body.password, req.ip);
    setSession(res, user);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/auth/login', sameOrigin, (req, res, next) => {
  try {
    const user = accounts.login(req.body?.username, req.body?.password, req.ip);
    setSession(res, user);
    res.json({ ok: true, mustChange: !!user.mustChange });
  } catch (e) { next(e); }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 're_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.post('/api/auth/password', sameOrigin, auth(), (req, res, next) => {
  try {
    const u = accounts.changeOwnPassword(req.user.id, req.body?.current, req.body?.next);
    setSession(res, u);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- signed in ----------
app.get('/api/me', auth(), (req, res) => res.json({ user: req.user, demo }));

app.get('/api/bootstrap', auth(), wrap(async (req, res) => {
  const [{ lists }, engines] = await Promise.all([data.masters(), data.engines()]);
  res.json({ user: req.user, schema: SHEETS, modules: MODULES, levels: LEVELS, lists, engines, demo, showroom: SHOWROOM, persistent: accounts.persistent });
}));

app.get('/api/dashboard', auth(can('dashboard', 'view')), wrap(async (req, res) => {
  const d = await data.dashboard();
  // money in the bank, transfers and expenses only for roles that can see the Bank Ledger
  if (rank(req.user.perms.ledger) < rank('view')) {
    const hide = new Set(['BANK DEPOSIT', 'BANK TRANSFER', 'OPENING BALANCE', 'CLOSING BALANCE', 'CASH + BANK BALANCE', 'EXPENSES PAID · MONTH']);
    d.today = d.today.filter((t) => !hide.has(t.label));
    d.month = d.month.filter((t) => !hide.has(t.label));
    d.bank = []; d.bankTotal = null; d.expenses = []; d.restricted = true;
  }
  res.json(d);
}));
app.get('/api/ledger', auth(can('ledger', 'view')), wrap(async (req, res) => res.json(await data.ledger())));

app.get('/api/sheets/:key', auth(can(sheetKey, 'view')), wrap(async (req, res) => {
  const [rows, reqs] = await Promise.all([data.rows(req.params.key), data.requests()]);
  const name = SHEETS[req.params.key]?.name;
  const now = Date.now() / 86400000 + 25569 + 330 / 1440;
  const mine = reqs.filter((r) => r.sheet === name && (req.user.approve || r.by === req.user.email));
  res.json({
    rows,
    pending: mine.filter((r) => r.status === 'Pending').map((r) => r.row),
    approved: mine.filter((r) => r.status === 'Approved' && r.until > now && r.by === req.user.email).map((r) => ({ row: r.row, minutes: Math.max(1, Math.round((r.until - now) * 1440)) })),
  });
}));

app.post('/api/sheets/:key', sameOrigin, auth(can(sheetKey, 'add')), wrap(async (req, res) => {
  res.json(await data.create(req.user, req.params.key, req.body || {}));
}));
app.put('/api/sheets/:key/:row', sameOrigin, auth(can(sheetKey, 'add')), wrap(async (req, res) => {
  res.json(await data.update(req.user, req.params.key, Number(req.params.row), req.body || {}));
}));
app.post('/api/sheets/:key/:row/request', sameOrigin, auth(can(sheetKey, 'add')), wrap(async (req, res) => {
  res.json(await data.requestEdit(req.user, req.params.key, Number(req.params.row), req.body?.reason));
}));

app.get('/api/requests', auth(), wrap(async (req, res) => {
  const all = await data.requests();
  res.json({ requests: (req.user.approve ? all : all.filter((r) => r.by === req.user.email)).reverse() });
}));
app.post('/api/requests/:id', sameOrigin, auth((u) => u.approve), wrap(async (req, res) => {
  res.json(await data.decide(req.user, Number(req.params.id), req.body?.status));
}));

// ---------- Excel / PDF export of what the page shows ----------
app.post('/api/export', sameOrigin, auth(), wrap(async (req, res) => {
  const fmt = req.body?.format === 'pdf' ? 'pdf' : 'xlsx';
  const when = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ');
  const meta = { showroom: SHOWROOM, user: req.user.name, when };
  const buf = fmt === 'pdf' ? await toPdf(req.body, meta) : await toExcel(req.body, meta);
  const base = String(req.body?.title || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
  res.set({
    'Content-Type': fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${base}-${when.slice(0, 10)}.${fmt}"`,
  });
  res.send(Buffer.from(buf));
}));

// ---------- users & roles ----------
const admin = auth((u) => u.manageUsers);
const json = (fn) => (req, res, next) => { try { res.json(fn(req) ?? { ok: true }); } catch (e) { next(e); } };
app.get('/api/access', admin, json(() => ({ users: accounts.listUsers(), roles: accounts.listRoles(), modules: MODULES, levels: LEVELS })));
app.post('/api/access/users', sameOrigin, admin, json((req) => accounts.createUser(req.body || {}, req.user.username)));
app.put('/api/access/users/:id', sameOrigin, admin, json((req) => accounts.updateUser(req.params.id, req.body || {}, req.user)));
app.post('/api/access/roles', sameOrigin, admin, json((req) => accounts.saveRole(req.body || {})));
app.delete('/api/access/roles/:id', sameOrigin, admin, json((req) => { accounts.deleteRole(req.params.id); }));

// ---------- static UI ----------
const PUBLIC = { '/app.js': 'app.js', '/icons.js': 'icons.js', '/style.css': 'style.css', '/brand/logo.png': 'brand/logo.png', '/favicon.png': 'brand/favicon.png', '/apple-touch-icon.png': 'brand/apple-touch-icon.png' };   // only these files are served
// Each deploy gets its own version tag, so browsers never mix an old script with a new page.
const BUILD = (process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace(/(href|src)="\/(app\.js|icons\.js|style\.css)"/g, (m, attr, f) => `${attr}="/${f}?v=${BUILD}"`);
app.get(Object.keys(PUBLIC), (req, res) => {
  const fresh = req.query.v === BUILD;   // versioned links can be cached; anything else is checked every time
  res.sendFile(path.join(__dirname, PUBLIC[req.path]), fresh ? { maxAge: '30d', immutable: true } : { maxAge: 0, headers: { 'Cache-Control': 'no-cache' } });
});
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(INDEX);
});

app.use((err, req, res, next) => {
  const upstream = !!(err.response || err.config);   // error from Google's API, not ours
  const status = upstream ? 502 : (err.status || 500);
  if (status >= 500) console.error(err);
  let msg = err.message || 'Something went wrong';
  if (/protected cell|protected range/i.test(msg)) msg = 'The Google Sheet blocked this write: add the app\'s service account as an editor of the sheet protections (see README).';
  else if (status >= 500 && /PERMISSION_DENIED|caller does not have permission/i.test(msg)) msg = 'The app cannot open the Google Sheet. Share the sheet with the service account email as Editor.';
  else if (status >= 500) msg = 'Server error. Please try again.';
  res.status(status).json({ error: msg });
});

app.listen(PORT, () => {
  console.log(`RE Showroom app on :${PORT}  ${demo ? '(DEMO MODE: sample data in memory)' : '(Google Sheet: ' + process.env.SHEET_ID + ', service account ' + store.email + ')'}`);
  console.log(`Accounts saved in ${accounts.file}${accounts.persistent ? '' : '  (WARNING: not on a volume, accounts are lost on redeploy)'}`);
  if (accounts.setupCode) console.log(`\n  FIRST-TIME SETUP CODE: ${accounts.setupCode}\n  Open the app and use this code to create the Admin account.\n`);
});
