// RE Showroom web app: Google sign-in + roles from the Users tab, data in the Google Sheet.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { makeStore } = require('./store');
const { DataService } = require('./data');
const { SHEETS, ROLES } = require('./schema');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SHOWROOM = process.env.SHOWROOM_NAME || 'Royal Enfield Showroom';
const SESSION_HOURS = 12;

const { store, demo } = makeStore();
const data = new DataService(store);
const oauth = new OAuth2Client(CLIENT_ID);
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// ---------- session cookie (signed, httpOnly) ----------
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function setSession(res, email) {
  const body = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  res.setHeader('Set-Cookie', `re_sess=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function readSession(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)re_sess=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// every request re-checks the Users tab, so removing someone takes effect at once
const auth = (...roles) => wrap(async (req, res, next) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'Please sign in' });
  const user = await data.userFor(s.email);
  if (!user) return res.status(403).json({ error: 'Your account is not active. Ask the Admin.' });
  if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'You do not have permission for this' });
  req.user = user;
  next();
});
// state-changing calls must come from our own page (blocks cross-site form posts)
const sameOrigin = (req, res, next) => {
  if (req.get('X-RE-App') !== '1') return res.status(400).json({ error: 'Bad request' });
  next();
};
const writers = ['Admin', 'Manager', 'Staff'];

// ---------- public ----------
app.get('/healthz', (req, res) => res.json({ ok: true, demo }));
app.get('/api/config', (req, res) => res.json({ clientId: CLIENT_ID, demo, showroom: SHOWROOM }));

app.post('/api/auth/google', sameOrigin, wrap(async (req, res) => {
  const ticket = await oauth.verifyIdToken({ idToken: String(req.body.credential || ''), audience: CLIENT_ID })
    .catch(() => null);
  const p = ticket && ticket.getPayload();
  if (!p || !p.email_verified) return res.status(401).json({ error: 'Google sign-in failed. Try again.' });
  const user = await data.userFor(p.email);
  if (!user) return res.status(403).json({ error: `${p.email} is not in the Users list. Ask the Admin to add you.` });
  setSession(res, user.email);
  res.json({ user: { ...user, picture: p.picture } });
}));

// demo mode only: pick a role without Google
app.post('/api/auth/demo', sameOrigin, wrap(async (req, res) => {
  if (!demo) return res.status(404).json({ error: 'Not available' });
  const role = ROLES.includes(req.body.role) ? req.body.role : 'Staff';
  const email = `${role.toLowerCase()}@demo.local`;
  if (role !== 'Admin' && !(await data.userFor(email))) await data.saveUser({ email, name: `Demo ${role}`, role });
  setSession(res, email);
  res.json({ user: await data.userFor(email) });
}));

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 're_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// ---------- signed in ----------
app.get('/api/me', auth(), (req, res) => res.json({ user: req.user, demo }));

app.get('/api/bootstrap', auth(), wrap(async (req, res) => {
  const [{ lists }, engines] = await Promise.all([data.masters(), data.engines()]);
  res.json({ user: req.user, schema: SHEETS, lists, engines, demo, showroom: SHOWROOM });
}));

app.get('/api/dashboard', auth(), wrap(async (req, res) => res.json(await data.dashboard())));
app.get('/api/ledger', auth(), wrap(async (req, res) => res.json(await data.ledger())));

app.get('/api/sheets/:key', auth(), wrap(async (req, res) => {
  const [rows, reqs] = await Promise.all([data.rows(req.params.key), data.requests()]);
  const name = SHEETS[req.params.key]?.name;
  const now = Date.now() / 86400000 + 25569 + 330 / 1440;
  const mine = reqs.filter((r) => r.sheet === name && (req.user.role === 'Admin' || r.by === req.user.email));
  res.json({
    rows,
    pending: mine.filter((r) => r.status === 'Pending').map((r) => r.row),
    approved: mine.filter((r) => r.status === 'Approved' && r.until > now && r.by === req.user.email).map((r) => ({ row: r.row, minutes: Math.max(1, Math.round((r.until - now) * 1440)) })),
  });
}));

app.post('/api/sheets/:key', sameOrigin, auth(...writers), wrap(async (req, res) => {
  res.json(await data.create(req.user, req.params.key, req.body || {}));
}));

app.put('/api/sheets/:key/:row', sameOrigin, auth(...writers), wrap(async (req, res) => {
  res.json(await data.update(req.user, req.params.key, Number(req.params.row), req.body || {}));
}));

app.post('/api/sheets/:key/:row/request', sameOrigin, auth(...writers), wrap(async (req, res) => {
  res.json(await data.requestEdit(req.user, req.params.key, Number(req.params.row), req.body?.reason));
}));

app.get('/api/requests', auth(), wrap(async (req, res) => {
  const all = await data.requests();
  const list = req.user.role === 'Admin' ? all : all.filter((r) => r.by === req.user.email);
  res.json({ requests: list.reverse() });
}));

app.post('/api/requests/:id', sameOrigin, auth('Admin'), wrap(async (req, res) => {
  res.json(await data.decide(req.user, Number(req.params.id), req.body?.status));
}));

app.get('/api/users', auth('Admin'), wrap(async (req, res) => res.json({ users: await data.users() })));
app.post('/api/users', sameOrigin, auth('Admin'), wrap(async (req, res) => res.json(await data.saveUser(req.body || {}))));

// ---------- static UI ----------
const PUBLIC = { '/app.js': 'app.js', '/style.css': 'style.css' };   // only these files are served
app.get(Object.keys(PUBLIC), (req, res) => res.sendFile(path.join(__dirname, PUBLIC[req.path]), { maxAge: '1h' }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'index.html'));
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
  if (!demo && !CLIENT_ID) console.warn('GOOGLE_CLIENT_ID is not set: nobody can sign in.');
  if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set: sessions reset on every restart.');
});
