// App accounts: users (username + password) and roles (what each role may do).
// Saved as JSON in DATA_DIR (a Railway volume mounted at /data), so it survives redeploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Sections of the app a role can be given access to.
// level: none < view < add < edit   ("add" = new entries + fill empty fields + request edits,
//                                     "edit" = also change saved entries directly)
const MODULES = [
  { key: 'dashboard', label: 'Dashboard', levels: ['none', 'view'] },
  { key: 'stock', label: 'Vehicle Stock' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'sales', label: 'Vehicle Sales' },
  { key: 'service', label: 'Service' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'bank', label: 'Bank Entries' },
  { key: 'ledger', label: 'Bank Ledger', levels: ['none', 'view'] },
  { key: 'masters', label: 'Masters', levels: ['none', 'view', 'edit'] },
];
const LEVELS = ['none', 'view', 'add', 'edit'];
const rank = (l) => Math.max(0, LEVELS.indexOf(l));

// highest level each section allows, up to lvl (Dashboard and Bank Ledger only go to view)
const ALL = (lvl) => Object.fromEntries(MODULES.map((m) => [m.key, m.levels ? [...m.levels].reverse().find((l) => rank(l) <= rank(lvl)) : lvl]));
const DEFAULT_ROLES = [
  { id: 'admin', name: 'Admin', system: true, perms: ALL('edit'), approve: true, manageUsers: true },
  { id: 'manager', name: 'Manager', perms: ALL('add'), approve: false, manageUsers: false },
  { id: 'sales', name: 'Sales Executive', perms: { ...ALL('none'), dashboard: 'view', stock: 'view', bookings: 'add', sales: 'add' }, approve: false, manageUsers: false },
  { id: 'service', name: 'Service Advisor', perms: { ...ALL('none'), dashboard: 'view', service: 'add' }, approve: false, manageUsers: false },
  { id: 'accounts', name: 'Accountant', perms: { ...ALL('view'), expenses: 'add', bank: 'add' }, approve: false, manageUsers: false },
  { id: 'viewer', name: 'Viewer', perms: ALL('view'), approve: false, manageUsers: false },
];

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
const DUMMY = hashPassword('not-a-real-password');
function checkPassword(password, user) {
  if (!user?.hash || !user?.salt) return false;
  const a = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cleanUsername = (u) => String(u || '').trim().toLowerCase();

class Accounts {
  constructor() {
    this.dir = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
    this.file = path.join(this.dir, 'accounts.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { users: [], roles: [] };
    if (!this.db.roles.length) this.db.roles = JSON.parse(JSON.stringify(DEFAULT_ROLES));
    this.setupCode = null;
    if (!this.db.users.length) {
      this.setupCode = crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-');
    }
    this.fails = new Map();
  }
  get persistent() { return this.dir === '/data' || !!process.env.DATA_DIR; }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }
  needsSetup() { return this.db.users.length === 0; }

  // ---------- signed-out sessions ----------
  revoke(sid, exp) {
    if (!sid) return;
    const now = Date.now();
    this.db.revoked = Object.fromEntries(Object.entries(this.db.revoked || {}).filter(([, e]) => e > now));
    this.db.revoked[sid] = exp;
    this.save();
  }
  isRevoked(sid) { return !!(sid && this.db.revoked && this.db.revoked[sid]); }
  signOutEverywhere(id) {
    const u = this.db.users.find((x) => x.id === id);
    if (!u) return;
    u.ver = (u.ver || 0) + 1;
    this.save();
  }

  // ---------- first admin ----------
  setup({ code, name, username, password }, ip = '') {
    if (!this.needsSetup()) throw httpError(400, 'Setup is already done. Please sign in.');
    const key = 'setup|' + ip, f = this.fails.get(key);
    if (f && f.count >= 10 && Date.now() < f.until) throw httpError(429, 'Too many wrong setup codes. Try again in 10 minutes.');
    if (String(code || '').trim().toUpperCase() !== this.setupCode) {
      this.fails.set(key, { count: (f && Date.now() < f.until ? f.count : 0) + 1, until: Date.now() + 10 * 60000 });
      throw httpError(403, 'Setup code is wrong. Copy it from the Railway deploy logs.');
    }
    const u = this.createUser({ name, username, password, roleId: 'admin', active: true }, 'setup');
    this.setupCode = null;
    return u;
  }

  // ---------- sign in ----------
  login(username, password, ip) {
    username = cleanUsername(username);
    const key = ip + '|' + username;
    const f = this.fails.get(key);
    if (f && f.count >= 5 && Date.now() < f.until) {
      throw httpError(429, `Too many wrong passwords. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} minutes.`);
    }
    const user = this.db.users.find((u) => u.username === username);
    // check a password even for unknown names, so the reply time doesn't reveal who has an account
    const ok = checkPassword(password, user || DUMMY);
    if (!user || !ok) {
      const n = (f && Date.now() < f.until ? f.count : 0) + 1;
      this.fails.set(key, { count: n, until: Date.now() + 10 * 60000 });
      throw httpError(401, 'Username or password is wrong.');
    }
    if (!user.active) throw httpError(403, 'This account is turned off. Ask the Admin.');
    this.fails.delete(key);
    user.lastLogin = new Date().toISOString();
    this.save();
    return user;
  }

  // the signed-in user with everything the app needs to check access
  session(id, ver) {
    const user = this.db.users.find((u) => u.id === id);
    if (!user || !user.active || (user.ver || 0) !== ver) return null;
    const role = this.db.roles.find((r) => r.id === user.roleId) || { name: '—', perms: ALL('none') };
    return {
      id: user.id, username: user.username, email: user.username, name: user.name,
      role: role.name, roleId: role.id, perms: role.system ? ALL('edit') : { ...ALL('none'), ...role.perms },
      approve: !!role.approve, manageUsers: !!role.manageUsers, mustChange: !!user.mustChange, isAdmin: !!role.system,
    };
  }

  // ---------- users ----------
  publicUser(u) {
    const role = this.db.roles.find((r) => r.id === u.roleId);
    return { id: u.id, username: u.username, name: u.name, roleId: u.roleId, role: role?.name || '—', active: u.active,
      createdAt: u.createdAt, createdBy: u.createdBy, lastLogin: u.lastLogin || null, mustChange: !!u.mustChange };
  }
  listUsers() { return this.db.users.map((u) => this.publicUser(u)); }

  validPassword(p) {
    if (String(p || '').length < 6) throw httpError(400, 'Password must be at least 6 characters');
  }

  createUser({ name, username, password, roleId, active = true }, by, me = null) {
    if (me) this.guardStaff(me, null, roleId);
    username = cleanUsername(username);
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw httpError(400, 'Username: 3 to 30 letters or numbers, no spaces');
    if (this.db.users.some((u) => u.username === username)) throw httpError(400, 'This username is already taken');
    if (!String(name || '').trim()) throw httpError(400, 'Enter the person\'s name');
    if (!this.db.roles.some((r) => r.id === roleId)) throw httpError(400, 'Pick a role');
    this.validPassword(password);
    const u = {
      id: crypto.randomUUID(), username, name: String(name).trim().slice(0, 60), roleId, active: active !== false,
      ...hashPassword(password), ver: 0, mustChange: by !== 'setup', createdAt: new Date().toISOString(), createdBy: by,
    };
    this.db.users.push(u);
    this.save();
    return this.publicUser(u);
  }

  updateUser(id, body, me) {
    const u = this.db.users.find((x) => x.id === id);
    if (!u) throw httpError(404, 'User not found');
    if (u.id !== me.id) this.guardStaff(me, u, body.roleId !== undefined && body.roleId !== u.roleId ? body.roleId : null);
    if (body.name !== undefined) {
      if (!String(body.name).trim()) throw httpError(400, 'Enter the person\'s name');
      u.name = String(body.name).trim().slice(0, 60);
    }
    if (body.roleId !== undefined && body.roleId !== u.roleId) {
      if (!this.db.roles.some((r) => r.id === body.roleId)) throw httpError(400, 'Pick a role');
      if (u.id === me.id) throw httpError(400, 'You cannot change your own role');
      if (u.roleId === 'admin' && this.adminCount() <= 1) throw httpError(400, 'Keep at least one active Admin');
      u.roleId = body.roleId;
    }
    if (body.active !== undefined && !!body.active !== u.active) {
      if (u.id === me.id) throw httpError(400, 'You cannot turn off your own account');
      if (!body.active && u.roleId === 'admin' && this.adminCount() <= 1) throw httpError(400, 'Keep at least one active Admin');
      u.active = !!body.active;
      u.ver = (u.ver || 0) + 1;          // signs them out everywhere
    }
    if (body.password) {
      this.validPassword(body.password);
      Object.assign(u, hashPassword(body.password));
      u.ver = (u.ver || 0) + 1;
      u.mustChange = u.id !== me.id;     // a reset by the Admin must be changed at next sign-in
    }
    this.save();
    return this.publicUser(u);
  }

  changeOwnPassword(id, current, next) {
    const u = this.db.users.find((x) => x.id === id);
    if (!u || !checkPassword(current, u)) throw httpError(400, 'Current password is wrong');
    this.validPassword(next);
    if (current === next) throw httpError(400, 'Choose a new password, different from the current one');
    Object.assign(u, hashPassword(next));
    u.ver = (u.ver || 0) + 1;
    u.mustChange = false;
    this.save();
    return u;
  }

  // ---------- who may manage whom ----------
  // Only an Admin can touch Admin users, roles with "Manage users", or roles at all.
  // Someone else with "Manage users" can add, turn off and reset ordinary staff only.
  isAdmin(id) { const u = this.db.users.find((x) => x.id === id); return !!u && this.db.roles.find((r) => r.id === u.roleId)?.system === true; }
  privilegedRole(roleId) { const r = this.db.roles.find((x) => x.id === roleId); return !!r && (r.system || r.manageUsers); }
  guardStaff(me, target, roleId) {
    if (this.isAdmin(me.id)) return;
    if (target && this.privilegedRole(target.roleId)) throw httpError(403, 'Only an Admin can change Admins or people who manage users.');
    if (roleId && this.privilegedRole(roleId)) throw httpError(403, 'Only an Admin can give someone the Admin role or a role that manages users.');
  }
  guardRoles(me) {
    if (!this.isAdmin(me.id)) throw httpError(403, 'Only an Admin can create or change roles.');
  }

  adminCount() { return this.db.users.filter((u) => u.roleId === 'admin' && u.active).length; }

  // ---------- roles ----------
  listRoles() {
    return this.db.roles.map((r) => ({ ...r, users: this.db.users.filter((u) => u.roleId === r.id).length }));
  }
  saveRole(body, me) {
    this.guardRoles(me);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw httpError(400, 'Enter a role name');
    let role = body.id ? this.db.roles.find((r) => r.id === body.id) : null;
    if (body.id && !role) throw httpError(404, 'Role not found');
    if (role?.system) throw httpError(400, 'The Admin role always has full access and cannot be changed');
    if (this.db.roles.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== role?.id)) throw httpError(400, 'A role with this name already exists');
    const perms = {};
    for (const m of MODULES) {
      const allowed = m.levels || LEVELS;
      const v = body.perms?.[m.key];
      perms[m.key] = allowed.includes(v) ? v : 'none';
    }
    if (!role) {
      role = { id: 'r' + crypto.randomBytes(4).toString('hex') };
      this.db.roles.push(role);
    }
    Object.assign(role, { name, perms, approve: !!body.approve, manageUsers: !!body.manageUsers });
    this.save();
    return role;
  }
  deleteRole(id, me) {
    this.guardRoles(me);
    const role = this.db.roles.find((r) => r.id === id);
    if (!role) throw httpError(404, 'Role not found');
    if (role.system) throw httpError(400, 'The Admin role cannot be deleted');
    const n = this.db.users.filter((u) => u.roleId === id).length;
    if (n) throw httpError(400, `${n} user${n > 1 ? 's have' : ' has'} this role. Give them another role first.`);
    this.db.roles = this.db.roles.filter((r) => r.id !== id);
    this.save();
  }
}

module.exports = { Accounts, MODULES, LEVELS, rank };
