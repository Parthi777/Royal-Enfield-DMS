/* RE Showroom web app: single-page UI, no build step. */
(() => {
  'use strict';
  const $app = document.getElementById('app');
  const S = { user: null, schema: {}, lists: {}, engines: [], sold: [], demo: false, showroom: '', pendingCount: 0, data: {}, filter: {}, q: {} };

  // ---------- helpers ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
  const inr = (v, dash = true) => (v === '' || v === null || v === undefined) ? '' : (num(v) === 0 && dash ? '–' : (num(v) < 0 ? '-₹' : '₹') + Math.abs(Math.round(num(v))).toLocaleString('en-IN'));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fdate = (s) => { if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s ?? ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
  const fmonth = (s) => { if (!s) return ''; const [y, m] = s.split('-'); return `${MON[+m - 1]} ${y}`; };
  // today's date in India (UTC + 5:30), whatever time zone the device is set to
  const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const RANK = { none: 0, view: 1, add: 2, edit: 3 };
  // a sheet's access comes from its own section, or the one it belongs to (Sale Payments -> Vehicle Sales)
  const permOf = (k) => S.schema?.[k]?.perm || k;
  const canDo = (k, l) => RANK[S.user?.perms?.[permOf(k)] || 'none'] >= RANK[l];
  const initials = (n) => String(n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

  // Lucide icons (icons.js); old names kept as aliases
  const ALIAS = { bike: 'stock', calendar: 'bookings', receipt: 'sales', wrench: 'service', wallet: 'expenses', book: 'ledger', shield: 'approvals' };
  const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(window.LUCIDE || {})[ALIAS[n] || n] || ''}</svg>`;

  function toast(msg, err = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3000);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-RE-App': '1' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let out = {};
    try { out = await res.json(); } catch { /* empty */ }
    if (!res.ok) { const e = new Error(out.error || 'Request failed'); e.status = res.status; e.mustChange = !!out.mustChange; throw e; }
    return out;
  }

  // pill colour from status text
  function pillText(s) {
    // sheet statuses come as CAPS or Title Case: show them in sentence case
    let t = s.toLowerCase().replace(/\s+-\s+/, ' ');
    t = t.replace(/\bdd\b/g, 'DD').replace(/\bhp\b/g, 'HP').replace(/^ok$/, 'OK');
    return t.replace(/[a-z]/, (ch) => ch.toUpperCase());
  }
  const indianAmounts = (s) => s.replace(/₹([\d,]+)/g, (_, n) => inr(Number(n.replace(/,/g, '')), false));
  function pill(v) {
    const s = String(v || '');
    if (!s) return '';
    const u = s.toUpperCase();
    let c = 'grey';
    if (u.startsWith('⚠')) c = 'red';
    else if (u === 'OK') c = 'green';
    else if (/OVERDUE|OWES|REJECTED|NO STOCK/.test(u)) c = 'red';
    else if (/OVERPAID/.test(u)) c = 'amber';
    else if (/DD PENDING|DUE SOON|NOT ALLOTTED|PENDING|SET COMMITMENT/.test(u)) c = 'amber';
    else if (/^AVAILABLE|ON TRACK|FULLY PAID|APPROVED|IN STOCK/.test(u)) c = 'green';
    else if (/ALLOTTED/.test(u)) c = 'teal';
    else if (/SOLD|DELIVERED/.test(u)) c = 'grey';
    return `<span class="pill ${c}">${esc(indianAmounts(pillText(s)))}</span>`;
  }

  function cellHtml(col, v) {
    if (v === '' || v === null || v === undefined) return '';
    if (col.type === 'date') return esc(fdate(v));
    if (col.type === 'money' || col.money) return esc(inr(v));
    if (col.status || col.check) return pill(v);
    return esc(v);
  }
  const colOf = (key, c) => S.schema[key].cols.find((x) => x.c === c);

  // ---------- sign in / first setup / new password ----------
  function authCard(inner) {
    $app.innerHTML = `<div class="login"><header class="login-side"><div class="login-logo"><img src="/brand/logo.png" alt="${esc(S.showroom || 'Pradhanaa Motors LLP')} logo"></div>
      <div><div class="login-brand">${esc(S.showroom || 'Pradhanaa Motors LLP')}</div>
      <div class="login-sub">Royal Enfield dealer</div>
      <p>The showroom's daily register: vehicles in stock, bookings, deliveries, customer payments, service bills, and the day's cash and bank.</p></div></header>
      <main class="login-main"><div class="login-card">${inner}</div></main></div>`;
    linkLabels($app);
  }
  const pwField = (name, label, auto) => `<div class="field"><label for="${name}">${label}</label><div class="pw"><input id="${name}" name="${name}" type="password" autocomplete="${auto}" required><button type="button" class="icon-btn pw-eye" aria-label="Show password">${ic('eye')}</button></div></div>`;
  function wirePw() {
    document.querySelectorAll('.pw-eye').forEach((b) => b.onclick = () => {
      const i = b.previousElementSibling; const show = i.type === 'password';
      i.type = show ? 'text' : 'password'; b.innerHTML = ic(show ? 'eyeOff' : 'eye');
    });
  }
  async function renderLogin(error) {
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
    S.showroom = cfg.showroom || S.showroom;
    if (cfg.needsSetup) return renderSetup(error);
    authCard(`
      <h1>Sign in</h1>
      <p class="muted">Staff only. Use the username and password your Admin set up for you.</p>
      <form id="lf" novalidate>
        <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
        ${pwField('password', 'Password', 'current-password')}
        ${error ? `<div class="form-err">${ic('alert')}<span>${esc(error)}</span></div>` : ''}
        <button class="btn primary block" type="submit">Sign in</button>
      </form>
      <div class="login-foot">Forgot your password? Your Admin can reset it from Users &amp; Roles.</div>`);
    wirePw();
    document.getElementById('username').focus();
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      if (!fd.username || !fd.password) return renderLogin('Enter your username and password.');
      try { await api('POST', '/api/auth/login', fd); boot(); } catch (err) { renderLogin(err.message); }
    };
  }
  function renderSetup(error) {
    authCard(`
      <h1>Set up the Admin account</h1>
      <p class="muted">This is done once. Enter the setup code from the Railway deploy logs, then choose the Admin's name, username and password. The Admin adds everyone else.</p>
      <form id="sf" novalidate>
        <div class="field"><label for="code">Setup code</label><input id="code" name="code" placeholder="XXXX-XXXX" autocomplete="off" required></div>
        <div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" required></div>
        <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
        ${pwField('password', 'Password (at least 6 characters)', 'new-password')}
        ${error ? `<div class="form-err">${ic('alert')}<span>${esc(error)}</span></div>` : ''}
        <button class="btn primary block" type="submit">Create Admin account</button>
      </form>`);
    wirePw();
    document.getElementById('sf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/auth/setup', Object.fromEntries(new FormData(e.target))); boot(); } catch (err) { renderSetup(err.message); }
    };
  }
  function renderNewPassword(error) {
    authCard(`
      <h1>Set your own password</h1>
      <p class="muted">The Admin created this password for you. Choose a new one that only you know.</p>
      <form id="pf" novalidate>
        ${pwField('current', 'Password from the Admin', 'current-password')}
        ${pwField('next', 'New password (at least 6 characters)', 'new-password')}
        ${error ? `<div class="form-err">${ic('alert')}<span>${esc(error)}</span></div>` : ''}
        <button class="btn primary block" type="submit">Save password</button>
      </form>
      <div class="login-foot"><a href="#" id="so">Sign out</a></div>`);
    wirePw();
    document.getElementById('so').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout'); renderLogin(); };
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/auth/password', Object.fromEntries(new FormData(e.target))); toast('Password saved'); boot(); }
      catch (err) { renderNewPassword(err.message); }
    };
  }
  function changePassword() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="scrim"></div><form class="box" id="cp" novalidate>
      <h3>Change password</h3><p>You stay signed in on this device. Other devices are signed out.</p>
      ${pwField('current', 'Current password', 'current-password')}
      <div style="height:12px"></div>${pwField('next', 'New password (at least 6 characters)', 'new-password')}
      <div class="acts"><button type="button" class="btn" id="c">Cancel</button><button class="btn primary" type="submit">Save password</button></div></form>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); m._release?.(); };
    asDialog(m, m.querySelector('.box'), close);
    wirePw();
    m.querySelector('#current').focus();
    m.querySelector('#c').onclick = () => close();
    m.querySelector('.scrim').onclick = () => close();
    m.querySelector('#cp').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/auth/password', Object.fromEntries(new FormData(e.target))); close(); toast('Password changed'); }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------- shell ----------
  const NAV = [
    ['', [['#/dashboard', 'Dashboard', 'dash', 'dashboard']]],
    ['Showroom', [['#/s/stock', 'Vehicle Stock', 'stock', 'stock'], ['#/s/bookings', 'Bookings', 'bookings', 'bookings'], ['#/s/sales', 'Vehicle Sales', 'sales', 'sales'], ['#/s/service', 'Service', 'service', 'service']]],
    ['Accounts', [['#/s/expenses', 'Expenses', 'expenses', 'expenses'], ['#/s/bank', 'Bank Entries', 'bank', 'bank'], ['#/daybook', 'Day Book', 'daybook', 'ledger'], ['#/ledger', 'Bank Ledger', 'ledger', 'ledger']]],
    ['Control', [['#/approvals', 'Edit Requests', 'approvals', '@approvals'], ['#/masters', 'Masters', 'masters', 'masters'], ['#/access', 'Users & Roles', 'roles', '@users']]],
  ];
  const navAllowed = (k) => k === '@users' ? !!S.user.manageUsers
    : k === '@approvals' ? (S.user.approve || Object.values(S.user.perms || {}).some((v) => v === 'add'))
    : canDo(k, 'view');
  const firstPage = () => { for (const [, items] of NAV) for (const i of items) if (navAllowed(i[3])) return i[0]; return null; };

  function shell(title, sub, actions, body) {
    const route = location.hash || '#/dashboard';
    $app.innerHTML = `
      <div class="shell">
        <aside class="side" id="side">
          <div class="side-brand"><img src="/brand/logo-160.png" alt="" width="64" height="64"><div><b>${esc(S.showroom)}</b><span>Royal Enfield dealer</span></div></div>
          <nav class="nav">${NAV.map(([sec, items]) => { const ok = items.filter((i) => navAllowed(i[3])); return ok.length ? (sec ? `<div class="sec">${sec}</div>` : '') + ok.map(([href, label, icon]) =>
            `<a href="${href}" class="${route.startsWith(href) ? 'on' : ''}">${ic(icon)}<span>${label}</span>${href === '#/approvals' && S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : ''}</a>`).join('') : ''; }).join('')}</nav>
          ${S.demo ? '<div class="side-note">Demo data: entries are not saved to the Google Sheet.</div>' : ''}
        </aside>
        <main class="main">
          <header class="topbar">
            <button class="icon-btn menu-btn" id="menu" aria-label="Menu">${ic('menu')}</button>
            <div class="grow"></div>
            <div class="usermenu">
              <button class="user-btn" id="um" aria-haspopup="true"><span class="avatar">${esc(initials(S.user.name))}</span><span class="un"><b>${esc(S.user.name)}</b><small>${esc(S.user.role)}</small></span>${ic('chevron')}</button>
              <div class="menu" id="umenu" hidden>
                <div class="menu-h">Signed in as <b>${esc(S.user.username)}</b></div>
                <button id="cpw">${ic('key')}Change password</button>
                <button id="logout">${ic('out')}Sign out</button>
                <button id="logoutall">${ic('out')}Sign out of all devices</button>
              </div>
            </div>
          </header>
          <div class="page-h">
            <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
            <div class="grow"></div>${actions || ''}
          </div>
          <div class="content" id="content">${body}</div>
        </main>
      </div>`;
    const menu = document.getElementById('umenu');
    document.getElementById('um').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', () => (menu.hidden = true), { once: true });
    document.getElementById('cpw').onclick = () => { menu.hidden = true; changePassword(); };
    document.getElementById('logout').onclick = async () => { await api('POST', '/api/auth/logout'); S.user = null; renderLogin(); };
    document.getElementById('logoutall').onclick = async () => {
      if (!confirm('Sign out on every phone and computer where you are signed in?')) return;
      await api('POST', '/api/auth/logout-all'); S.user = null; await renderLogin(); toast('Signed out of all devices');
    };
    const side = document.getElementById('side');
    document.getElementById('menu').onclick = (e) => { e.stopPropagation(); side.classList.toggle('open'); };
    document.querySelector('.main').addEventListener('click', () => side.classList.remove('open'));
  }

  function loading(title) { shell(title, '', '', '<div class="boot" style="height:50vh"><div class="spinner"></div></div>'); }

  // ---------- dashboard ----------
  async function pageDashboard() {
    loading('Dashboard');
    const d = await api('GET', '/api/dashboard');
    const T = d.today, M = d.month;
    const rd = new Date(d.reportDate + 'T00:00:00');
    const longDate = rd.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const monthName = rd.toLocaleDateString('en-IN', { month: 'long' });
    const monthLong = rd.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const bar = (v, max, cls = '') => `<div class="bar ${cls}"><i style="width:${max > 0 ? Math.max(2, Math.min(100, (v / max) * 100)) : 0}%"></i></div>`;
    const stat = (label, value, sub = '', money = false) => {
      const z = num(value) === 0;
      return `<div class="st"><div class="l">${esc(label)}</div><div class="v ${z ? 'zero' : ''}">${money ? (z ? '₹0' : inr(value)) : num(value)}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
    };
    const delta = (a, b) => { const x = b - a; return x === 0 ? 'no change' : `<span class="${x > 0 ? 'in' : 'out'}">${x > 0 ? '+' : '−'}${inr(Math.abs(x), false)}</span> ${x > 0 ? 'more' : 'less'}`; };
    const nBank = (T.accounts || []).filter((a) => !a.cash).length;

    // business cards and money cards for one period (today or this month)
    const business = (P, when) => `
      <div class="panel strip" style="--n:5">
        ${stat('Vehicles sold', P.sold, `HP ${P.hp} · Cash ${P.cashSales}`)}
        ${stat('Sales value', P.salesValue, 'on-road price', true)}
        ${stat('New bookings', P.bookings, P.advance ? `${inr(P.advance, false)} advance` : 'no advance')}
        ${stat('Service billed', P.serviceValue, `${P.service} ${P.service === 1 ? 'job' : 'jobs'}`, true)}
        ${stat('Collections', P.collections, 'received from customers', true)}
      </div>`;
    const money = (P, openLabel) => d.restricted ? '' : `
      <div class="panel strip money" style="--n:6">
        ${stat('Cash opening', P.cash.opening, openLabel, true)}
        ${stat('Cash closing', P.cash.closing, delta(P.cash.opening, P.cash.closing), true)}
        ${stat('Bank opening', P.bank.opening, `${nBank} bank ${nBank === 1 ? 'account' : 'accounts'}`, true)}
        ${stat('Bank closing', P.bank.closing, delta(P.bank.opening, P.bank.closing), true)}
        ${stat('Bank deposit', P.deposit, P.depositCount ? `${P.depositCount} cash ${P.depositCount === 1 ? 'deposit' : 'deposits'}` : 'no deposits', true)}
        ${stat('Expenses', P.expenses, P.expenseCount ? `${P.expenseCount} ${P.expenseCount === 1 ? 'payment' : 'payments'} out` : 'none', true)}
      </div>`;

    // stock comes from the live engine list (Available + Allotted = in the showroom)
    const inStock = S.engines.filter((e) => e.status === 'Available' || e.status === 'Allotted');
    const allotted = inStock.filter((e) => e.status === 'Allotted');
    const stockValue = inStock.reduce((s, e) => s + num(e.value), 0);
    const owes = d.balances.filter((b) => b.owes > 0), dds = d.balances.filter((b) => b.dd > 0);
    const maxSold = Math.max(0, ...d.months.map((m) => m.sold));
    const models = d.models.filter((m) => m.available + m.allotted + m.waiting > 0);
    const maxModel = Math.max(0, ...models.map((m) => Math.max(m.available + m.allotted, m.waiting)));
    const maxExp = Math.max(0, ...d.expenses.map((e) => e.paid));
    const old = d.ageing.slice(2).reduce((s, a) => s + a.vehicles, 0);
    const maxDay = Math.max(0, ...d.days.map((x) => Math.max(x.in, x.out)));
    const accts = T.accounts || [];

    shell('Dashboard', esc(longDate), `<button class="btn" id="refresh">${ic('refresh')}<span class="new-label">Refresh</span></button>` + exportBtn(), `
      <div class="section-h"><h2>Today</h2><span>${esc(fdate(d.reportDate))}</span></div>
      ${business(T)}
      ${money(T, 'start of today')}

      <div class="section-h"><h2>${esc(monthLong)}</h2><span>1 ${esc(monthName)} to today</span></div>
      ${business(M)}
      ${money(M, `on 1 ${monthName}`)}

      ${d.restricted ? '' : `<div class="panel" style="margin-top:16px"><div class="panel-h"><h2>Cash and bank accounts</h2><small>today</small><div class="grow"></div><a href="#/daybook">Open day book</a></div>
        <div class="tbl-wrap"><table><thead><tr><th>Account</th><th class="num">Opening</th><th class="num">Received</th><th class="num">Paid</th><th class="num">Closing</th></tr></thead><tbody>
          ${accts.map((a) => `<tr><td class="strong">${esc(a.account)}</td><td class="num">${inr(a.opening)}</td><td class="num ${a.received ? 'in' : 'muted'}">${inr(a.received)}</td><td class="num ${a.paid ? 'out' : 'muted'}">${inr(a.paid)}</td><td class="num strong">${inr(a.closing, false)}</td></tr>`).join('')}
          <tr class="total"><td>Total</td><td class="num">${inr(T.cash.opening + T.bank.opening, false)}</td><td class="num">${inr(T.cash.received + T.bank.received)}</td><td class="num">${inr(T.cash.paid + T.bank.paid)}</td><td class="num">${inr(T.cash.closing + T.bank.closing, false)}</td></tr>
        </tbody></table></div>${d.unposted ? `<div class="notice warn" style="margin:12px 16px">${ic('alert')}<div>${inr(d.unposted, false)} was received without choosing an account, so it isn't in any balance.</div></div>` : ''}</div>`}

      <div class="section-h"><h2>Charts</h2></div>
      <div class="cols" style="margin-top:0">
        <div class="stack">
          ${d.restricted ? '' : `<div class="panel"><div class="panel-h"><h2>Money in and out</h2><small>${esc(monthName)}, by day</small></div><div class="panel-b">
            <div class="daychart" role="img" aria-label="Money in and out each day this month">${d.days.map((x) => `<div class="dc" title="${esc(fdate(x.date))}: in ${inr(x.in, false)}, out ${inr(x.out, false)}">
              <div class="bars"><i class="i" style="height:${maxDay ? (x.in / maxDay) * 100 : 0}%"></i><i class="o" style="height:${maxDay ? (x.out / maxDay) * 100 : 0}%"></i></div>
              <span>${+x.date.slice(8) % 5 === 0 || +x.date.slice(8) === 1 ? +x.date.slice(8) : ''}</span></div>`).join('')}</div>
            <div class="legend"><span><i class="i"></i>Money in ${inr(M.cash.received + M.bank.received, false)}</span><span><i class="o"></i>Money out ${inr(M.cash.paid + M.bank.paid, false)}</span><span class="muted">Deposits and transfers between your own accounts count on both sides.</span></div>
          </div></div>`}

          <div class="panel"><div class="panel-h"><h2>Follow up</h2><div class="grow"></div><small>${d.overdue.length + owes.length + dds.length || 'nothing'} pending</small></div><div class="panel-b">
            <div class="group-l">Overdue bookings: call the customer</div>
            ${d.overdue.length ? `<ul class="rows">${d.overdue.map((o) => `<li><div class="who"><b>${esc(o.customer)}</b><small>${esc(o.model)} · ${esc(o.mobile)}</small></div><div class="amt"><span class="pill red">${o.late} ${o.late === 1 ? 'day' : 'days'} late</span><small>promised ${fdate(o.commitment)}</small></div></li>`).join('')}</ul>` : '<div class="empty-line">No overdue bookings.</div>'}
            <div class="group-l">Customer balance due · ${inr(d.customerDue, false)}</div>
            ${owes.length ? `<ul class="rows">${owes.map((b) => `<li><div class="who"><b>${esc(b.customer)}</b><small>${esc(b.model)} · ${esc(b.mobile)}</small></div><div class="amt"><b class="out">${inr(b.owes, false)}</b><small>sold ${fdate(b.date)}</small></div></li>`).join('')}</ul>` : '<div class="empty-line">Every customer has paid in full.</div>'}
            <div class="group-l">Finance DD pending · ${inr(d.ddPending, false)}</div>
            ${dds.length ? `<ul class="rows">${dds.map((b) => `<li><div class="who"><b>${esc(b.customer)}</b><small>${esc(b.model)} · ${esc(b.mobile)}</small></div><div class="amt"><b class="nowrap" style="color:var(--amber-d)">${inr(b.dd, false)}</b><small>sold ${fdate(b.date)}</small></div></li>`).join('')}</ul>` : '<div class="empty-line">No DD pending.</div>'}
          </div></div>

          <div class="panel"><div class="panel-h"><h2>Vehicles sold</h2><small>last 6 months</small></div><div class="panel-b">
            <ul class="rows">${d.months.map((m) => `<li><div style="width:72px" class="${m.sold ? '' : 'muted'}">${fmonth(m.month)}</div><div class="barline">${m.sold ? bar(m.sold, maxSold) : ''}</div><div class="amt" style="width:64px">${m.sold ? `<b>${m.sold}</b>` : '<span class="muted">–</span>'}</div><div class="amt muted" style="width:104px">${m.collections ? inr(m.collections, false) : ''}</div></li>`).join('')}</ul>
            <div class="muted" style="font-size:12.5px;margin-top:6px">Right column: money collected from customers that month.</div>
          </div></div>
        </div>

        <div class="stack">
          <div class="panel"><div class="panel-h"><h2>Stock in showroom</h2><div class="grow"></div><a href="#/s/stock">Open stock</a></div>
            <div class="strip s3" style="--n:3;border-bottom:1px solid var(--line-2)">
              ${stat('Vehicles', inStock.length, `${allotted.length} allotted to bookings`)}
              ${canDo('stock', 'view') ? stat('Stock value', stockValue, 'purchase value', true) : stat('Open bookings', d.openBookings, `${d.allottedOpen} allotted`)}
              ${stat('Over 60 days', old, old ? '<span class="warn">sell these first</span>' : 'none ageing')}
            </div>
            <div class="panel-b" style="padding-top:8px">
            ${models.length ? `<ul class="rows">${models.map((m) => `<li><div class="who"><b>${esc(m.model)}</b><small>${m.available + m.allotted} in stock${m.allotted ? `, ${m.allotted} allotted` : ''}${m.waiting ? ` · <span style="color:${m.waiting > m.available ? 'var(--red-d)' : 'var(--amber-d)'}">${m.waiting} waiting</span>` : ''}</small></div>
              <div class="barline" style="display:grid;gap:4px">${bar(m.available + m.allotted, maxModel)}${m.waiting ? bar(m.waiting, maxModel, m.waiting > m.available ? 'red' : 'amber') : ''}</div></li>`).join('')}</ul>
              <div class="muted" style="font-size:12.5px;margin-top:8px">Green is stock, amber is customers waiting for a vehicle. Red means order more.</div>` : '<div class="empty-line">No vehicles in stock and nobody waiting.</div>'}
          </div></div>

          ${d.restricted ? '' : `<div class="panel"><div class="panel-h"><h2>Expenses</h2><small>${esc(monthName)}</small></div><div class="panel-b">
            ${d.expenses.length ? `<ul class="rows">${d.expenses.map((e) => `<li><div class="who"><b>${esc(e.category)}</b></div><div class="barline">${bar(e.paid, maxExp, 'navy')}</div><div class="amt" style="width:90px">${inr(e.paid, false)}</div></li>`).join('')}</ul>` : '<div class="empty-line">No expenses this month.</div>'}
          </div></div>`}

          <div class="panel"><div class="panel-h"><h2>Sales mix</h2><small>${esc(monthName)}</small></div><div class="panel-b">
            <ul class="rows">${d.mix.map((m) => `<li><div class="who"><b>${esc(m.mode === 'HP' ? 'Finance (HP)' : m.mode)}</b></div><div class="amt"><b>${m.count}</b> <span class="muted">${m.count === 1 ? 'vehicle' : 'vehicles'}</span></div></li>`).join('')}
            ${d.financiers.map((f) => `<li><div class="who"><small>${esc(f.name)}</small></div><div class="amt"><small style="display:inline">${f.count} · DD ${inr(f.dd, false)}</small></div></li>`).join('')}</ul>
          </div></div>
        </div>
      </div>`);
    document.getElementById('refresh').onclick = () => pageDashboard();
    const periodRows = (P) => [
      ['Vehicles sold', P.sold], ['HP / cash sales', `${P.hp} / ${P.cashSales}`], ['Sales value (on-road)', inr(P.salesValue, false)],
      ['New bookings', P.bookings], ['Booking advance', inr(P.advance, false)], ['Service billed', inr(P.serviceValue, false)],
      ['Collections from customers', inr(P.collections, false)],
      ...(d.restricted ? [] : [['Cash opening', inr(P.cash.opening, false)], ['Cash closing', inr(P.cash.closing, false)], ['Bank opening', inr(P.bank.opening, false)],
        ['Bank closing', inr(P.bank.closing, false)], ['Bank deposit', inr(P.deposit, false)], ['Expenses', inr(P.expenses, false)]]),
    ].map(([a, b]) => [a, String(b)]);
    wireExport(() => ({
      title: 'Daily Report', subtitle: longDate,
      sections: [
        { heading: 'Today', columns: [{ label: 'Item' }, { label: 'Value' }], rows: periodRows(T) },
        { heading: `${monthLong} to date`, columns: [{ label: 'Item' }, { label: 'Value' }], rows: periodRows(M) },
        d.restricted ? null : { heading: 'Cash and bank accounts (today)', columns: [{ label: 'Account' }, { label: 'Opening', type: 'money' }, { label: 'Received', type: 'money' }, { label: 'Paid', type: 'money' }, { label: 'Closing', type: 'money' }],
          rows: accts.map((a) => [a.account, a.opening, a.received, a.paid, a.closing]), totals: ['Total', T.cash.opening + T.bank.opening, T.cash.received + T.bank.received, T.cash.paid + T.bank.paid, T.cash.closing + T.bank.closing] },
        { heading: 'Overdue bookings', columns: [{ label: 'Customer' }, { label: 'Mobile' }, { label: 'Model' }, { label: 'Promised', type: 'date' }, { label: 'Days late', type: 'num' }, { label: 'Advance', type: 'money' }],
          rows: d.overdue.map((o) => [o.customer, o.mobile, o.model, o.commitment, o.late, o.advance]) },
        { heading: 'Customer balance and DD pending', columns: [{ label: 'Customer' }, { label: 'Mobile' }, { label: 'Model' }, { label: 'Sold on', type: 'date' }, { label: 'Customer owes', type: 'money' }, { label: 'DD pending', type: 'money' }],
          rows: d.balances.map((b) => [b.customer, b.mobile, b.model, b.date, b.owes || '', b.dd || '']), totals: ['Total', '', '', '', d.customerDue, d.ddPending] },
        { heading: 'Stock by model', columns: [{ label: 'Model' }, { label: 'Available', type: 'num' }, { label: 'Allotted', type: 'num' }, { label: 'Sold this month', type: 'num' }, { label: 'Waiting customers', type: 'num' }],
          rows: d.models.filter((m) => m.available + m.allotted + m.sold + m.waiting > 0).map((m) => [m.model, m.available, m.allotted, m.sold, m.waiting]) },
        d.restricted ? null : { heading: `Expenses in ${monthName}`, columns: [{ label: 'Category' }, { label: 'Paid', type: 'money' }], rows: d.expenses.map((e) => [e.category, e.paid]), totals: ['Total', d.expenses.reduce((x, e) => x + e.paid, 0)] },
      ].filter(Boolean),
    }));
  }

  // ---------- day book: every entry of one day, cash and bank, opening and closing ----------
  async function pageDaybook() {
    S.dbDate = S.dbDate || todayIso();
    loading('Day Book');
    const d = await api('GET', `/api/daybook?date=${S.dbDate}`);
    const shift = (n) => { const x = new Date(S.dbDate + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const isToday = S.dbDate === todayIso();
    const longDate = new Date(S.dbDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const KIND = { receipt: ['green', 'Receipt'], payment: ['red', 'Payment'], contra: ['grey', 'Transfer'] };
    const tin = d.entries.reduce((s, e) => s + e.in, 0), tout = d.entries.reduce((s, e) => s + e.out, 0);
    const card = (label, g, cls) => `<div class="db-card ${cls}"><div class="h">${label}</div>
      <dl><div><dt>Opening</dt><dd>${inr(g.opening, false)}</dd></div><div><dt>Received</dt><dd class="${g.received ? 'in' : 'muted'}">${g.received ? '+' + inr(g.received, false) : '–'}</dd></div>
      <div><dt>Paid</dt><dd class="${g.paid ? 'out' : 'muted'}">${g.paid ? '−' + inr(g.paid, false) : '–'}</dd></div><div class="cl"><dt>Closing</dt><dd>${inr(g.closing, false)}</dd></div></dl></div>`;
    shell('Day Book', esc(longDate), `
      <div class="db-nav"><button class="icon-btn" id="dprev" aria-label="Previous day">${ic('prev')}</button>
        <input type="date" id="ddate" value="${S.dbDate}" max="${todayIso()}" aria-label="Day">
        <button class="icon-btn" id="dnext" aria-label="Next day" ${isToday ? 'disabled' : ''}>${ic('next')}</button>
        ${isToday ? '' : '<button class="btn" id="dtoday">Today</button>'}</div>` + exportBtn(), `
      <div class="db-cards">
        ${card('Cash', d.cash, 'cash')}
        ${card('Bank accounts', d.bank, 'bank')}
        ${card('Total', { opening: d.cash.opening + d.bank.opening, received: d.cash.received + d.bank.received, paid: d.cash.paid + d.bank.paid, closing: d.cash.closing + d.bank.closing }, 'total')}
      </div>
      <div class="panel" style="margin-top:16px"><div class="panel-h"><h2>Entries</h2><small>${d.entries.length} on this day</small></div>
        ${d.entries.length ? `<div class="tbl-wrap"><table><thead><tr><th>Particulars</th><th class="hide-m">Type</th><th>Account</th><th class="hide-m">From</th><th class="num">Received (in)</th><th class="num">Paid (out)</th></tr></thead><tbody>
          ${d.entries.map((e) => `<tr class="${e.ref ? 'click' : ''}" data-ref="${e.ref ? esc(e.ref.join(':')) : ''}"><td class="wrap">${esc(e.text)}</td><td class="hide-m"><span class="pill ${KIND[e.kind][0]}">${KIND[e.kind][1]}</span></td><td>${esc(e.account)}</td><td class="hide-m muted">${esc(e.from)}</td><td class="num in">${e.in ? inr(e.in, false) : ''}</td><td class="num out">${e.out ? inr(e.out, false) : ''}</td></tr>`).join('')}
          <tr class="total"><td colspan="2">Total</td><td class="hide-m"></td><td class="hide-m"></td><td class="num">${inr(tin, false)}</td><td class="num">${inr(tout, false)}</td></tr>
        </tbody></table></div>` : '<div class="empty">No entries on this day.</div>'}
      </div>
      <div class="panel" style="margin-top:16px"><div class="panel-h"><h2>Balances by account</h2></div><div class="tbl-wrap"><table>
        <thead><tr><th>Account</th><th class="num">Opening</th><th class="num">Received</th><th class="num">Paid</th><th class="num">Closing</th></tr></thead><tbody>
        ${d.accounts.map((a) => `<tr><td class="strong">${esc(a.account)}</td><td class="num">${inr(a.opening)}</td><td class="num ${a.received ? 'in' : 'muted'}">${inr(a.received)}</td><td class="num ${a.paid ? 'out' : 'muted'}">${inr(a.paid)}</td><td class="num strong">${inr(a.closing, false)}</td></tr>`).join('')}
      </tbody></table></div></div>
      <p class="hint" style="margin:10px 2px">Receipts: booking advances, sale payments, finance DD, service bills and other money received. Payments: expenses. Transfers: cash deposits and bank-to-bank moves, shown on both accounts.</p>`);
    const go = (v) => { S.dbDate = v; pageDaybook(); };
    document.getElementById('dprev').onclick = () => go(shift(-1));
    const nx = document.getElementById('dnext'); if (nx) nx.onclick = () => go(shift(1));
    const td = document.getElementById('dtoday'); if (td) td.onclick = () => go(todayIso());
    document.getElementById('ddate').onchange = (e) => e.target.value && go(e.target.value);
    document.querySelectorAll('tr[data-ref]').forEach((tr) => tr.dataset.ref && (tr.onclick = () => { const [k, r] = tr.dataset.ref.split(':'); if (canDo(k, 'view')) openRow(k, Number(r)); }));
    wireExport(() => ({
      title: 'Day Book', subtitle: longDate,
      sections: [
        { heading: 'Summary', columns: [{ label: '' }, { label: 'Opening', type: 'money' }, { label: 'Received', type: 'money' }, { label: 'Paid', type: 'money' }, { label: 'Closing', type: 'money' }],
          rows: [['Cash', d.cash.opening, d.cash.received, d.cash.paid, d.cash.closing], ['Bank accounts', d.bank.opening, d.bank.received, d.bank.paid, d.bank.closing]],
          totals: ['Total', d.cash.opening + d.bank.opening, d.cash.received + d.bank.received, d.cash.paid + d.bank.paid, d.cash.closing + d.bank.closing] },
        { heading: 'Entries', columns: [{ label: 'Particulars' }, { label: 'Type' }, { label: 'Account' }, { label: 'From' }, { label: 'Received', type: 'money' }, { label: 'Paid', type: 'money' }],
          rows: d.entries.map((e) => [e.text, KIND[e.kind][1], e.account, e.from, e.in || '', e.out || '']), totals: ['Total', '', '', '', tin, tout] },
        { heading: 'Balances by account', columns: [{ label: 'Account' }, { label: 'Opening', type: 'money' }, { label: 'Received', type: 'money' }, { label: 'Paid', type: 'money' }, { label: 'Closing', type: 'money' }],
          rows: d.accounts.map((a) => [a.account, a.opening, a.received, a.paid, a.closing]) },
      ],
    }));
  }

  // ---------- Excel / PDF export ----------
  const exportBtn = () => `<div class="xmenu"><button class="btn" id="xbtn" aria-haspopup="true">${ic('download')}<span class="new-label">Export</span>${ic('chevron')}</button>
    <div class="menu" id="xmenu" hidden><button data-x="xlsx">${ic('xlsx')}Excel (.xlsx)</button><button data-x="pdf">${ic('pdf')}PDF</button></div></div>`;
  function wireExport(build) {
    const btn = document.getElementById('xbtn'), menu = document.getElementById('xmenu');
    if (!btn) return;
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) document.addEventListener('click', () => (menu.hidden = true), { once: true }); };
    menu.querySelectorAll('[data-x]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation(); menu.hidden = true;
      const fmt = b.dataset.x;
      btn.disabled = true;
      try {
        const res = await fetch('/api/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RE-App': '1' }, body: JSON.stringify({ ...build(fmt), format: fmt }) });
        if (!res.ok) { let m = 'Export failed'; try { m = (await res.json()).error || m; } catch { /* */ } throw new Error(m); }
        const blob = await res.blob();
        const name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || `report.${fmt}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        toast(`Downloaded ${name}`);
      } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
    });
  }
  // a sheet column as an export column + value
  const xType = (c) => (c.type === 'money' || c.money ? 'money' : c.type === 'date' ? 'date' : 'text');
  const xVal = (c, v) => (v === '' || v === null || v === undefined ? '' : (c.status || c.check) ? indianAmounts(pillText(String(v))) : xType(c) === 'money' ? num(v) : v);
  const colSort = (a, b) => (a.c.length - b.c.length) || (a.c < b.c ? -1 : 1);
  function sheetReport(key, rows, filterLabel, query, fmt) {
    const sh = S.schema[key];
    // Excel: every column in sheet order; PDF: the columns shown on screen
    const cols = fmt === 'pdf' ? sh.list.map((c) => colOf(key, c)) : sh.cols.slice().sort(colSort);
    const totals = cols.map((c, i) => (xType(c) === 'money' ? rows.reduce((s, r) => s + num(r[c.c]), 0) : i === 0 ? `Total (${rows.length})` : ''));
    return {
      title: sh.title,
      subtitle: `${filterLabel}${query ? ` · search "${query}"` : ''} · ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`,
      sections: [{ heading: sh.title, columns: cols.map((c) => ({ label: c.label, type: xType(c) })), rows: rows.map((r) => cols.map((c) => xVal(c, r[c.c]))), totals }],
    };
  }

  // ---------- sheet list pages ----------
  const FILTERS = {
    stock: [['instock', 'In stock', (r) => r.H !== 'Sold'], ['avail', 'Available', (r) => r.H === 'Available'], ['allot', 'Allotted', (r) => r.H === 'Allotted'], ['sold', 'Sold', (r) => r.H === 'Sold'], ['all', 'All', () => true]],
    bookings: [['open', 'Open', (r) => r.M !== 'Delivered'], ['notallot', 'Not allotted', (r) => r.M !== 'Delivered' && r.K === 'Not Allotted'], ['allot', 'Allotted', (r) => r.M !== 'Delivered' && r.K === 'Vehicle Allotted'], ['overdue', 'Overdue', (r) => String(r.O).startsWith('OVERDUE')], ['delivered', 'Delivered', (r) => r.M === 'Delivered']],
    sales: [['all', 'All', () => true], ['owes', 'Customer owes', (r) => num(r.AI) >= 0.5], ['dd', 'DD pending', (r) => num(r.AH) >= 0.5], ['paid', 'Fully paid', (r) => r.AJ === 'FULLY PAID'], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)]],
    service: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)], ['today', 'Today', (r) => r.A === todayIso()]],
    expenses: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)], ['today', 'Today', (r) => r.A === todayIso()]],
    bank: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)]],
    payments: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)], ['today', 'Today', (r) => r.A === todayIso()]],
  };
  const NEW_LABEL = { stock: 'Add vehicle', bookings: 'New booking', sales: 'New sale', payments: 'Add payment', service: 'New service bill', expenses: 'New expense', bank: 'New bank entry' };

  async function pageSheet(key) {
    const sh = S.schema[key];
    if (!sh) return pageDashboard();
    loading(sh.title);
    const res = await api('GET', `/api/sheets/${key}`);
    S.data[key] = res;
    if (key === 'sales') await loadSaleExtras();
    if (!S.filter[key]) S.filter[key] = FILTERS[key][0][0];
    renderSheet(key);
  }

  function renderSheet(key) {
    const sh = S.schema[key], res = S.data[key];
    const fl = FILTERS[key];
    const f = fl.find((x) => x[0] === S.filter[key]) || fl[0];
    const qv = (S.q[key] || '').toLowerCase();
    const rows = res.rows.filter(f[2]).filter((r) => !qv || Object.values(r).some((v) => String(v).toLowerCase().includes(qv)))
      .sort((a, b) => b._row - a._row);
    const pend = new Set(res.pending), appr = new Map(res.approved.map((a) => [a.row, a.minutes]));
    const phoneCol = sh.cols.find((c) => c.type === 'phone');
    const cols = sh.list.filter((c) => !phoneCol || c !== phoneCol.c).map((c) => colOf(key, c));
    const nameCell = (c, r) => `<span class="strong">${cellHtml(c, r[c.c])}</span>${flag(r)}${phoneCol && c.c === 'B' && r[phoneCol.c] ? `<span class="sub">${esc(r[phoneCol.c])}</span>` : ''}`;
    const flag = (r) => (appr.has(r._row) ? `<span class="row-flag in">${ic('unlock')}open ${appr.get(r._row)}m</span>` : pend.has(r._row) ? `<span class="row-flag" style="color:var(--amber-d)">${ic('clock')}edit requested</span>` : '');
    const mobTitle = { stock: (r) => `${r.B} · ${r.E}`, bookings: (r) => r.B, sales: (r) => r.B, payments: (r) => r.C || r.B, service: (r) => r.B, expenses: (r) => r.B, bank: (r) => r.C };
    const mobPill = { stock: 'H', bookings: 'K', sales: 'AJ', payments: '', service: '', expenses: '', bank: '' };
    const mobMeta = {
      stock: (r) => [r.C, r.D, inr(r.G), r.I],
      bookings: (r) => [fdate(r.A), r.D, r.C, r.J || '', String(r.O).startsWith('OVERDUE') ? r.O : ''],
      sales: (r) => [fdate(r.A), r.E, r.I, 'Cost ' + inr(r.Q), num(r.AI) > 0.5 ? 'Owes ' + inr(r.AI) : ''],
      payments: (r) => [fdate(r.A), inr(r.D), r.E, r.B, r.F ? 'UTR ' + r.F : ''],
      service: (r) => [fdate(r.A), r.C, r.D, inr(r.E)],
      expenses: (r) => [fdate(r.A), r.C, r.D, inr(r.E)],
      bank: (r) => [fdate(r.A), r.B, r.D, num(r.E) ? '+' + inr(r.E) : '-' + inr(r.F)],
    };
    const count = (fn) => res.rows.filter(fn).length;
    const body = `
      <div class="toolbar">
        <input class="search" id="q" aria-label="Search entries" placeholder="Search name, mobile, engine…" value="${esc(S.q[key] || '')}">
        <div class="chips">${fl.map(([k, label, fn]) => `<button class="chip ${k === f[0] ? 'on' : ''}" data-f="${k}">${label}<span class="n">${count(fn)}</span></button>`).join('')}</div>
      </div>
      <div class="panel desk-table">${rows.length ? `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.type === 'money' || c.money ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-row="${r._row}">${cols.map((c, i) => `<td class="${c.type === 'money' || c.money ? 'num' : c.type === 'date' ? 'date' : i === 1 ? 'wrap' : ''}">${i === 1 ? nameCell(c, r) : cellHtml(c, r[c.c])}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">Nothing here yet.${canDo(key, 'add') ? ' Use the button above to add the first entry.' : ''}</div>`}</div>
      <div class="mob-cards">${rows.map((r) => `<div class="mcard" data-row="${r._row}"><div class="t"><b>${esc(mobTitle[key](r))}</b>${pill(r[mobPill[key]])}</div>
        <div class="m">${mobMeta[key](r).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}${flag(r)}</div></div>`).join('') || '<div class="empty">Nothing here yet.</div>'}</div>`;
    const sub = key === 'bookings' ? 'Sold bookings move to Delivered automatically' : `${res.rows.length} entries`;
    shell(sh.title, sub, exportBtn() + (canDo(key, 'add') ? `<button class="btn primary" id="new">${ic('plus')}<span class="new-label">${NEW_LABEL[key]}</span></button>` : ''), body);
    wireExport((fmt) => sheetReport(key, rows, f[1], S.q[key] || '', fmt));
    const q = document.getElementById('q');
    q.oninput = () => { S.q[key] = q.value; const pos = q.selectionStart; renderSheet(key); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); };
    document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { S.filter[key] = b.dataset.f; renderSheet(key); });
    document.querySelectorAll('[data-row]').forEach((tr) => tr.onclick = () => openRow(key, Number(tr.dataset.row)));
    const nb = document.getElementById('new');
    if (nb) nb.onclick = () => openForm(key, null);
  }


  // ---------- accessibility helpers ----------
  let uid = 0;
  const DIALOGS = [];   // open dialogs, newest last: keys go to the top one only
  // tie every label to its field: screen readers name the field, and tapping the label focuses it
  function linkLabels(root) {
    root.querySelectorAll('.field').forEach((f) => {
      const label = f.querySelector(':scope > label');
      const ctl = f.querySelector('input:not([type=hidden]), select, textarea');
      if (!label || !ctl || label.htmlFor) return;
      if (!ctl.id) ctl.id = 'f' + (++uid);
      label.htmlFor = ctl.id;
    });
  }
  // drawers and pop-ups act as dialogs: announced as one, focus moves in and stays in, Escape closes, focus goes back
  function asDialog(el, box, close, { focusBox = false } = {}) {
    const opener = document.activeElement;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const h = box.querySelector('h3, h2');
    if (h) { if (!h.id) h.id = 'dlg' + (++uid); box.setAttribute('aria-labelledby', h.id); }
    linkLabels(box);
    const focusables = () => [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])')].filter((x) => x.offsetParent !== null);
    DIALOGS.push(el);
    const onKey = (e) => {
      if (DIALOGS[DIALOGS.length - 1] !== el) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    el._release = () => { document.removeEventListener('keydown', onKey); const k = DIALOGS.indexOf(el); if (k >= 0) DIALOGS.splice(k, 1); if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true }); };
    // focus the panel itself, so phones don't pop the keyboard; Tab goes on to the first field
    if (focusBox) { box.tabIndex = -1; box.focus({ preventScroll: true }); }
  }

  // ---------- drawer: view / edit / new ----------
  function closeDrawer() {
    const open = [...document.querySelectorAll('.drawer')];
    document.querySelectorAll('.scrim,.drawer').forEach((x) => x.remove());
    open.forEach((x) => x._release?.());
  }
  function drawer(html) {
    closeDrawer();
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.onclick = closeDrawer;
    const d = document.createElement('div'); d.className = 'drawer'; d.innerHTML = html;
    document.body.append(scrim, d);
    d.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeDrawer);
    asDialog(d, d, closeDrawer, { focusBox: true });
    return d;
  }

  // the sale form shows the sale's payments and adds its booking advance
  async function loadSaleExtras() {
    S.data.payments = await api('GET', '/api/sheets/payments');
    if (canDo('bookings', 'view')) S.data.bookings = await api('GET', '/api/sheets/bookings');
  }
  async function openRow(key, row) {
    // always open with the latest values and approval state
    try { S.data[key] = await api('GET', `/api/sheets/${key}`); if (key === 'sales') await loadSaleExtras(); } catch (e) { if (e.status === 401) return renderLogin(); }
    const rec = S.data[key].rows.find((r) => r._row === row);
    if (rec) openForm(key, rec); else { toast('This entry was changed. Reloading…', true); pageSheet(key === 'payments' ? 'sales' : key); }
  }

  function engineOptions(key, cur, form) {
    const list = S.engines.filter((e) => {
      if (e.engine === String(cur)) return true;
      if (key === 'bookings') return e.status === 'Available' && (!form.D || e.model === form.D);
      return e.status !== 'Sold';
    });
    return list.map((e) => ({ v: e.engine, t: `${e.engine} · ${e.model}${e.colour ? ' · ' + e.colour : ''}${e.status === 'Allotted' ? ' · allotted to ' + (e.to || '') : e.status === 'Sold' ? ' · sold' : ''}` }));
  }

  // amounts far above normal are usually a typing slip (an extra zero): ask before saving
  const HIGH = { stock: { G: 1500000 }, bookings: { G: 500000 }, service: { E: 100000 }, expenses: { E: 500000 },
    sales: { K: 1500000, AB: 1500000, AC: 1500000 }, payments: { D: 1500000 }, bank: { E: 5000000, F: 5000000 } };
  let salesBal = 0;
  function confirmUnusual(key, form, rec) {
    const notes = [];
    for (const [c, lim] of Object.entries(HIGH[key] || {})) {
      if (num(form[c]) > lim && (!rec || String(rec[c]) !== String(form[c]))) notes.push(`${colOf(key, c).label}: ${inr(form[c], false)} is more than usual (over ${inr(lim, false)}).`);
    }
    if (key === 'sales' && salesBal < -0.5) notes.push(`Payments are ${inr(-salesBal, false)} more than the vehicle cost.`);
    return !notes.length || confirm(`${notes.join('\n')}\n\nSave anyway?`);
  }

  function openForm(key, rec) {
    salesBal = 0;
    const sh = S.schema[key];
    const isNew = !rec;
    const res = S.data[key] || { pending: [], approved: [] };
    const approved = !isNew && res.approved.find((a) => a.row === rec._row);
    const pending = !isNew && res.pending.includes(rec._row);
    const form = {};
    sh.cols.forEach((c) => (form[c.c] = isNew ? '' : rec[c.c]));
    if (isNew) sh.cols.forEach((c) => { if (c.type === 'date' && c.req) form[c.c] = todayIso(); });
    const canEdit = (c) => c.type !== 'auto' && canDo(key, 'add') && (isNew || form[c.c] === '' || rec[c.c] === '' || canDo(key, 'edit') || !!approved);
    const lockedAny = !isNew && sh.cols.some((c) => c.type !== 'auto' && rec[c.c] !== '' && !canEdit(c));
    const groups = sh.groups || [{ title: 'Details', cols: sh.cols.map((c) => c.c) }];

    const fieldHtml = (c) => {
      const v = form[c.c];
      const hp = (c.hpOnly ? ` data-hp="1"` : '') + (c.refOf ? ` data-ref="${c.refOf}"` : '');
      if (c.type === 'auto') {
        if (isNew && key !== 'sales') return '';
        if (isNew) return `<div class="field"${hp}><label>${esc(c.label)}</label><div class="ro auto" data-auto="${c.c}">${cellHtml(c, v) || '<span class="muted">auto</span>'}</div></div>`;
        return `<div class="field"><label>${esc(c.label)}</label><div class="ro auto">${cellHtml(c, v) || '<span class="muted">–</span>'}</div></div>`;
      }
      if (!canEdit(c)) {
        return `<div class="field"${hp}><label>${esc(c.label)}</label><div class="ro">${cellHtml(c, v) || '<span class="muted">–</span>'}${v !== '' && !isNew ? ic('lock') : ''}</div></div>`;
      }
      const req = c.req ? ' <span class="req">*</span>' : '';
      let input;
      if (c.type === 'list' || c.type === 'engine' || c.type === 'sold') {
        const opts = c.type === 'engine' ? engineOptions(key, v, form)
          : c.type === 'sold' ? S.sold.slice().reverse().map((x) => ({ v: x.engine, t: `${x.engine} · ${x.customer}${x.model ? ' · ' + x.model : ''}` }))
          : (S.lists[c.list] || []).map((x) => ({ v: x, t: x }));
        if (v !== '' && !opts.some((o) => String(o.v) === String(v))) opts.unshift({ v, t: String(v) });
        input = `<select name="${c.c}"><option value="">— select —</option>${opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
      } else if (c.type === 'date') {
        input = `<input type="date" name="${c.c}" value="${esc(v)}">`;
      } else if (c.type === 'money') {
        input = `<input type="number" inputmode="decimal" min="0" step="any" name="${c.c}" value="${esc(v)}" placeholder="₹">`;
      } else if (c.type === 'phone') {
        input = `<input type="tel" inputmode="numeric" maxlength="10" name="${c.c}" value="${esc(v)}" placeholder="10-digit mobile">`;
      } else {
        input = `<input type="text" name="${c.c}" value="${esc(v)}" maxlength="200"${c.refOf ? ' placeholder="UTR / transaction ID" autocomplete="off" spellcheck="false"' : ''}>`;
      }
      return `<div class="field"${hp}><label>${esc(c.label)}${req}</label>${input}${c.hint ? `<small class="fhint">${esc(c.hint)}</small>` : ''}</div>`;
    };

    let notice = '';
    if (!isNew && approved) notice = `<div class="notice ok">${ic('unlock')}<div><b>Edit approved.</b> This entry is open for you for about ${approved.minutes} more minutes.</div></div>`;
    else if (!isNew && pending) notice = `<div class="notice warn">${ic('clock')}<div><b>Edit request sent.</b> Waiting for the Admin to approve it.</div></div>`;
    else if (!isNew && lockedAny && canDo(key, 'add')) notice = `<div class="notice info">${ic('lock')}<div>Saved values are locked. You can fill empty fields. To change a saved value, send an edit request to the Admin.</div></div>`;
    else if (!isNew && canDo(key, 'edit')) notice = `<div class="notice info">${ic('info')}<div>You can change saved values. Every change is written to the Edit Log with your name.</div></div>`;

    const title = isNew ? NEW_LABEL[key] : (key === 'stock' ? `${rec.B} · ${rec.E}` : key === 'bank' ? rec.C : key === 'payments' ? `Payment · ${rec.C || rec.B}` : rec.B);
    const d = drawer(`
      <div class="drawer-h"><div><h3>${esc(title)}</h3><small>${esc(sh.title)}${isNew ? '' : ' · sheet row ' + rec._row}</small></div><div class="grow"></div>
        <button class="icon-btn" data-close style="color:var(--navy)">${ic('x')}</button></div>
      <form class="drawer-b" id="f" autocomplete="off" novalidate>
        ${notice}
        ${key === 'sales' ? '<div class="fgroup"><h4>Tally</h4><div class="tally" id="tally"></div></div>' : ''}
        ${groups.map((g) => { const inner = g.cols.map((c) => fieldHtml(colOf(key, c))).join(''); return (inner ? `<div class="fgroup"${g.hpOnly ? ' data-hp="1"' : ''}><h4>${esc(g.title)}</h4><div class="fgrid">${inner}</div></div>` : '') + (key === 'sales' && g.title === 'Vehicle cost' ? '<div class="fgroup" id="paygrp"></div>' : ''); }).join('')}
      </form>
      <div class="drawer-f">
        ${!isNew && lockedAny && canDo(key, 'add') && !approved && !pending ? `<button class="btn" id="reqedit">${ic('shield')}Request edit</button>` : ''}
        <div style="flex:1"></div>
        <button class="btn" data-close>${canDo(key, 'add') ? 'Cancel' : 'Close'}</button>
        ${canDo(key, 'add') && (isNew || key === 'sales' || sh.cols.some(canEdit)) ? `<button class="btn primary" id="save">${ic('check')}${isNew ? 'Save entry' : 'Save changes'}</button>` : ''}
      </div>`);

    const f = d.querySelector('#f');
    const read = () => { f.querySelectorAll('[name]').forEach((el) => (form[el.name] = el.value)); };

    // ---- Vehicle Sales: any number of customer payments (saved in Sale Payments) ----
    const savedPays = key === 'sales' && !isNew ? (S.data.payments?.rows || []).filter((p) => String(p.B) === String(rec.D)).sort((a, b) => (a.A < b.A ? -1 : 1)) : [];
    const newPays = [];
    const canPay = key === 'sales' && canDo('sales', 'add');
    const accOpts = (v) => `<option value="">Account…</option>${(S.lists.accounts || []).map((a) => `<option ${a === v ? 'selected' : ''}>${esc(a)}</option>`).join('')}`;
    function drawPays() {
      const g = d.querySelector('#paygrp'); if (!g) return;
      const n = savedPays.length + newPays.length;
      g.innerHTML = `<h4>Customer payments${n ? ` <span class="muted">· ${n}</span>` : ''}</h4>
        ${savedPays.length ? `<ul class="pays">${savedPays.map((p) => `<li><span class="pd">${fdate(p.A)}</span><b>${inr(p.D, false)}</b><span>${esc(p.E)}</span><span class="muted">${p.F ? 'UTR ' + esc(p.F) : ''}${p.G ? (p.F ? ' · ' : '') + esc(p.G) : ''}</span><button type="button" class="link" data-openpay="${p._row}">Open</button></li>`).join('')}</ul>` : ''}
        ${newPays.map((p, i) => `<div class="np" data-i="${i}">
          <input type="date" data-k="A" value="${esc(p.A)}" aria-label="Payment date">
          <input type="number" inputmode="decimal" min="0" step="any" data-k="D" value="${esc(p.D)}" placeholder="₹ Amount" aria-label="Payment amount">
          <select data-k="E" aria-label="Received in">${accOpts(p.E)}</select>
          <input type="text" data-k="F" value="${esc(p.F)}" placeholder="UTR / transaction ID" aria-label="UTR or reference number" autocomplete="off" spellcheck="false" ${p.E && !/cash/i.test(p.E) ? '' : 'hidden'}>
          <input type="text" data-k="G" value="${esc(p.G)}" placeholder="Remarks (optional)" aria-label="Remarks" maxlength="200">
          <button type="button" class="icon-btn np-x" aria-label="Remove this payment">${ic('x')}</button></div>`).join('')}
        ${!n ? '<p class="hint" style="margin:0 0 10px">No payments yet. The booking advance is counted automatically.</p>' : ''}
        ${canPay ? `<button type="button" class="btn sm" id="addpay">${ic('plus')}Add payment</button>` : ''}`;
      g.querySelectorAll('.np').forEach((row) => {
        const p = newPays[+row.dataset.i];
        row.querySelectorAll('[data-k]').forEach((el) => {
          el.oninput = el.onchange = () => { p[el.dataset.k] = el.value; if (el.dataset.k === 'E') row.querySelector('[data-k="F"]').hidden = !(p.E && !/cash/i.test(p.E)); sync(); };
        });
        row.querySelector('.np-x').onclick = () => { newPays.splice(+row.dataset.i, 1); drawPays(); sync(); };
      });
      g.querySelectorAll('[data-openpay]').forEach((b) => b.onclick = () => openRow('payments', Number(b.dataset.openpay)));
      const ab = g.querySelector('#addpay');
      if (ab) ab.onclick = () => { newPays.push({ A: todayIso(), D: '', E: '', F: '', G: '' }); drawPays(); g.querySelector(`.np[data-i="${newPays.length - 1}"] [data-k="D"]`)?.focus(); };
    }
    const sync = () => {
      read();
      // UTR / reference: only for money into a bank account (GPay, UPI, NEFT, card)
      d.querySelectorAll('[data-ref]').forEach((el) => {
        const acc = String(form[el.dataset.ref] || '');
        const input = el.querySelector('input');
        const filled = input ? input.value.trim() !== '' : el.querySelector('.ro')?.textContent.trim() !== '–';
        el.style.display = (acc && !/cash/i.test(acc)) || filled ? '' : 'none';
      });
      if (key === 'sales') {
        const hp = form.I === 'HP';
        d.querySelectorAll('[data-hp]').forEach((el) => (el.style.display = hp || (!isNew && !canEdit(colOf(key, 'I')) && rec.I === 'HP') ? '' : 'none'));
        const e = S.engines.find((x) => x.engine === String(form.D));
        if (isNew) {
          const set = (c, v) => { const el = d.querySelector(`[data-auto="${c}"]`); if (el) el.innerHTML = v ? esc(v) : '<span class="muted">auto</span>'; };
          set('E', e?.model); set('F', e?.variant); set('G', e?.colour); set('H', e?.frame);
        }
        const adv = !isNew ? num(rec.R) : (S.data.bookings?.rows || []).filter((b) => String(b.J) === String(form.D) && form.D).reduce((s, b) => s + num(b.G), 0);
        const docs = hp ? num(form.S) : 0;
        const total = num(form.K) + num(form.L) + num(form.M) + num(form.N) + num(form.O) - num(form.P) + docs;
        const paid = adv + savedPays.reduce((s, p) => s + num(p.D), 0) + newPays.reduce((s, p) => s + num(p.D), 0);
        const dd = hp ? (form.AD ? num(form.AC) : num(form.AB)) : 0;
        const bal = total - paid - dd;
        salesBal = total ? bal : 0;
        const ddPend = hp && !form.AD ? num(form.AB) - num(form.AC) : 0;
        d.querySelector('#tally').innerHTML = `
          <div><small>${docs ? 'Total cost + doc charges' : 'Total cost'}</small><b>${inr(total, false)}</b></div>
          <div><small>Booking advance</small><b>${inr(adv, false)}</b></div>
          <div class="${ddPend >= 0.5 ? 'bad' : ''}"><small>DD pending</small><b>${inr(Math.max(0, ddPend), false)}</b></div>
          ${total ? `<div class="${bal >= 0.5 ? 'bad' : ''}"><small>${bal < -0.5 ? 'Overpaid' : 'Customer balance'}</small><b>${inr(Math.abs(bal), false)}</b></div>` : '<div><small>Customer balance</small><b>–</b></div>'}`;
      }
    };
    f.addEventListener('input', sync);
    // a mobile number already in Bookings fills the customer (and, in a sale, the allotted engine)
    let lastMob = '';
    const findCustomer = (value) => {
      const mob = String(value).replace(/\D/g, '');
      if (mob.length !== 10 || mob === lastMob) return;
      lastMob = mob;
      const same = (S.data.bookings?.rows || []).filter((b) => String(b.C).replace(/\D/g, '') === mob).sort((a, b) => (a.A < b.A ? 1 : -1));
      if (!same.length) return;
      const fill = (c, v) => { const el = f.querySelector(`[name="${c}"]`); if (el && !el.value && v !== '' && v != null) el.value = v; };
      if (key === 'bookings') {
        const b = same[0];
        fill('B', b.B);
        toast(`Existing customer: ${b.B}. Last booking ${b.D} on ${fdate(b.A)}${b.M === 'Delivered' ? ', delivered' : ''}.`);
      } else {
        const b = same.find((x) => x.M !== 'Delivered');
        if (!b) { fill('B', same[0].B); toast(`${same[0].B}: this customer's booking is already delivered.`); sync(); return; }
        fill('B', b.B);
        const sel = f.querySelector('[name="D"]');
        const allotted = b.J && sel && [...sel.options].some((o) => o.value === String(b.J));
        if (allotted && !sel.value) sel.value = b.J;
        toast(allotted ? `Booking found: ${b.B}, ${b.D}. Engine ${b.J} and the advance ${inr(b.G)} are filled in.`
          : `Booking found: ${b.B}, ${b.D}, advance ${inr(b.G)}. No vehicle allotted yet: pick the engine no.`);
      }
      sync();
    };
    if (isNew && (key === 'sales' || key === 'bookings')) f.addEventListener('input', (ev) => { if (ev.target.name === 'C') findCustomer(ev.target.value); });
    f.addEventListener('change', (ev) => {
      // typing a payment fills its date with today (still editable)
      const dateFor = { AC: 'AD' }[ev.target.name];
      if (key === 'sales' && dateFor && ev.target.value) {
        const de = f.querySelector(`[name="${dateFor}"]`);
        if (de && !de.value) de.value = todayIso();
      }
      if (key === 'sales' && ev.target.name === 'D' && isNew) {
        const b = (S.data.bookings?.rows || []).find((x) => String(x.J) === ev.target.value);
        if (b) { ['B', 'C'].forEach((c) => { const el = f.querySelector(`[name="${c}"]`); if (el && !el.value) el.value = b[c]; }); toast(`Booking found: ${b.B}. Advance ${inr(b.G)} is added automatically.`); }
      }
      if (key === 'bookings' && ev.target.name === 'D') {
        const sel = f.querySelector('[name="J"]');
        if (sel) { read(); sel.innerHTML = '<option value="">— select —</option>' + engineOptions(key, form.J, form).map((o) => `<option value="${esc(o.v)}" ${o.v === form.J ? 'selected' : ''}>${esc(o.t)}</option>`).join(''); }
      }
      sync();
    });
    if (key === 'sales' && !S.data.bookings && canDo('bookings', 'view')) api('GET', '/api/sheets/bookings').then((r) => { S.data.bookings = r; sync(); }).catch(() => {});
    if (key === 'sales') drawPays();
    sync();

    const save = d.querySelector('#save');
    if (save) save.onclick = async () => {
      read();
      const pays = newPays.filter((p) => p.D !== '' || p.F || p.G);
      for (const [i, p] of pays.entries()) {
        const n = savedPays.length + i + 1;
        if (!(num(p.D) > 0)) return toast(`Payment ${n}: enter the amount`, true);
        if (!p.A) return toast(`Payment ${n}: pick the date`, true);
        if (!p.E) return toast(`Payment ${n}: pick the account it was received in`, true);
        if (!/cash/i.test(p.E) && !String(p.F).trim()) return toast(`Payment ${n} went to ${p.E}: enter its UTR / reference no (GPay, UPI, NEFT, card).`, true);
      }
      if (pays.some((p) => num(p.D) > HIGH.payments.D) && !confirm(`A payment is more than ${inr(HIGH.payments.D, false)}. Save anyway?`)) return;
      if (!confirmUnusual(key, form, isNew ? null : rec)) return;
      const body = {};
      sh.cols.filter(canEdit).forEach((c) => {
        if (key === 'sales' && c.hpOnly && form.I !== 'HP') { if (!isNew && rec[c.c] !== '') body[c.c] = ''; return; }
        if (isNew || String(form[c.c] ?? '') !== String(rec[c.c] ?? '')) body[c.c] = form[c.c];
      });
      const payList = key === 'sales' ? newPays.filter((p) => num(p.D) > 0) : [];
      if (!isNew && !Object.keys(body).length && !payList.length) { closeDrawer(); return; }
      save.disabled = true;
      try {
        if (isNew || Object.keys(body).length) await api(isNew ? 'POST' : 'PUT', isNew ? `/api/sheets/${key}` : `/api/sheets/${key}/${rec._row}`, body);
        let paid = 0, payErr = '';
        const engine = String(form.D || rec?.D || '');
        for (const p of payList) {
          try { await api('POST', '/api/sheets/payments', { A: p.A, B: engine, D: p.D, E: p.E, F: p.F, G: p.G }); paid++; }
          catch (e) { payErr = e.message; break; }
        }
        if (payErr) toast(`${isNew ? 'Sale saved' : 'Saved'}, but payment ${paid + 1} wasn't: ${payErr}`, true);
        else toast(payList.length ? `${isNew ? 'Sale saved' : 'Saved'} with ${paid} ${paid === 1 ? 'payment' : 'payments'}` : isNew ? 'Saved to the sheet' : 'Changes saved');
        closeDrawer();
        await refreshCore();
        pageSheet(key === 'payments' ? 'sales' : key);
      } catch (e) { if (e.status === 401) { closeDrawer(); return renderLogin('Session expired: please sign in again.'); } toast(e.message, true); save.disabled = false; }
    };
    const rq = d.querySelector('#reqedit');
    if (rq) rq.onclick = () => askReason(key, rec);
  }

  function askReason(key, rec) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="scrim" style="position:absolute"></div><div class="box" style="position:relative">
      <h3>Request edit</h3><p>${esc(S.schema[key].title)} · row ${rec._row}. The Admin will get your request.</p>
      <div class="field"><label>What do you want to change, and why?</label><textarea id="why" rows="3" placeholder="e.g. Mobile number typed wrong, correct is 98xxxxxx"></textarea></div>
      <div class="acts"><button class="btn" id="c">Cancel</button><button class="btn primary" id="s">Send request</button></div></div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); m._release?.(); };
    asDialog(m, m.querySelector('.box'), close);
    m.querySelector('#why').focus();
    m.querySelector('#c').onclick = () => close();
    m.querySelector('.scrim').onclick = () => close();
    m.querySelector('#s').onclick = async () => {
      const reason = m.querySelector('#why').value.trim();
      if (!reason) return toast('Please write the reason', true);
      try {
        await api('POST', `/api/sheets/${key}/${rec._row}/request`, { reason });
        close(); closeDrawer(); toast('Request sent to the Admin'); pageSheet(key);
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---------- ledger ----------
  async function pageLedger() {
    loading('Bank Ledger');
    const L0 = await api('GET', '/api/ledger');
    // cash has its own book (Day Book); this page is bank accounts only
    const L = { ...L0, accounts: L0.accounts.filter((x) => !/cash/i.test(x.account)) };
    S.ledgerAcc = S.ledgerAcc && L.accounts.some((a) => a.account === S.ledgerAcc) ? S.ledgerAcc : L.accounts[0]?.account;
    const a = L.accounts.find((x) => x.account === S.ledgerAcc) || { lines: [] };
    const total = L.accounts.reduce((s, x) => s + x.closing, 0);
    shell('Bank Ledger', 'Bank accounts only. Cash is in the Day Book.', exportBtn(), `
      ${L.unposted > 0 ? `<div class="notice warn">${ic('info')}<div><b>${inr(L.unposted)}</b> received without an account selected (bank and cash). Open the entry and pick "Received in".</div></div>` : ''}
      <div class="panel" style="margin-bottom:16px"><div class="tbl-wrap"><table><thead><tr><th>Account</th><th class="num hide-m">Opening</th><th class="num hide-m">Received</th><th class="num hide-m">Paid</th><th class="num">Closing</th></tr></thead><tbody>
        ${L.accounts.map((x) => `<tr class="click" data-acc="${esc(x.account)}"><td class="strong">${esc(x.account)}</td><td class="num hide-m">${inr(x.opening)}</td><td class="num in hide-m">${inr(x.received)}</td><td class="num out hide-m">${inr(x.paid)}</td><td class="num"><b>${inr(x.closing)}</b></td></tr>`).join('')}
        <tr><td><b>Total in bank</b></td><td class="hide-m"></td><td class="hide-m"></td><td class="hide-m"></td><td class="num"><b>${inr(total)}</b></td></tr>
      </tbody></table></div></div>
      <div class="tabs">${L.accounts.map((x) => `<button class="chip ${x.account === S.ledgerAcc ? 'on' : ''}" data-acc="${esc(x.account)}">${esc(x.account)}</button>`).join('')}</div>
      <div class="panel strip stat-row" style="--n:4"><div class="st"><div class="l">Opening</div><div class="v">${inr(a.opening, false)}</div></div><div class="st"><div class="l">Received</div><div class="v in">${inr(a.received, false)}</div></div><div class="st"><div class="l">Paid</div><div class="v out">${inr(a.paid, false)}</div></div><div class="st"><div class="l">Closing</div><div class="v">${inr(a.closing, false)}</div></div></div>
      <div class="panel">${a.lines.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Particulars</th><th class="hide-m">From</th><th class="num">In / out</th><th class="num hide-m">Balance</th></tr></thead><tbody>
        ${a.lines.slice().reverse().map((l) => `<tr><td class="date">${fdate(l.date)}</td><td class="wrap">${esc(l.text)}<span class="sub show-m">${esc(l.from)}</span></td><td class="muted hide-m">${esc(l.from)}</td><td class="num">${l.in ? `<span class="in">+${inr(l.in, false)}</span>` : `<span class="out">−${inr(l.out, false)}</span>`}</td><td class="num hide-m"><b>${inr(l.balance, false)}</b></td></tr>`).join('')}
        <tr><td></td><td class="muted">Opening balance</td><td class="hide-m"></td><td class="num">${inr(a.opening, false)}</td><td class="hide-m"></td></tr>
      </tbody></table></div>` : '<div class="empty">No entries for this account yet.</div>'}</div>`);
    document.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => { S.ledgerAcc = b.dataset.acc; pageLedger(); });
    wireExport(() => ({
      title: `Bank Ledger · ${a.account}`, subtitle: `Statement of ${a.account} with all bank accounts`,
      sections: [
        { heading: 'Bank accounts', columns: [{ label: 'Account' }, { label: 'Opening', type: 'money' }, { label: 'Received', type: 'money' }, { label: 'Paid', type: 'money' }, { label: 'Closing', type: 'money' }],
          rows: L.accounts.map((x) => [x.account, x.opening, x.received, x.paid, x.closing]),
          totals: ['Total', L.accounts.reduce((s2, x) => s2 + x.opening, 0), L.accounts.reduce((s2, x) => s2 + x.received, 0), L.accounts.reduce((s2, x) => s2 + x.paid, 0), total] },
        { heading: `${a.account} statement`, columns: [{ label: 'Date', type: 'date' }, { label: 'Particulars' }, { label: 'From' }, { label: 'In', type: 'money' }, { label: 'Out', type: 'money' }, { label: 'Balance', type: 'money' }],
          rows: [['', 'Opening balance', '', '', '', a.opening], ...a.lines.map((l) => [l.date, l.text, l.from, l.in || '', l.out || '', l.balance])],
          totals: ['', 'Closing balance', '', a.received, a.paid, a.closing] },
      ],
    }));
  }

  // ---------- edit requests ----------
  const sheetKeyByName = (n) => Object.keys(S.schema).find((k) => S.schema[k].name === n);
  const serialToText = (s) => { if (typeof s !== 'number') return s || ''; const d = new Date(Math.round((s - 25569 - 330 / 1440) * 86400000)); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  async function pageApprovals() {
    loading('Edit Requests');
    const { requests } = await api('GET', '/api/requests');
    const pend = requests.filter((r) => r.status === 'Pending');
    S.pendingCount = S.user.approve ? pend.length : 0;
    const row = (r) => `<tr>
      <td class="date">${esc(serialToText(r.at))}</td><td>${esc(r.by)}</td>
      <td><a href="#/s/${sheetKeyByName(r.sheet) || ''}">${esc(r.sheet)}</a> · row ${r.row}<div class="muted">${esc(r.entry)}</div></td>
      <td>${esc(r.reason)}</td><td>${pill(r.status)}${r.decidedBy ? `<div class="muted" style="font-size:12px">${esc(r.decidedBy)}</div>` : ''}</td>
      <td class="num">${S.user.approve && r.status === 'Pending' ? `<button class="btn sm primary" data-ok="${r.id}">Approve</button> <button class="btn sm danger" data-no="${r.id}">Reject</button>` : ''}</td></tr>`;
    const table = (list, empty) => list.length ? `<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Requested by</th><th>Entry</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : `<div class="empty">${empty}</div>`;
    shell('Edit Requests', S.user.approve ? 'Approve to open that entry for 30 minutes, only for the person who asked' : 'Your requests to change saved entries', exportBtn(), `
      ${S.user.approve ? `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h2>Waiting for you</h2><small>${pend.length}</small></div>${table(pend, 'No pending requests.')}</div>` : ''}
      <div class="panel"><div class="panel-h"><h2>${S.user.approve ? 'History' : 'My requests'}</h2></div>${table(S.user.approve ? requests.filter((r) => r.status !== 'Pending') : requests, 'No requests yet. Open a saved entry and use "Request edit".')}</div>`);
    const decide = async (id, status) => {
      try { await api('POST', `/api/requests/${id}`, { status }); toast(status === 'Approved' ? 'Approved: entry open for 30 minutes' : 'Request rejected'); pageApprovals(); }
      catch (e) { toast(e.message, true); }
    };
    document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => decide(Number(b.dataset.ok), 'Approved'));
    wireExport(() => ({ title: 'Edit Requests', subtitle: `${requests.length} requests`, sections: [{ heading: 'Edit requests',
      columns: ['When', 'Requested by', 'Sheet', 'Row', 'Entry', 'Reason', 'Status', 'Decided by'].map((l) => ({ label: l })),
      rows: requests.map((r) => [serialToText(r.at), r.by, r.sheet, r.row, r.entry, r.reason, r.status, r.decidedBy]) }] }));
    document.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => decide(Number(b.dataset.no), 'Rejected'));
  }

  // ---------- users ----------
  // ---------- users & roles ----------
  const LEVEL_TEXT = { none: 'No access', view: 'View', add: 'Add', edit: 'Edit' };
  const LEVEL_HELP = { none: 'Section is hidden', view: 'Can only look', add: 'New entries, fill empty fields, ask to change saved ones', edit: 'Can also change saved entries (logged)' };
  const ago = (iso) => {
    if (!iso) return 'Never';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'Just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    return fdate(new Date(iso).toISOString().slice(0, 10));
  };

  async function pageAccess() {
    if (!S.user.manageUsers) return route404();
    loading('Users & Roles');
    const A = await api('GET', '/api/access');
    S.accessTab = S.accessTab || 'users';
    const tab = S.accessTab;
    const roleName = (id) => A.roles.find((r) => r.id === id)?.name || '—';
    const summary = (r) => {
      const parts = A.modules.filter((m) => r.perms[m.key] && r.perms[m.key] !== 'none');
      if (r.system) return 'Full access to everything';
      if (!parts.length) return 'No access';
      const edit = parts.filter((m) => r.perms[m.key] === 'edit').length, add = parts.filter((m) => r.perms[m.key] === 'add').length;
      return `${parts.length} of ${A.modules.length} sections${add ? ` · adds in ${add}` : ''}${edit ? ` · edits in ${edit}` : ''}`;
    };
    const usersHtml = `
      <div class="panel"><div class="tbl-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>
        ${A.users.map((u) => `<tr class="click" data-u="${esc(u.id)}">
          <td><div class="person"><span class="avatar sm">${esc(initials(u.name))}</span><span class="strong">${esc(u.name)}</span>${u.id === S.user.id ? '<span class="you">You</span>' : ''}</div></td>
          <td class="muted">${esc(u.username)}</td><td>${esc(u.role)}</td>
          <td>${u.active ? (u.mustChange ? '<span class="pill amber">Must set password</span>' : '<span class="pill green">Active</span>') : '<span class="pill grey">Turned off</span>'}</td>
          <td class="muted">${esc(ago(u.lastLogin))}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    const rolesHtml = `
      <div class="role-list">${A.roles.map((r) => `
        <button class="role-card" data-r="${esc(r.id)}">
          <div class="role-top"><b>${esc(r.name)}</b>${r.system ? `<span class="pill navy">${ic('lock')}Fixed</span>` : ''}</div>
          <div class="muted">${esc(summary(r))}</div>
          <div class="role-meta">${ic('users')}${r.users} ${r.users === 1 ? 'user' : 'users'}${r.approve ? ` <span class="dot"></span> Approves edits` : ''}${r.manageUsers ? ` <span class="dot"></span> Manages users` : ''}</div>
        </button>`).join('')}</div>`;
    shell('Users & Roles', 'Who can sign in, and what each role can see and do',
      exportBtn() + (tab === 'users' ? `<button class="btn primary" id="add">${ic('userPlus')}<span class="new-label">Add user</span></button>`
        : (S.user.isAdmin ? `<button class="btn primary" id="addr">${ic('plus')}<span class="new-label">New role</span></button>` : '')), `
      <div class="seg" role="group" aria-label="Show"><button class="${tab === 'users' ? 'on' : ''}" aria-pressed="${tab === 'users'}" data-tab="users">Users <span>${A.users.length}</span></button><button class="${tab === 'roles' ? 'on' : ''}" aria-pressed="${tab === 'roles'}" data-tab="roles">Roles <span>${A.roles.length}</span></button></div>
      ${tab === 'users' ? usersHtml : rolesHtml}`);
    document.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { S.accessTab = b.dataset.tab; pageAccess(); });
    wireExport(() => ({ title: 'Users and Roles', subtitle: `${A.users.length} users · ${A.roles.length} roles`, sections: [
      { heading: 'Users', columns: ['Name', 'Username', 'Role', 'Status', 'Last sign-in', 'Created by'].map((l) => ({ label: l })),
        rows: A.users.map((u) => [u.name, u.username, u.role, u.active ? (u.mustChange ? 'Must set password' : 'Active') : 'Turned off', ago(u.lastLogin), u.createdBy === 'setup' ? 'First setup' : u.createdBy]) },
      { heading: 'Roles', columns: [{ label: 'Role' }, ...A.modules.map((m) => ({ label: m.label })), { label: 'Approves edits' }, { label: 'Manages users' }],
        rows: A.roles.map((r) => [r.name, ...A.modules.map((m) => LEVEL_TEXT[r.perms[m.key] || 'none']), r.approve ? 'Yes' : 'No', r.manageUsers ? 'Yes' : 'No']) },
    ] }));

    const privileged = (roleId) => { const r = A.roles.find((x) => x.id === roleId); return !!r && (r.system || r.manageUsers); };
    const editUser = (u) => {
      const isMe = u && u.id === S.user.id;
      if (u && !isMe && !S.user.isAdmin && privileged(u.roleId)) return toast('Only an Admin can change Admins or people who manage users.', true);
      const roleChoices = A.roles.filter((r) => S.user.isAdmin || !privileged(r.id));
      const d = drawer(`
        <div class="drawer-h"><div><h3>${u ? esc(u.name) : 'Add user'}</h3><small>${u ? '@' + esc(u.username) : 'They sign in with this username and password'}</small></div><div class="grow"></div><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
        <form class="drawer-b" id="uf" novalidate autocomplete="off">
          <div class="fgroup"><h4>Person</h4><div class="fgrid">
            <div class="field"><label>Full name <span class="req">*</span></label><input name="name" value="${esc(u?.name || '')}" maxlength="60"></div>
            <div class="field"><label>Username <span class="req">*</span></label>${u ? `<div class="ro">${esc(u.username)}</div>` : '<input name="username" autocapitalize="none" spellcheck="false" placeholder="e.g. ravi" maxlength="30">'}</div>
            <div class="field"><label>Role <span class="req">*</span></label>${isMe ? `<div class="ro">${esc(u.role)}</div>` : `<select name="roleId">${roleChoices.map((r) => `<option value="${esc(r.id)}" ${(u ? u.roleId === r.id : r.id === 'sales') ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`}</div>
            <div class="field"><label>Account</label>${isMe ? '<div class="ro">Active</div>' : `<select name="active"><option value="yes" ${u?.active !== false ? 'selected' : ''}>Active: can sign in</option><option value="no" ${u?.active === false ? 'selected' : ''}>Turned off: cannot sign in</option></select>`}</div>
          </div></div>
          <div class="fgroup"><h4>${u ? 'Reset password' : 'Password'}</h4>
            <div class="field">${pwFieldInline(u ? 'Leave empty to keep the current password' : 'At least 6 characters')}</div>
            <p class="hint">${u ? 'After a reset they must choose their own password at the next sign-in.' : 'Give this password to the person. They choose their own at the first sign-in.'}</p>
          </div>
          ${u ? `<p class="hint">Created ${esc(ago(u.createdAt))}${u.createdBy && u.createdBy !== 'setup' ? ' by ' + esc(u.createdBy) : ''} · last sign-in ${esc(ago(u.lastLogin).toLowerCase())}</p>` : ''}
        </form>
        <div class="drawer-f"><div class="grow"></div><button class="btn" data-close>Cancel</button><button class="btn primary" id="us">${ic('check')}${u ? 'Save changes' : 'Create user'}</button></div>`);
      wirePw();
      d.querySelector('#us').onclick = async () => {
        const fd = Object.fromEntries(new FormData(d.querySelector('#uf')));
        const body = { name: fd.name, roleId: fd.roleId, active: fd.active ? fd.active !== 'no' : undefined };
        if (fd.password) body.password = fd.password;
        try {
          if (u) await api('PUT', `/api/access/users/${u.id}`, body);
          else await api('POST', '/api/access/users', { ...body, username: fd.username, password: fd.password });
          toast(u ? 'User saved' : `User ${fd.username} created`); closeDrawer(); pageAccess();
        } catch (e) { toast(e.message, true); }
      };
    };

    const editRole = (r) => {
      const fixed = r?.system;
      const perms = { ...(r?.perms || {}) };
      const d = drawer(`
        <div class="drawer-h"><div><h3>${r ? esc(r.name) : 'New role'}</h3><small>${fixed ? 'The Admin role always has full access' : 'Choose what this role can do in each section'}</small></div><div class="grow"></div><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
        <form class="drawer-b" id="rf" novalidate>
          <div class="fgroup"><div class="field"><label>Role name <span class="req">*</span></label>${fixed ? `<div class="ro">${esc(r.name)}</div>` : `<input name="name" value="${esc(r?.name || '')}" maxlength="40" placeholder="e.g. Sales Executive">`}</div></div>
          <div class="fgroup"><h4>Access by section</h4>
            <div class="perm-grid">
              <div class="perm-head"><span></span>${A.levels.map((l) => `<span title="${esc(LEVEL_HELP[l])}">${LEVEL_TEXT[l]}</span>`).join('')}</div>
              ${A.modules.map((m) => {
                const allowed = m.levels || A.levels;
                const cur = perms[m.key] || 'none';
                return `<div class="perm-row"><span class="pm">${ic(m.key === 'dashboard' ? 'dash' : m.key)}${esc(m.label)}</span>${A.levels.map((l) => allowed.includes(l)
                  ? `<label class="radio"><input type="radio" name="p_${m.key}" value="${l}" ${cur === l ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span></span></label>`
                  : '<span class="na">–</span>').join('')}</div>`;
              }).join('')}
            </div>
            <div class="perm-legend">${A.levels.map((l) => `<div><b>${LEVEL_TEXT[l]}</b> ${esc(LEVEL_HELP[l])}</div>`).join('')}</div>
          </div>
          <div class="fgroup"><h4>Control</h4>
            <label class="check"><input type="checkbox" name="approve" ${r?.approve ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span><b>Approve edit requests</b><small>Can open a saved entry for 30 minutes for the person who asked</small></span></label>
            <label class="check"><input type="checkbox" name="manageUsers" ${r?.manageUsers ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span><b>Manage users and roles</b><small>Can add people, reset passwords and change roles</small></span></label>
          </div>
        </form>
        <div class="drawer-f">${r && !fixed ? `<button class="btn danger" id="rd">${ic('trash')}Delete role</button>` : ''}<div class="grow"></div><button class="btn" data-close>${fixed ? 'Close' : 'Cancel'}</button>${fixed ? '' : `<button class="btn primary" id="rs">${ic('check')}${r ? 'Save role' : 'Create role'}</button>`}</div>`);
      const save = d.querySelector('#rs');
      if (save) save.onclick = async () => {
        const f = d.querySelector('#rf');
        const body = { id: r?.id, name: f.name.value, approve: f.approve.checked, manageUsers: f.manageUsers.checked, perms: {} };
        A.modules.forEach((m) => { body.perms[m.key] = (f.querySelector(`input[name="p_${m.key}"]:checked`) || {}).value || 'none'; });
        try { await api('POST', '/api/access/roles', body); toast(r ? 'Role saved' : 'Role created'); closeDrawer(); pageAccess(); }
        catch (e) { toast(e.message, true); }
      };
      const del = d.querySelector('#rd');
      if (del) del.onclick = async () => {
        if (!window.confirm(`Delete the role "${r.name}"?`)) return;
        try { await api('DELETE', `/api/access/roles/${r.id}`); toast('Role deleted'); closeDrawer(); pageAccess(); }
        catch (e) { toast(e.message, true); }
      };
    };

    const add = document.getElementById('add'); if (add) add.onclick = () => editUser(null);
    const addr = document.getElementById('addr'); if (addr) addr.onclick = () => editRole(null);
    document.querySelectorAll('[data-u]').forEach((tr) => tr.onclick = () => editUser(A.users.find((x) => x.id === tr.dataset.u)));
    document.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => S.user.isAdmin ? editRole(A.roles.find((x) => x.id === b.dataset.r)) : toast('Only an Admin can change roles.', true));
  }
  const pwFieldInline = (ph) => `<div class="pw"><input name="password" type="password" autocomplete="new-password" placeholder="${esc(ph)}"><button type="button" class="icon-btn pw-eye" aria-label="Show password">${ic('eye')}</button></div>`;

  // ---------- masters: dropdown lists ----------
  const ONE = { models: 'model', variants: 'variant', colours: 'colour', accounts: 'account', financiers: 'financier', expenseCats: 'category', serviceTypes: 'service type', bankTypes: 'entry type' };
  async function pageMasters() {
    loading('Masters');
    const M = await api('GET', '/api/masters');
    const canEditM = canDo('masters', 'edit');
    if (!M.defs.some((d) => d.key === S.mTab)) S.mTab = 'models';
    const def = M.defs.find((d) => d.key === S.mTab);
    const saved = (M.lists[def.key] || []).map(String);
    const start = () => saved.map((v) => ({ value: v, was: v, opening: def.opening ? (M.opening[v] || 0) : null }));
    let items = start();
    const used = (v) => (M.used[def.key] || {})[v] || 0;
    const sig = (arr) => JSON.stringify(arr.map((i) => [i.value.trim(), i.was, def.opening ? Number(i.opening) || 0 : 0]));
    const dirty = () => sig(items) !== sig(start());
    const ro = !canEditM || def.locked;
    const fixed = new Set(def.locked ? saved : (def.fixed || []));
    const fmtOp = (v) => (v === '' || v === null || v === undefined || !isFinite(Number(v)) ? (v ?? '') : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

    shell('Masters', 'The dropdown lists used across the app and the Google Sheet', exportBtn(), `
      <div class="masters">
        <nav class="m-lists" aria-label="Lists">${M.defs.map((d) => `<button class="${d.key === def.key ? 'on' : ''}" data-list="${d.key}">
          <span>${esc(d.label)}</span><span class="n">${(M.lists[d.key] || []).length}</span></button>`).join('')}</nav>
        <div class="panel m-edit${def.opening ? ' has-op' : ''}" id="medit"></div>
      </div>`);
    const box = document.getElementById('medit');

    function notes() {
      const out = [];
      const ren = items.filter((i) => i.was && i.value.trim() && i.value.trim() !== i.was && used(i.was));
      const moved = ren.reduce((n, i) => n + used(i.was), 0);
      if (moved) out.push(`<div class="notice info">${ic('info')}<div>Renaming also changes ${moved} saved ${moved === 1 ? 'entry' : 'entries'} in the sheet, so old entries match the new name.</div></div>`);
      const gone = saved.filter((v) => !items.some((i) => i.was === v) && used(v));
      if (gone.length && def.opening) out.push(`<div class="notice warn">${ic('alert')}<div><b>${esc(gone[0])}</b> has ${used(gone[0])} saved entries, so it can't be removed. Undo, then rename it instead.</div></div>`);
      else if (gone.length) out.push(`<div class="notice info">${ic('info')}<div>${gone.map(esc).join(', ')} will leave the dropdown. Saved entries that use ${gone.length === 1 ? 'it' : 'them'} keep the name.</div></div>`);
      return { html: out.join(''), blocked: !!(gone.length && def.opening) };
    }
    function syncButtons() {
      const n = notes(), d = dirty();
      const s = box.querySelector('#msave'), u = box.querySelector('#mundo');
      if (s) s.disabled = !d || n.blocked;
      if (u) u.disabled = !d;
      const nb = box.querySelector('.m-notes'); if (nb) nb.innerHTML = n.html;
    }
    function draw(focusLast) {
      const n = notes();
      box.innerHTML = `
        <div class="panel-h"><h2>${esc(def.label)}</h2><small>${items.length}${!def.locked ? ` of ${def.max}` : ''}</small></div>
        <p class="m-hint">${esc(def.hint)}${!ro && def.fixed ? ` Items with ${ic('lock')} are used by the sheet's formulas and can't be renamed or removed.` : ''}</p>
        <div class="m-head"><span></span><span>Name</span>${def.opening ? '<span class="r">Opening balance (₹)</span>' : ''}<span>Used in</span><span></span></div>
        <ol class="m-rows">${items.map((it, i) => {
          const lock = fixed.has(it.was);
          return `<li data-i="${i}">
            <span class="m-num">${i + 1}</span>
            <input class="m-val" value="${esc(it.value)}" ${ro || lock ? 'readonly' : ''} maxlength="60" aria-label="${esc(ONE[def.key] || 'item')} ${i + 1}" placeholder="New ${esc(ONE[def.key] || 'item')}">
            ${def.opening ? `<input class="m-op" inputmode="decimal" value="${esc(fmtOp(it.opening))}" ${ro ? 'readonly' : ''} aria-label="Opening balance of ${esc(it.value || 'new account')}">` : ''}
            <span class="m-used">${!it.was ? '<span class="pill teal">New</span>' : used(it.was) ? `${used(it.was)} ${used(it.was) === 1 ? 'entry' : 'entries'}` : '<span class="muted">Not used</span>'}</span>
            <span class="m-act">${ro ? (lock && !def.locked ? `<span class="m-lock" title="Used by the sheet's formulas">${ic('lock')}</span>` : '') : `
              ${lock ? `<span class="m-lock" title="Used by the sheet's formulas">${ic('lock')}</span>` : ''}
              <button class="icon-btn" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ic('up')}</button>
              <button class="icon-btn" data-mv="1" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">${ic('down')}</button>
              <button class="icon-btn m-del" data-del ${lock ? 'disabled' : ''} aria-label="Remove">${ic('trash')}</button>`}</span>
          </li>`; }).join('')}</ol>
        ${def.locked ? `<div class="m-foot"><div class="notice info" style="margin:0">${ic('lock')}<div>These values are fixed: the sheet's rules check for them by name.</div></div></div>` : ''}
        ${ro ? '' : `<div class="m-foot"><button class="btn" id="madd" ${items.length >= def.max ? 'disabled' : ''}>${ic('plus')}Add ${esc(ONE[def.key] || 'item')}</button></div>`}
        <div class="m-notes">${n.html}</div>
        ${ro ? '' : `<div class="m-save"><button class="btn primary" id="msave" disabled>Save changes</button><button class="btn" id="mundo" disabled>${ic('undo')}Undo changes</button></div>`}`;
      syncButtons();
      box.querySelectorAll('.m-rows li').forEach((li) => {
        const i = +li.dataset.i;
        const v = li.querySelector('.m-val'), o = li.querySelector('.m-op');
        v.oninput = () => { items[i].value = v.value; syncButtons(); };
        if (o) { o.oninput = () => { items[i].opening = o.value.replace(/[₹,\s]/g, ''); syncButtons(); }; o.onblur = () => { o.value = fmtOp(items[i].opening); }; }
        li.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
          const j = i + Number(b.dataset.mv); [items[i], items[j]] = [items[j], items[i]]; draw();
          box.querySelector(`li[data-i="${j}"] [data-mv="${b.dataset.mv}"]`)?.focus();
        });
        const del = li.querySelector('[data-del]');
        if (del) del.onclick = () => { items.splice(i, 1); draw(); };
      });
      const add = box.querySelector('#madd');
      if (add) add.onclick = () => { items.push({ value: '', was: null, opening: def.opening ? 0 : null }); draw(true); };
      if (focusLast) box.querySelector('.m-rows li:last-child .m-val')?.focus();
      const undo = box.querySelector('#mundo');
      if (undo) undo.onclick = () => { items = start(); draw(); };
      const save = box.querySelector('#msave');
      if (save) save.onclick = async () => {
        save.disabled = true;
        try {
          const r = await api('PUT', `/api/masters/${def.key}`, { items: items.map((i) => ({ value: i.value, was: i.was, opening: i.opening })) });
          S.lists = r.lists;
          toast(`${def.label} saved${r.entriesUpdated ? `: ${r.entriesUpdated} saved ${r.entriesUpdated === 1 ? 'entry' : 'entries'} updated too` : ''}`);
          pageMasters();
        } catch (e) { toast(e.message, true); syncButtons(); }
      };
    }
    draw();

    document.querySelectorAll('[data-list]').forEach((b) => b.onclick = () => {
      if (b.dataset.list === def.key) return;
      if (dirty() && !confirm(`Discard your unsaved changes to ${def.label}?`)) return;
      S.mTab = b.dataset.list; pageMasters();
    });
    wireExport(() => ({ title: 'Masters', subtitle: 'Dropdown lists', sections: M.defs.map((d) => ({
      heading: d.label,
      columns: [{ label: 'Name' }, ...(d.opening ? [{ label: 'Opening balance', type: 'money' }] : []), { label: 'Used in entries', type: 'num' }],
      rows: (M.lists[d.key] || []).map((v) => [String(v), ...(d.opening ? [M.opening[v] || 0] : []), (M.used[d.key] || {})[v] || 0]),
      totals: d.opening ? ['Total', (M.lists[d.key] || []).reduce((s, v) => s + (M.opening[v] || 0), 0), ''] : null,
    })) }));
  }

  function route404() {
    const p = firstPage();
    if (p && p !== location.hash) { location.hash = p; return; }
    shell('No access', '', '', `<div class="panel"><div class="empty">Your role has no sections yet. Ask the Admin to give your role access.</div></div>`);
  }
  // ---------- router & boot ----------
  async function route() {
    closeDrawer();
    const h = location.hash || firstPage() || '#/dashboard';
    if (h === '#/s/payments') { location.hash = '#/s/sales'; return; }  // payments live in the sale form
    const key = h.startsWith('#/s/') ? h.slice(4) : h === '#/ledger' || h === '#/daybook' ? 'ledger' : h === '#/access' ? '@users' : h === '#/approvals' ? '@approvals' : h === '#/masters' ? 'masters' : 'dashboard';
    if (!navAllowed(key)) return route404();
    try {
      if (h.startsWith('#/s/')) await pageSheet(h.slice(4));
      else if (h === '#/ledger') await pageLedger();
      else if (h === '#/daybook') await pageDaybook();
      else if (h === '#/approvals') await pageApprovals();
      else if (h === '#/access') await pageAccess();
      else if (h === '#/masters') await pageMasters();
      else await pageDashboard();
    } catch (e) {
      if (e.status === 401) { S.user = null; return renderLogin(); }
      if (e.mustChange) return renderNewPassword();
      if (S.user) shell('Error', '', '', `<div class="panel"><div class="empty">${esc(e.message)}<br><br><button class="btn" id="retry">Try again</button></div></div>`);
      const rb = document.getElementById('retry'); if (rb) rb.onclick = () => location.reload();
    }
  }

  async function refreshCore() {
    const b = await api('GET', '/api/bootstrap');
    Object.assign(S, { user: b.user, schema: b.schema, lists: b.lists, engines: b.engines, sold: b.sold || [], demo: b.demo, showroom: b.showroom });
    if (S.user.approve) {
      api('GET', '/api/requests').then((r) => { S.pendingCount = r.requests.filter((x) => x.status === 'Pending').length; const n = document.querySelector('a[href="#/approvals"]'); if (n && S.pendingCount && !n.querySelector('.badge')) n.insertAdjacentHTML('beforeend', `<span class="badge">${S.pendingCount}</span>`); }).catch(() => {});
    }
  }

  async function boot() {
    try {
      await refreshCore();
    } catch (e) {
      if (e.mustChange) return renderNewPassword();
      return renderLogin(e.status === 401 ? '' : e.message);
    }
    window.onhashchange = route;
    route();
  }

  boot();
})();
