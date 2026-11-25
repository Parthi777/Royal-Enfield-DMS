/* RE Showroom web app: single-page UI, no build step. */
(() => {
  'use strict';
  const $app = document.getElementById('app');
  const S = { user: null, schema: {}, lists: {}, engines: [], demo: false, showroom: '', pendingCount: 0, data: {}, filter: {}, q: {} };

  // ---------- helpers ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
  const inr = (v, dash = true) => (v === '' || v === null || v === undefined) ? '' : (num(v) === 0 && dash ? '–' : (num(v) < 0 ? '-₹' : '₹') + Math.abs(Math.round(num(v))).toLocaleString('en-IN'));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fdate = (s) => { if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s ?? ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
  const fmonth = (s) => { if (!s) return ''; const [y, m] = s.split('-'); return `${MON[+m - 1]} ${y}`; };
  const todayIso = () => { const d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000); return d.toISOString().slice(0, 10); };
  const isWriter = () => ['Admin', 'Manager', 'Staff'].includes(S.user?.role);
  const isAdmin = () => S.user?.role === 'Admin';
  const initials = (n) => String(n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

  const ICON = {
    dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 7.5M5.5 17.5 9 10h6l3.5 7.5M9 10 7.5 6H5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1.2"/>',
    bank: '<path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10 12 3l10 7z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`;

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
    if (!res.ok) { const e = new Error(out.error || 'Request failed'); e.status = res.status; throw e; }
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

  // ---------- login ----------
  async function renderLogin(error) {
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
    $app.innerHTML = `
      <div class="login"><div class="login-card">
        <div class="brand-mark">RE</div>
        <h1>${esc(cfg.showroom || 'Royal Enfield Showroom')}</h1>
        <p>Sign in with your Google account</p>
        ${cfg.demo ? `
          <div class="notice warn" style="text-align:left">${ic('info')}<div><b>Demo mode.</b> Sample data, not your Google Sheet. Pick a role to look around.</div></div>
          <div class="demo-roles">${['Admin', 'Manager', 'Staff', 'Viewer'].map((r) => `<button class="btn ${r === 'Admin' ? 'navy' : ''}" data-demo="${r}">${r}</button>`).join('')}</div>`
        : cfg.clientId ? `<div class="gbtn" id="gbtn"><div class="spinner"></div></div>`
        : `<div class="err">Google sign-in is not set up yet: add GOOGLE_CLIENT_ID in Railway (see README).</div>`}
        ${error ? `<div class="err">${esc(error)}</div>` : ''}
        <div class="login-foot">Only people added by the Admin in the Users list can sign in.</div>
      </div></div>`;
    $app.querySelectorAll('[data-demo]').forEach((b) => b.onclick = async () => {
      try { await api('POST', '/api/auth/demo', { role: b.dataset.demo }); boot(); } catch (e) { renderLogin(e.message); }
    });
    if (!cfg.demo && cfg.clientId) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = () => {
        google.accounts.id.initialize({
          client_id: cfg.clientId, ux_mode: 'popup',
          callback: async (r) => {
            try { await api('POST', '/api/auth/google', { credential: r.credential }); boot(); }
            catch (e) { renderLogin(e.message); }
          },
        });
        const el = document.getElementById('gbtn');
        el.innerHTML = '';
        google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
      };
      document.head.appendChild(s);
    }
  }

  // ---------- shell ----------
  const NAV = [
    ['Overview', [['#/dashboard', 'Dashboard', 'dash']]],
    ['Showroom', [['#/s/stock', 'Vehicle Stock', 'bike'], ['#/s/bookings', 'Bookings', 'calendar'], ['#/s/sales', 'Vehicle Sales', 'receipt'], ['#/s/service', 'Service', 'wrench']]],
    ['Accounts', [['#/s/expenses', 'Expenses', 'wallet'], ['#/s/bank', 'Bank Entries', 'bank'], ['#/ledger', 'Bank Ledger', 'book']]],
    ['Control', [['#/approvals', 'Edit Requests', 'shield'], ['#/users', 'Users', 'users', true]]],
  ];

  function shell(title, sub, actions, body) {
    const route = location.hash || '#/dashboard';
    $app.innerHTML = `
      <div class="shell">
        <aside class="side" id="side">
          <div class="side-brand"><div class="brand-mark">RE</div><div><b>${esc(S.showroom)}</b><small>Showroom manager</small></div></div>
          <nav class="nav">${NAV.map(([sec, items]) => `<div class="sec">${sec}</div>` + items.filter((i) => !i[3] || isAdmin()).map(([href, label, icon]) =>
            `<a href="${href}" class="${route.startsWith(href) ? 'on' : ''}">${ic(icon)}<span>${label}</span>${href === '#/approvals' && S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : ''}</a>`).join('')).join('')}</nav>
          <div class="side-user"><div class="avatar">${esc(initials(S.user.name))}</div>
            <div class="who"><b>${esc(S.user.name)}</b><small title="${esc(S.user.email)}">${esc(S.user.role)}</small></div>
            <button class="icon-btn" id="logout" title="Sign out">${ic('out')}</button></div>
        </aside>
        <div class="main">
          ${S.demo ? '<div class="demo-bar"><b>Demo mode:</b> sample data only. Changes are not saved to the Google Sheet and are lost on restart.</div>' : ''}
          <header class="top">
            <button class="icon-btn menu-btn" id="menu">${ic('menu')}</button>
            <div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
            <div class="grow"></div>${actions || ''}
          </header>
          <main class="content" id="content">${body}</main>
        </div>
      </div>`;
    document.getElementById('logout').onclick = async () => { await api('POST', '/api/auth/logout'); S.user = null; renderLogin(); };
    const side = document.getElementById('side');
    document.getElementById('menu').onclick = (e) => { e.stopPropagation(); side.classList.toggle('open'); };
    document.querySelector('.main').addEventListener('click', () => side.classList.remove('open'));
  }

  function loading(title) { shell(title, '', '', '<div class="boot" style="height:50vh"><div class="spinner"></div></div>'); }

  // ---------- dashboard ----------
  async function pageDashboard() {
    loading('Dashboard');
    const d = await api('GET', '/api/dashboard');
    const T = Object.fromEntries(d.today.map((x) => [x.label, num(x.value)]));
    const M = Object.fromEntries(d.month.map((x) => [x.label, num(x.value)]));
    const rd = new Date(d.reportDate + 'T00:00:00');
    const longDate = rd.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const monthName = rd.toLocaleDateString('en-IN', { month: 'long' });
    const bar = (v, max, cls = '') => `<div class="bar ${cls}"><i style="width:${max > 0 ? Math.max(2, Math.min(100, (v / max) * 100)) : 0}%"></i></div>`;
    const stat = (label, value, sub = '', money = false) => {
      const z = num(value) === 0;
      return `<div class="st"><div class="l">${esc(label)}</div><div class="v ${z ? 'zero' : ''}">${money ? (z ? '₹0' : inr(value)) : num(value)}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
    };

    // stock comes from the live engine list (Available + Allotted = in the showroom)
    const inStock = S.engines.filter((e) => e.status === 'Available' || e.status === 'Allotted');
    const allotted = inStock.filter((e) => e.status === 'Allotted');
    const stockValue = inStock.reduce((s, e) => s + num(e.value), 0);

    const open = num(T['OPENING BALANCE']), close = num(T['CLOSING BALANCE']);
    const change = close - open;
    const ddPending = d.balances.reduce((s, b) => s + b.dd, 0);
    const owes = d.balances.filter((b) => b.owes > 0);
    const dds = d.balances.filter((b) => b.dd > 0);

    // last 6 months up to the report month
    const ym = d.reportDate.slice(0, 7);
    const months = d.monthly.filter((m) => m.month.slice(0, 7) <= ym).slice(-6);
    const maxSold = Math.max(0, ...months.map((m) => m.sold));
    const models = d.models.filter((m) => m.available + m.allotted + m.waiting > 0);
    const maxModel = Math.max(0, ...models.map((m) => Math.max(m.available + m.allotted, m.waiting)));
    const maxExp = Math.max(0, ...d.expenses.map((e) => e.paid));
    const old = d.ageing.slice(2).reduce((s, a) => s + a.bikes, 0);

    shell('Dashboard', esc(longDate), `<button class="btn" id="refresh">${ic('refresh')}Refresh</button>`, `
      <section class="hero">
        <div>
          <div class="lbl">Cash and bank balance</div>
          <div class="big">${inr(close, false)}</div>
          <div class="chg">${change === 0 ? 'No change today' : `<b class="${change < 0 ? 'neg' : ''}">${change > 0 ? '+' : '−'}${inr(Math.abs(change), false)}</b> today`}</div>
        </div>
        <div class="accts">${d.bank.map((b) => `<div class="acct"><span>${esc(b.account)}</span><b>${inr(b.closing, false)}</b></div>`).join('')}</div>
      </section>

      <div class="section-h"><h3>Today</h3></div>
      <div class="panel strip" style="--n:6">
        ${stat('Bikes sold', T['SALES TODAY'], `HP ${num(T['HP SALES'])} · Cash ${num(T['CASH SALES'])}`)}
        ${stat('Sales value', T['SALES VALUE (ON-ROAD)'], 'on-road price', true)}
        ${stat('New bookings', T['BOOKINGS TODAY'])}
        ${stat('Service billed', T['SERVICE AMOUNT'], '', true)}
        ${stat('Cash deposited', T['BANK DEPOSIT'], 'into bank', true)}
        ${stat('Bank transfers', T['BANK TRANSFER'], 'between accounts', true)}
      </div>

      <div class="section-h"><h3>${esc(monthName)}</h3><span>month to date</span></div>
      <div class="panel strip" style="--n:6">
        ${stat('Bikes sold', M['VEHICLES SOLD · MONTH'])}
        ${stat('Collections', M['CUSTOMER COLLECTIONS · MONTH'], 'from customers', true)}
        ${stat('Finance DD received', M['DD RECEIVED · MONTH'], '', true)}
        ${stat('Service revenue', M['SERVICE REVENUE · MONTH'], '', true)}
        ${stat('Expenses paid', M['EXPENSES PAID · MONTH'], '', true)}
        ${stat('Open bookings', M['OPEN BOOKINGS'], d.overdue.length ? `<span class="bad">${d.overdue.length} overdue</span>` : 'none overdue')}
      </div>

      <div class="cols">
        <div class="stack">
          <div class="panel"><div class="panel-h"><h3>Follow up</h3><div class="grow"></div><small>${d.overdue.length + owes.length + dds.length || 'nothing'} pending</small></div><div class="panel-b">
            <div class="group-l">Overdue bookings: call the customer</div>
            ${d.overdue.length ? `<ul class="rows">${d.overdue.map((o) => `<li><div class="who"><b>${esc(o.customer)}</b><small>${esc(o.model)} · ${esc(o.mobile)}</small></div><div class="amt"><span class="pill red">${o.late} ${o.late === 1 ? 'day' : 'days'} late</span><small>promised ${fdate(o.commitment)}</small></div></li>`).join('')}</ul>` : '<div class="empty-line">No overdue bookings.</div>'}
            <div class="group-l">Customer balance due · ${inr(M['CUSTOMER BALANCE DUE'], false)}</div>
            ${owes.length ? `<ul class="rows">${owes.map((b) => `<li><div class="who"><b>${esc(b.customer)}</b><small>${esc(b.model)} · ${esc(b.mobile)}</small></div><div class="amt"><b class="out">${inr(b.owes, false)}</b><small>sold ${fdate(b.date)}</small></div></li>`).join('')}</ul>` : '<div class="empty-line">Every customer has paid in full.</div>'}
            <div class="group-l">Finance DD pending · ${inr(ddPending, false)}</div>
            ${dds.length ? `<ul class="rows">${dds.map((b) => `<li><div class="who"><b>${esc(b.customer)}</b><small>${esc(b.model)} · ${esc(b.mobile)}</small></div><div class="amt"><b class="nowrap" style="color:var(--amber-d)">${inr(b.dd, false)}</b><small>sold ${fdate(b.date)}</small></div></li>`).join('')}</ul>` : '<div class="empty-line">No DD pending.</div>'}
          </div></div>

          <div class="panel"><div class="panel-h"><h3>Bikes sold</h3><small>last 6 months</small></div><div class="panel-b">
            <ul class="rows">${months.map((m) => `<li><div style="width:72px" class="${m.sold ? '' : 'muted'}">${fmonth(m.month)}</div><div class="barline">${m.sold ? bar(m.sold, maxSold) : ''}</div><div class="amt" style="width:64px">${m.sold ? `<b>${m.sold}</b>` : '<span class="muted">–</span>'}</div><div class="amt muted" style="width:104px">${m.collections ? inr(m.collections, false) : ''}</div></li>`).join('')}</ul>
            <div class="muted" style="font-size:12.5px;margin-top:6px">Right column: money collected from customers that month.</div>
          </div></div>
        </div>

        <div class="stack">
          <div class="panel"><div class="panel-h"><h3>Stock in showroom</h3><div class="grow"></div><a href="#/s/stock">Open stock</a></div>
            <div class="strip s3" style="--n:3;border-bottom:1px solid var(--line-2)">
              ${stat('Bikes', inStock.length, `${allotted.length} allotted to bookings`)}
              ${stat('Stock value', stockValue, 'purchase value', true)}
              ${stat('Over 60 days', old, old ? '<span class="warn">sell these first</span>' : 'none ageing')}
            </div>
            <div class="panel-b" style="padding-top:8px">
            ${models.length ? `<ul class="rows">${models.map((m) => `<li><div class="who"><b>${esc(m.model)}</b><small>${m.available + m.allotted} in stock${m.allotted ? `, ${m.allotted} allotted` : ''}${m.waiting ? ` · <span style="color:${m.waiting > m.available ? 'var(--red-d)' : 'var(--amber-d)'}">${m.waiting} waiting</span>` : ''}</small></div>
              <div class="barline" style="display:grid;gap:4px">${bar(m.available + m.allotted, maxModel)}${m.waiting ? bar(m.waiting, maxModel, m.waiting > m.available ? 'red' : 'amber') : ''}</div></li>`).join('')}</ul>
              <div class="muted" style="font-size:12.5px;margin-top:8px">Teal is stock, amber is customers waiting for a bike. Red means order more.</div>` : '<div class="empty-line">No bikes in stock and nobody waiting.</div>'}
          </div></div>

          <div class="panel"><div class="panel-h"><h3>Expenses</h3><small>${esc(monthName)}</small></div><div class="panel-b">
            ${d.expenses.length ? `<ul class="rows">${d.expenses.map((e) => `<li><div class="who"><b>${esc(e.category)}</b></div><div class="barline">${bar(e.paid, maxExp, 'navy')}</div><div class="amt" style="width:90px">${inr(e.paid, false)}</div></li>`).join('')}</ul>` : '<div class="empty-line">No expenses this month.</div>'}
          </div></div>

          <div class="panel"><div class="panel-h"><h3>Sales mix</h3><small>${esc(monthName)}</small></div><div class="panel-b">
            <ul class="rows">${d.mix.map((m) => `<li><div class="who"><b>${esc(m.mode === 'HP' ? 'Finance (HP)' : m.mode)}</b></div><div class="amt"><b>${m.count}</b> <span class="muted">${m.count === 1 ? 'bike' : 'bikes'}</span></div></li>`).join('')}
            ${d.financiers.map((f) => `<li><div class="who"><small>${esc(f.name)}</small></div><div class="amt"><small style="display:inline">${f.count} · DD ${inr(f.dd, false)}</small></div></li>`).join('')}</ul>
          </div></div>
        </div>
      </div>`);
    document.getElementById('refresh').onclick = () => pageDashboard();
  }

  // ---------- sheet list pages ----------
  const FILTERS = {
    stock: [['instock', 'In stock', (r) => r.H !== 'Sold'], ['avail', 'Available', (r) => r.H === 'Available'], ['allot', 'Allotted', (r) => r.H === 'Allotted'], ['sold', 'Sold', (r) => r.H === 'Sold'], ['all', 'All', () => true]],
    bookings: [['open', 'Open', (r) => r.M !== 'Delivered'], ['notallot', 'Not allotted', (r) => r.M !== 'Delivered' && r.K === 'Not Allotted'], ['allot', 'Allotted', (r) => r.M !== 'Delivered' && r.K === 'Vehicle Allotted'], ['overdue', 'Overdue', (r) => String(r.O).startsWith('OVERDUE')], ['delivered', 'Delivered', (r) => r.M === 'Delivered']],
    sales: [['all', 'All', () => true], ['owes', 'Customer owes', (r) => num(r.AI) >= 0.5], ['dd', 'DD pending', (r) => num(r.AH) >= 0.5], ['paid', 'Fully paid', (r) => r.AJ === 'FULLY PAID'], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)]],
    service: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)], ['today', 'Today', (r) => r.A === todayIso()]],
    expenses: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)], ['today', 'Today', (r) => r.A === todayIso()]],
    bank: [['all', 'All', () => true], ['month', 'This month', (r) => String(r.A).slice(0, 7) === todayIso().slice(0, 7)]],
  };
  const NEW_LABEL = { stock: 'Add bike', bookings: 'New booking', sales: 'New sale', service: 'New service bill', expenses: 'New expense', bank: 'New bank entry' };

  async function pageSheet(key) {
    const sh = S.schema[key];
    if (!sh) return pageDashboard();
    loading(sh.title);
    const res = await api('GET', `/api/sheets/${key}`);
    S.data[key] = res;
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
    const mobTitle = { stock: (r) => `${r.B} · ${r.E}`, bookings: (r) => r.B, sales: (r) => r.B, service: (r) => r.B, expenses: (r) => r.B, bank: (r) => r.C };
    const mobPill = { stock: 'H', bookings: 'K', sales: 'AJ', service: 'G', expenses: 'I', bank: 'H' };
    const mobMeta = {
      stock: (r) => [r.C, r.D, inr(r.G), r.I],
      bookings: (r) => [fdate(r.A), r.D, r.C, r.J || '', String(r.O).startsWith('OVERDUE') ? r.O : ''],
      sales: (r) => [fdate(r.A), r.E, r.I, 'Cost ' + inr(r.Q), num(r.AI) > 0.5 ? 'Owes ' + inr(r.AI) : ''],
      service: (r) => [fdate(r.A), r.C, r.D, inr(r.E)],
      expenses: (r) => [fdate(r.A), r.D, r.E, num(r.F) ? '+' + inr(r.F) : '-' + inr(r.G)],
      bank: (r) => [fdate(r.A), r.B, r.D, num(r.E) ? '+' + inr(r.E) : '-' + inr(r.F)],
    };
    const count = (fn) => res.rows.filter(fn).length;
    const body = `
      <div class="toolbar">
        <input class="search" id="q" placeholder="Search name, mobile, engine…" value="${esc(S.q[key] || '')}">
        <div class="chips">${fl.map(([k, label, fn]) => `<button class="chip ${k === f[0] ? 'on' : ''}" data-f="${k}">${label}<span class="n">${count(fn)}</span></button>`).join('')}</div>
      </div>
      <div class="panel desk-table">${rows.length ? `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.type === 'money' || c.money ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-row="${r._row}">${cols.map((c, i) => `<td class="${c.type === 'money' || c.money ? 'num' : c.type === 'date' ? 'date' : i === 1 ? 'wrap' : ''}">${i === 1 ? nameCell(c, r) : cellHtml(c, r[c.c])}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">Nothing here yet.${isWriter() ? ' Use the button above to add the first entry.' : ''}</div>`}</div>
      <div class="mob-cards">${rows.map((r) => `<div class="mcard" data-row="${r._row}"><div class="t"><b>${esc(mobTitle[key](r))}</b>${pill(r[mobPill[key]])}</div>
        <div class="m">${mobMeta[key](r).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}${flag(r)}</div></div>`).join('') || '<div class="empty">Nothing here yet.</div>'}</div>`;
    const sub = key === 'bookings' ? 'Sold bookings move to Delivered automatically' : `${res.rows.length} entries`;
    shell(sh.title, sub, isWriter() ? `<button class="btn primary" id="new">${ic('plus')}<span class="new-label">${NEW_LABEL[key]}</span></button>` : '', body);
    const q = document.getElementById('q');
    q.oninput = () => { S.q[key] = q.value; const pos = q.selectionStart; renderSheet(key); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); };
    document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { S.filter[key] = b.dataset.f; renderSheet(key); });
    document.querySelectorAll('[data-row]').forEach((tr) => tr.onclick = () => openRow(key, Number(tr.dataset.row)));
    const nb = document.getElementById('new');
    if (nb) nb.onclick = () => openForm(key, null);
  }

  // ---------- drawer: view / edit / new ----------
  function closeDrawer() { document.querySelectorAll('.scrim,.drawer').forEach((x) => x.remove()); }
  function drawer(html) {
    closeDrawer();
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.onclick = closeDrawer;
    const d = document.createElement('div'); d.className = 'drawer'; d.innerHTML = html;
    document.body.append(scrim, d);
    d.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeDrawer);
    return d;
  }

  async function openRow(key, row) {
    // always open with the latest values and approval state
    try { S.data[key] = await api('GET', `/api/sheets/${key}`); } catch (e) { if (e.status === 401) return renderLogin(); }
    const rec = S.data[key].rows.find((r) => r._row === row);
    if (rec) openForm(key, rec); else { toast('This entry was changed. Reloading…', true); renderSheet(key); }
  }

  function engineOptions(key, cur, form) {
    const list = S.engines.filter((e) => {
      if (e.engine === String(cur)) return true;
      if (key === 'bookings') return e.status === 'Available' && (!form.D || e.model === form.D);
      return e.status !== 'Sold';
    });
    return list.map((e) => ({ v: e.engine, t: `${e.engine} · ${e.model}${e.colour ? ' · ' + e.colour : ''}${e.status === 'Allotted' ? ' · allotted to ' + (e.to || '') : e.status === 'Sold' ? ' · sold' : ''}` }));
  }

  function openForm(key, rec) {
    const sh = S.schema[key];
    const isNew = !rec;
    const res = S.data[key] || { pending: [], approved: [] };
    const approved = !isNew && res.approved.find((a) => a.row === rec._row);
    const pending = !isNew && res.pending.includes(rec._row);
    const form = {};
    sh.cols.forEach((c) => (form[c.c] = isNew ? '' : rec[c.c]));
    if (isNew) sh.cols.forEach((c) => { if (c.type === 'date' && c.req) form[c.c] = todayIso(); });
    const canEdit = (c) => c.type !== 'auto' && isWriter() && (isNew || form[c.c] === '' || rec[c.c] === '' || isAdmin() || !!approved);
    const lockedAny = !isNew && sh.cols.some((c) => c.type !== 'auto' && rec[c.c] !== '' && !canEdit(c));
    const groups = sh.groups || [{ title: 'Details', cols: sh.cols.map((c) => c.c) }];

    const fieldHtml = (c) => {
      const v = form[c.c];
      const hp = c.hpOnly ? ` data-hp="1"` : '';
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
      if (c.type === 'list' || c.type === 'engine') {
        const opts = c.type === 'engine' ? engineOptions(key, v, form) : (S.lists[c.list] || []).map((x) => ({ v: x, t: x }));
        if (v !== '' && !opts.some((o) => String(o.v) === String(v))) opts.unshift({ v, t: String(v) });
        input = `<select name="${c.c}"><option value="">— select —</option>${opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
      } else if (c.type === 'date') {
        input = `<input type="date" name="${c.c}" value="${esc(v)}">`;
      } else if (c.type === 'money') {
        input = `<input type="number" inputmode="decimal" min="0" step="any" name="${c.c}" value="${esc(v)}" placeholder="₹">`;
      } else if (c.type === 'phone') {
        input = `<input type="tel" inputmode="numeric" maxlength="10" name="${c.c}" value="${esc(v)}" placeholder="10-digit mobile">`;
      } else {
        input = `<input type="text" name="${c.c}" value="${esc(v)}" maxlength="200">`;
      }
      return `<div class="field"${hp}><label>${esc(c.label)}${req}</label>${input}</div>`;
    };

    let notice = '';
    if (!isNew && approved) notice = `<div class="notice ok">${ic('unlock')}<div><b>Edit approved.</b> This entry is open for you for about ${approved.minutes} more minutes.</div></div>`;
    else if (!isNew && pending) notice = `<div class="notice warn">${ic('clock')}<div><b>Edit request sent.</b> Waiting for the Admin to approve it.</div></div>`;
    else if (!isNew && lockedAny && isWriter()) notice = `<div class="notice info">${ic('lock')}<div>Saved values are locked. You can fill empty fields. To change a saved value, send an edit request to the Admin.</div></div>`;
    else if (!isNew && isAdmin()) notice = `<div class="notice info">${ic('info')}<div>You are the Admin: changes to saved values are written to the Edit Log.</div></div>`;

    const title = isNew ? NEW_LABEL[key] : (key === 'stock' ? `${rec.B} · ${rec.E}` : key === 'bank' ? rec.C : rec.B);
    const d = drawer(`
      <div class="drawer-h"><div><h3>${esc(title)}</h3><small>${esc(sh.title)}${isNew ? '' : ' · sheet row ' + rec._row}</small></div><div class="grow"></div>
        <button class="icon-btn" data-close style="color:var(--navy)">${ic('x')}</button></div>
      <form class="drawer-b" id="f" autocomplete="off" novalidate>
        ${notice}
        ${key === 'sales' ? '<div class="fgroup"><h4>Tally</h4><div class="tally" id="tally"></div></div>' : ''}
        ${groups.map((g) => { const inner = g.cols.map((c) => fieldHtml(colOf(key, c))).join(''); return inner ? `<div class="fgroup"${g.hpOnly ? ' data-hp="1"' : ''}><h4>${esc(g.title)}</h4><div class="fgrid">${inner}</div></div>` : ''; }).join('')}
      </form>
      <div class="drawer-f">
        ${!isNew && lockedAny && isWriter() && !approved && !pending ? `<button class="btn" id="reqedit">${ic('shield')}Request edit</button>` : ''}
        <div style="flex:1"></div>
        <button class="btn" data-close>${isWriter() ? 'Cancel' : 'Close'}</button>
        ${isWriter() && (isNew || sh.cols.some(canEdit)) ? `<button class="btn primary" id="save">${ic('check')}${isNew ? 'Save entry' : 'Save changes'}</button>` : ''}
      </div>`);

    const f = d.querySelector('#f');
    const read = () => { f.querySelectorAll('[name]').forEach((el) => (form[el.name] = el.value)); };
    const sync = () => {
      read();
      if (key === 'sales') {
        const hp = form.I === 'HP';
        d.querySelectorAll('[data-hp]').forEach((el) => (el.style.display = hp || (!isNew && !canEdit(colOf(key, 'I')) && rec.I === 'HP') ? '' : 'none'));
        const e = S.engines.find((x) => x.engine === String(form.D));
        if (isNew) {
          const set = (c, v) => { const el = d.querySelector(`[data-auto="${c}"]`); if (el) el.innerHTML = v ? esc(v) : '<span class="muted">auto</span>'; };
          set('E', e?.model); set('F', e?.variant); set('G', e?.colour); set('H', e?.frame);
        }
        const adv = (S.data.bookings?.rows || []).filter((b) => String(b.J) === String(form.D) && form.D).reduce((s, b) => s + num(b.G), 0);
        const total = num(form.K) + num(form.L) + num(form.M) + num(form.N) + num(form.O) - num(form.P);
        const paid = adv + num(form.S) + num(form.V) + num(form.Y);
        const dd = hp ? (form.AD ? num(form.AC) : num(form.AB)) : 0;
        const bal = total - paid - dd;
        const ddPend = hp && !form.AD ? num(form.AB) - num(form.AC) : 0;
        d.querySelector('#tally').innerHTML = `
          <div><small>Total cost</small><b>${inr(total, false)}</b></div>
          <div><small>Booking advance</small><b>${inr(adv, false)}</b></div>
          <div class="${ddPend >= 0.5 ? 'bad' : ''}"><small>DD pending</small><b>${inr(Math.max(0, ddPend), false)}</b></div>
          <div class="${bal >= 0.5 ? 'bad' : ''}"><small>${bal < -0.5 ? 'Overpaid' : 'Customer balance'}</small><b>${inr(Math.abs(bal), false)}</b></div>`;
      }
    };
    f.addEventListener('input', sync);
    f.addEventListener('change', (ev) => {
      // typing a payment fills its date with today (still editable)
      const dateFor = { S: 'T', V: 'W', Y: 'Z', AC: 'AD' }[ev.target.name];
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
    if (key === 'sales' && !S.data.bookings) api('GET', '/api/sheets/bookings').then((r) => { S.data.bookings = r; sync(); }).catch(() => {});
    sync();

    const save = d.querySelector('#save');
    if (save) save.onclick = async () => {
      read();
      const body = {};
      sh.cols.filter(canEdit).forEach((c) => {
        if (key === 'sales' && c.hpOnly && form.I !== 'HP') { if (!isNew && rec[c.c] !== '') body[c.c] = ''; return; }
        if (isNew || String(form[c.c] ?? '') !== String(rec[c.c] ?? '')) body[c.c] = form[c.c];
      });
      if (!isNew && !Object.keys(body).length) { closeDrawer(); return; }
      save.disabled = true;
      try {
        await api(isNew ? 'POST' : 'PUT', isNew ? `/api/sheets/${key}` : `/api/sheets/${key}/${rec._row}`, body);
        toast(isNew ? 'Saved to the sheet' : 'Changes saved');
        closeDrawer();
        await refreshCore();
        pageSheet(key);
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
    m.querySelector('#why').focus();
    m.querySelector('#c').onclick = () => m.remove();
    m.querySelector('.scrim').onclick = () => m.remove();
    m.querySelector('#s').onclick = async () => {
      const reason = m.querySelector('#why').value.trim();
      if (!reason) return toast('Please write the reason', true);
      try {
        await api('POST', `/api/sheets/${key}/${rec._row}/request`, { reason });
        m.remove(); closeDrawer(); toast('Request sent to the Admin'); pageSheet(key);
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---------- ledger ----------
  async function pageLedger() {
    loading('Bank Ledger');
    const L = await api('GET', '/api/ledger');
    S.ledgerAcc = S.ledgerAcc && L.accounts.some((a) => a.account === S.ledgerAcc) ? S.ledgerAcc : L.accounts[0]?.account;
    const a = L.accounts.find((x) => x.account === S.ledgerAcc) || { lines: [] };
    const total = L.accounts.reduce((s, x) => s + x.closing, 0);
    shell('Bank Ledger', 'Every payment with an account posts here automatically', '', `
      ${L.unposted > 0 ? `<div class="notice warn">${ic('info')}<div><b>${inr(L.unposted)}</b> received without an account selected. Open the entry and pick "Received in".</div></div>` : ''}
      <div class="panel" style="margin-bottom:16px"><div class="tbl-wrap"><table><thead><tr><th>Account</th><th class="num hide-m">Opening</th><th class="num hide-m">Received</th><th class="num hide-m">Paid</th><th class="num">Closing</th></tr></thead><tbody>
        ${L.accounts.map((x) => `<tr class="click" data-acc="${esc(x.account)}"><td class="strong">${esc(x.account)}</td><td class="num hide-m">${inr(x.opening)}</td><td class="num in hide-m">${inr(x.received)}</td><td class="num out hide-m">${inr(x.paid)}</td><td class="num"><b>${inr(x.closing)}</b></td></tr>`).join('')}
        <tr><td><b>Total cash and bank</b></td><td class="hide-m"></td><td class="hide-m"></td><td class="hide-m"></td><td class="num"><b>${inr(total)}</b></td></tr>
      </tbody></table></div></div>
      <div class="tabs">${L.accounts.map((x) => `<button class="chip ${x.account === S.ledgerAcc ? 'on' : ''}" data-acc="${esc(x.account)}">${esc(x.account)}</button>`).join('')}</div>
      <div class="panel strip stat-row" style="--n:4"><div class="st"><div class="l">Opening</div><div class="v">${inr(a.opening, false)}</div></div><div class="st"><div class="l">Received</div><div class="v in">${inr(a.received, false)}</div></div><div class="st"><div class="l">Paid</div><div class="v out">${inr(a.paid, false)}</div></div><div class="st"><div class="l">Closing</div><div class="v">${inr(a.closing, false)}</div></div></div>
      <div class="panel">${a.lines.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Particulars</th><th class="hide-m">From</th><th class="num">In / out</th><th class="num hide-m">Balance</th></tr></thead><tbody>
        ${a.lines.slice().reverse().map((l) => `<tr><td class="date">${fdate(l.date)}</td><td class="wrap">${esc(l.text)}<span class="sub show-m">${esc(l.from)}</span></td><td class="muted hide-m">${esc(l.from)}</td><td class="num">${l.in ? `<span class="in">+${inr(l.in, false)}</span>` : `<span class="out">−${inr(l.out, false)}</span>`}</td><td class="num hide-m"><b>${inr(l.balance, false)}</b></td></tr>`).join('')}
        <tr><td></td><td class="muted">Opening balance</td><td class="hide-m"></td><td class="num">${inr(a.opening, false)}</td><td class="hide-m"></td></tr>
      </tbody></table></div>` : '<div class="empty">No entries for this account yet.</div>'}</div>`);
    document.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => { S.ledgerAcc = b.dataset.acc; pageLedger(); });
  }

  // ---------- edit requests ----------
  const sheetKeyByName = (n) => Object.keys(S.schema).find((k) => S.schema[k].name === n);
  const serialToText = (s) => { if (typeof s !== 'number') return s || ''; const d = new Date(Math.round((s - 25569 - 330 / 1440) * 86400000)); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  async function pageApprovals() {
    loading('Edit Requests');
    const { requests } = await api('GET', '/api/requests');
    const pend = requests.filter((r) => r.status === 'Pending');
    S.pendingCount = isAdmin() ? pend.length : 0;
    const row = (r) => `<tr>
      <td class="date">${esc(serialToText(r.at))}</td><td>${esc(r.by)}</td>
      <td><a href="#/s/${sheetKeyByName(r.sheet) || ''}">${esc(r.sheet)}</a> · row ${r.row}<div class="muted">${esc(r.entry)}</div></td>
      <td>${esc(r.reason)}</td><td>${pill(r.status)}${r.decidedBy ? `<div class="muted" style="font-size:12px">${esc(r.decidedBy)}</div>` : ''}</td>
      <td class="num">${isAdmin() && r.status === 'Pending' ? `<button class="btn sm primary" data-ok="${r.id}">Approve</button> <button class="btn sm danger" data-no="${r.id}">Reject</button>` : ''}</td></tr>`;
    const table = (list, empty) => list.length ? `<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Requested by</th><th>Entry</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : `<div class="empty">${empty}</div>`;
    shell('Edit Requests', isAdmin() ? 'Approve to open that entry for 30 minutes, only for the person who asked' : 'Your requests to change saved entries', '', `
      ${isAdmin() ? `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h3>Waiting for you</h3><small>${pend.length}</small></div>${table(pend, 'No pending requests.')}</div>` : ''}
      <div class="panel"><div class="panel-h"><h3>${isAdmin() ? 'History' : 'My requests'}</h3></div>${table(isAdmin() ? requests.filter((r) => r.status !== 'Pending') : requests, 'No requests yet. Open a saved entry and use "Request edit".')}</div>`);
    const decide = async (id, status) => {
      try { await api('POST', `/api/requests/${id}`, { status }); toast(status === 'Approved' ? 'Approved: entry open for 30 minutes' : 'Request rejected'); pageApprovals(); }
      catch (e) { toast(e.message, true); }
    };
    document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => decide(Number(b.dataset.ok), 'Approved'));
    document.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => decide(Number(b.dataset.no), 'Rejected'));
  }

  // ---------- users ----------
  async function pageUsers() {
    if (!isAdmin()) return pageDashboard();
    loading('Users');
    const { users } = await api('GET', '/api/users');
    shell('Users', 'Who can sign in, and what they can do', `<button class="btn primary" id="add">${ic('plus')}<span class="new-label">Add user</span></button>`, `
      <div class="notice info">${ic('info')}<div><b>Admin</b>: everything, approves edits · <b>Manager / Staff</b>: add entries, fill empty fields, request edits · <b>Viewer</b>: look only. People sign in with this Google account.</div></div>
      <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Google account</th><th>Role</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${users.map((u) => `<tr class="click" data-u="${esc(u.email)}"><td class="strong">${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="pill navy">${esc(u.role || '—')}</span></td><td>${u.active ? '<span class="pill green">Active</span>' : '<span class="pill grey">Off</span>'}</td><td class="muted">${esc(u.notes)}</td></tr>`).join('')}
      </tbody></table></div></div>`);
    const edit = (u) => {
      const d = drawer(`
        <div class="drawer-h"><div><h3>${u ? esc(u.name || u.email) : 'Add user'}</h3><small>Users</small></div><div class="grow"></div><button class="icon-btn" data-close style="color:var(--navy)">${ic('x')}</button></div>
        <form class="drawer-b" id="uf"><div class="fgroup"><div class="fgrid">
          <div class="field"><label>Google account (email) <span class="req">*</span></label><input name="email" type="email" value="${esc(u?.email || '')}" ${u ? 'readonly' : ''}></div>
          <div class="field"><label>Name</label><input name="name" value="${esc(u?.name || '')}"></div>
          <div class="field"><label>Role <span class="req">*</span></label><select name="role">${['Admin', 'Manager', 'Staff', 'Viewer'].map((r) => `<option ${u?.role === r || (!u && r === 'Staff') ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
          <div class="field"><label>Access</label><select name="active"><option value="yes" ${u?.active !== false ? 'selected' : ''}>Active</option><option value="no" ${u?.active === false ? 'selected' : ''}>Turned off</option></select></div>
          <div class="field" style="grid-column:1/-1"><label>Notes</label><input name="notes" value="${esc(u?.notes || '')}"></div>
        </div></div><div class="notice info">${ic('info')}<div>To also give them access to the Google Sheet itself, run RE Admin → Sync users & access in the sheet.</div></div></form>
        <div class="drawer-f"><button class="btn" data-close>Cancel</button><button class="btn primary" id="us">${ic('check')}Save</button></div>`);
      d.querySelector('#us').onclick = async () => {
        const fd = Object.fromEntries(new FormData(d.querySelector('#uf')));
        try { await api('POST', '/api/users', { ...fd, active: fd.active !== 'no' }); toast('User saved'); closeDrawer(); pageUsers(); }
        catch (e) { toast(e.message, true); }
      };
    };
    document.getElementById('add').onclick = () => edit(null);
    document.querySelectorAll('[data-u]').forEach((tr) => tr.onclick = () => edit(users.find((x) => x.email === tr.dataset.u)));
  }

  // ---------- router & boot ----------
  async function route() {
    closeDrawer();
    const h = location.hash || '#/dashboard';
    try {
      if (h.startsWith('#/s/')) await pageSheet(h.slice(4));
      else if (h === '#/ledger') await pageLedger();
      else if (h === '#/approvals') await pageApprovals();
      else if (h === '#/users') await pageUsers();
      else await pageDashboard();
    } catch (e) {
      if (e.status === 401) { S.user = null; return renderLogin(); }
      if (S.user) shell('Error', '', '', `<div class="panel"><div class="empty">${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">Try again</button></div></div>`);
    }
  }

  async function refreshCore() {
    const b = await api('GET', '/api/bootstrap');
    Object.assign(S, { user: b.user, schema: b.schema, lists: b.lists, engines: b.engines, demo: b.demo, showroom: b.showroom });
    if (S.user.role === 'Admin') {
      api('GET', '/api/requests').then((r) => { S.pendingCount = r.requests.filter((x) => x.status === 'Pending').length; const n = document.querySelector('a[href="#/approvals"]'); if (n && S.pendingCount && !n.querySelector('.badge')) n.insertAdjacentHTML('beforeend', `<span class="badge">${S.pendingCount}</span>`); }).catch(() => {});
    }
  }

  async function boot() {
    try {
      await refreshCore();
    } catch (e) {
      return renderLogin(e.status === 401 ? '' : e.message);
    }
    window.onhashchange = route;
    route();
  }

  boot();
})();
