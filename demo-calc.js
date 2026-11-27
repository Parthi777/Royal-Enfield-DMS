// Demo mode only. With the real Google Sheet, its formulas fill the grey (computed) columns.
// Here we do the same in JavaScript after every change, so the demo behaves like the sheet:
// a booking with an engine marks the vehicle Allotted, a sale marks it Sold and the booking Delivered, and so on.
// Grid shape: { 'Sheet name': { '<row>': [values from column A] } }, dates as sheet serial numbers.

const IST_MIN = 330;
const FIRST = 3;

const idx = (letter) => { let n = 0; for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const blank = (v) => v === '' || v === null || v === undefined;
const N = (v) => (typeof v === 'number' ? v : (blank(v) || isNaN(Number(v)) ? 0 : Number(v)));
const inr = (n) => Math.round(n).toLocaleString('en-US');   // the sheet's TEXT(x,"#,##0")

function rows(grid, name) {
  const g = grid[name] || {};
  return Object.keys(g).map(Number).filter((r) => r >= FIRST).sort((a, b) => a - b).map((r) => {
    const v = (g[r] = g[r] || []);
    return { r, v, get: (c) => (blank(v[idx(c)]) ? '' : v[idx(c)]), set: (c, x) => { v[idx(c)] = x; } };
  });
}

function recompute(grid) {
  const today = Math.floor(Date.now() / 86400000 + 25569 + IST_MIN / 1440);
  const stock = rows(grid, 'Vehicle Stock');
  const bookings = rows(grid, 'Bookings');
  const sales = rows(grid, 'Vehicle Sales');
  const pays = rows(grid, 'Sale Payments');

  const saleOf = new Map(), bookingOf = new Map();
  for (const s of sales) if (s.get('D') !== '' && !saleOf.has(String(s.get('D')))) saleOf.set(String(s.get('D')), s);
  for (const b of bookings) if (b.get('J') !== '' && !bookingOf.has(String(b.get('J')))) bookingOf.set(String(b.get('J')), b);

  // Vehicle Stock: H status, I allotted/sold to, J days in stock
  for (const s of stock) {
    if (s.get('E') === '') { ['H', 'I', 'J'].forEach((c) => s.set(c, '')); continue; }
    const e = String(s.get('E')), sold = saleOf.get(e), al = bookingOf.get(e);
    const status = sold ? 'Sold' : al ? 'Allotted' : 'Available';
    s.set('H', status);
    s.set('I', sold ? sold.get('B') : al ? al.get('B') : '');
    s.set('J', status === 'Sold' || s.get('A') === '' ? '' : today - N(s.get('A')));
  }

  // Bookings: K allotment, L stock for model, M delivery, N days left, O alert
  for (const b of bookings) {
    if (b.get('B') === '') { ['K', 'L', 'M', 'N', 'O', 'Y'].forEach((c) => b.set(c, '')); continue; }
    b.set('Y', N(b.get('G')) + N(b.get('Q')) + N(b.get('U')));   // booking amount = all its payments
    const j = String(b.get('J'));
    b.set('K', j ? 'Vehicle Allotted' : 'Not Allotted');
    const cnt = stock.filter((s) => s.get('B') === b.get('D') && s.get('C') === b.get('E') && s.get('D') === b.get('F') && s.get('H') === 'Available').length;
    b.set('L', j ? '—' : cnt === 0 ? 'No stock' : `${cnt} in stock`);
    const delivered = j && saleOf.has(j);
    b.set('M', delivered ? 'Delivered' : 'Pending');
    const I = b.get('I');
    b.set('N', I === '' || delivered ? '' : N(I) - today);
    b.set('O', delivered ? 'DELIVERED' : I === '' ? 'Set commitment date'
      : N(I) < today ? `OVERDUE - ${today - N(I)} days` : N(I) - today <= 3 ? `DUE SOON - ${N(I) - today} days` : 'ON TRACK');
  }

  // Vehicle Sales: E-H from stock, Q total cost, R booking advance, AF-AK tally
  const stockOf = new Map(stock.filter((s) => s.get('E') !== '').map((s) => [String(s.get('E')), s]));
  for (const s of sales) {
    const d = String(s.get('D'));
    const st = stockOf.get(d);
    [['E', 'B'], ['F', 'C'], ['G', 'D'], ['H', 'F']].forEach(([to, from]) => s.set(to, d === '' ? '' : st ? st.get(from) : 'Not in stock'));
    const parts = ['K', 'L', 'M', 'N', 'O'].map((c) => s.get(c));
    const Q = parts.every((x) => x === '') ? '' : parts.reduce((a, x) => a + N(x), 0) - N(s.get('P'));
    s.set('Q', Q);
    const R = d === '' ? '' : bookings.filter((b) => String(b.get('J')) === d).reduce((a, b) => a + N(b.get('G')) + N(b.get('Q')) + N(b.get('U')), 0);
    s.set('R', R);
    if (Q === '') { ['AF', 'AG', 'AH', 'AI', 'AJ'].forEach((c) => s.set(c, '')); }
    else {
      const paid = N(R) + (d === '' ? 0 : pays.filter((p) => String(p.get('B')) === d).reduce((a, p) => a + N(p.get('D')), 0));
      const hp = s.get('I') === 'HP', ddDone = s.get('AD') !== '';
      const AH = hp ? (ddDone ? 0 : N(s.get('AB')) - N(s.get('AC'))) : '';
      const AI = Q + N(s.get('S')) - paid - (hp ? (ddDone ? N(s.get('AC')) : N(s.get('AB'))) : 0);
      s.set('AF', paid); s.set('AG', paid + N(s.get('AC'))); s.set('AH', AH); s.set('AI', AI);
      s.set('AJ', AI < -0.5 ? `OVERPAID ₹${inr(-AI)}` : AI < 0.5 && N(AH) < 0.5 ? 'FULLY PAID'
        : `${AI >= 0.5 ? `CUSTOMER OWES ₹${inr(AI)}` : ''}${N(AH) >= 0.5 ? `   DD PENDING ₹${inr(AH)}` : ''}`.trim());
    }
    s.set('AK', d === '' ? '' : bookings.some((b) => String(b.get('J')) === d) ? 'Booked' : 'Walk-in');
  }

  // Sale Payments: C customer name
  for (const p of pays) {
    const d = String(p.get('B'));
    p.set('C', d === '' ? '' : saleOf.has(d) ? saleOf.get(d).get('B') : '⚠ Engine not sold');
  }

}

module.exports = { recompute };
