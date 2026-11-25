// Column map of the RE Showroom Google Sheet. Data rows run 3..1002.
// type: date | text | phone | money | list | engine | sold (engine no of a saved sale) | auto
// perm: the section whose access level applies (default: the sheet's own key)
// list: key into the Masters lists (see MASTERS below)

const FIRST_ROW = 3;
const LAST_ROW = 1002;

const SHEETS = {
  stock: {
    name: 'Vehicle Stock', title: 'Vehicle Stock', icon: 'bike', last: 'J', key: 'E',
    cols: [
      { c: 'A', label: 'Inward date', type: 'date', req: true },
      { c: 'B', label: 'Model', type: 'list', list: 'models', req: true },
      { c: 'C', label: 'Variant', type: 'list', list: 'variants' },
      { c: 'D', label: 'Colour', type: 'list', list: 'colours' },
      { c: 'E', label: 'Engine no', type: 'text', req: true, unique: true },
      { c: 'F', label: 'Frame no', type: 'text', req: true },
      { c: 'G', label: 'Purchase value', type: 'money', req: true },
      { c: 'H', label: 'Status', type: 'auto', status: true },
      { c: 'I', label: 'Allotted / sold to', type: 'auto' },
      { c: 'J', label: 'Days in stock', type: 'auto' },
    ],
    list: ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'J'],
  },
  bookings: {
    name: 'Bookings', title: 'Bookings', icon: 'calendar', last: 'P', key: 'B',
    cols: [
      { c: 'A', label: 'Booking date', type: 'date', req: true },
      { c: 'B', label: 'Customer name', type: 'text', req: true },
      { c: 'C', label: 'Mobile no', type: 'phone', req: true },
      { c: 'D', label: 'Model', type: 'list', list: 'models', req: true },
      { c: 'E', label: 'Variant', type: 'list', list: 'variants' },
      { c: 'F', label: 'Colour', type: 'list', list: 'colours' },
      { c: 'G', label: 'Booking amount', type: 'money' },
      { c: 'H', label: 'Received in', type: 'list', list: 'accounts' },
      { c: 'P', label: 'UTR / reference no', type: 'text', refOf: 'H', amountOf: 'G' },
      { c: 'I', label: 'Commitment date', type: 'date' },
      { c: 'J', label: 'Allotted engine no', type: 'engine', engineFor: 'booking' },
      { c: 'K', label: 'Allotment', type: 'auto', status: true },
      { c: 'L', label: 'Stock for model', type: 'auto' },
      { c: 'M', label: 'Delivery', type: 'auto', status: true },
      { c: 'N', label: 'Days left', type: 'auto' },
      { c: 'O', label: 'Alert', type: 'auto', status: true },
    ],
    list: ['A', 'B', 'C', 'D', 'G', 'I', 'K', 'J', 'O'],
  },
  sales: {
    name: 'Vehicle Sales', title: 'Vehicle Sales', icon: 'receipt', last: 'AK', key: 'B',
    groups: [
      { title: 'Customer & bike', cols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] },
      { title: 'Vehicle cost', cols: ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'] },
      { title: 'Finance DD (HP only)', cols: ['AB', 'AC', 'AD', 'AE'], hpOnly: true },
      { title: 'Tally', cols: ['AF', 'AG', 'AH', 'AI', 'AJ', 'AK'] },
    ],
    cols: [
      { c: 'A', label: 'Sales date', type: 'date', req: true },
      { c: 'B', label: 'Customer name', type: 'text', req: true },
      { c: 'C', label: 'Mobile no', type: 'phone', req: true },
      { c: 'D', label: 'Engine no', type: 'engine', engineFor: 'sale', req: true },
      { c: 'E', label: 'Model', type: 'auto' },
      { c: 'F', label: 'Variant', type: 'auto' },
      { c: 'G', label: 'Colour', type: 'auto' },
      { c: 'H', label: 'Chassis no', type: 'auto' },
      { c: 'I', label: 'Purchase mode', type: 'list', list: 'modes', req: true },
      { c: 'J', label: 'Financier', type: 'list', list: 'financiers', hpOnly: true },
      { c: 'K', label: 'Ex-showroom', type: 'money', req: true },
      { c: 'L', label: 'Insurance', type: 'money' },
      { c: 'M', label: 'RTO / registration', type: 'money' },
      { c: 'N', label: 'Accessories', type: 'money' },
      { c: 'O', label: 'Other charges', type: 'money' },
      { c: 'P', label: 'Discount', type: 'money' },
      { c: 'Q', label: 'Total vehicle cost', type: 'auto', money: true },
      { c: 'R', label: 'Booking advance', type: 'auto', money: true },
      { c: 'AB', label: 'DD sanctioned', type: 'money', hpOnly: true },
      { c: 'AC', label: 'DD received', type: 'money', hpOnly: true },
      { c: 'AD', label: 'DD received date', type: 'date', hpOnly: true },
      { c: 'AE', label: 'DD received in', type: 'list', list: 'accounts', hpOnly: true },
      { c: 'AF', label: 'Customer paid', type: 'auto', money: true },
      { c: 'AG', label: 'Total received', type: 'auto', money: true },
      { c: 'AH', label: 'DD pending', type: 'auto', money: true },
      { c: 'AI', label: 'Customer balance', type: 'auto', money: true },
      { c: 'AJ', label: 'Payment status', type: 'auto', status: true },
      { c: 'AK', label: 'Booking type', type: 'auto' },
    ],
    list: ['A', 'B', 'C', 'E', 'I', 'Q', 'AI', 'AJ'],
  },
  service: {
    name: 'Service', title: 'Service', icon: 'wrench', last: 'G', key: 'B',
    cols: [
      { c: 'A', label: 'Date', type: 'date', req: true },
      { c: 'B', label: 'Customer name', type: 'text', req: true },
      { c: 'C', label: 'Vehicle no', type: 'text' },
      { c: 'D', label: 'Service type', type: 'list', list: 'serviceTypes', req: true },
      { c: 'E', label: 'Bill value', type: 'money' },
      { c: 'F', label: 'Received in', type: 'list', list: 'accounts' },
      { c: 'G', label: 'UTR / reference no', type: 'text', refOf: 'F', amountOf: 'E' },
    ],
    list: ['A', 'B', 'C', 'D', 'E', 'F'],
  },
  expenses: {
    name: 'Expenses', title: 'Expenses', icon: 'wallet', last: 'H', key: 'B',
    cols: [
      { c: 'A', label: 'Date', type: 'date', req: true },
      { c: 'B', label: 'Particulars', type: 'text', req: true },
      { c: 'C', label: 'Entry type', type: 'list', list: 'entryTypes', req: true },
      { c: 'D', label: 'Category', type: 'list', list: 'expenseCats', req: true },
      { c: 'E', label: 'Account', type: 'list', list: 'accounts', req: true },
      { c: 'F', label: 'Received', type: 'money' },
      { c: 'G', label: 'Paid', type: 'money' },
      { c: 'H', label: 'Running balance', type: 'auto', money: true },
    ],
    list: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  },
  bank: {
    name: 'Bank Entries', title: 'Bank Entries', icon: 'bank', last: 'G', key: 'C',
    cols: [
      { c: 'A', label: 'Date', type: 'date', req: true },
      { c: 'B', label: 'Account', type: 'list', list: 'accounts', req: true },
      { c: 'C', label: 'Particulars', type: 'text', req: true },
      { c: 'D', label: 'Type', type: 'list', list: 'bankTypes', req: true },
      { c: 'E', label: 'Credit / in', type: 'money' },
      { c: 'F', label: 'Debit / out', type: 'money' },
      { c: 'G', label: 'Contra account', type: 'list', list: 'accounts' },
    ],
    list: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  },
  // every customer payment for a sale, one row each (as many as needed); uses the Vehicle Sales permissions
  payments: {
    name: 'Sale Payments', title: 'Sale Payments', icon: 'receipt', last: 'G', key: 'C', perm: 'sales',
    cols: [
      { c: 'A', label: 'Payment date', type: 'date', req: true },
      { c: 'B', label: 'Engine no', type: 'sold', req: true },
      { c: 'C', label: 'Customer', type: 'auto' },
      { c: 'D', label: 'Amount', type: 'money', req: true },
      { c: 'E', label: 'Received in', type: 'list', list: 'accounts', req: true },
      { c: 'F', label: 'UTR / reference no', type: 'text', refOf: 'E', amountOf: 'D' },
      { c: 'G', label: 'Remarks', type: 'text' },
    ],
    list: ['A', 'C', 'B', 'D', 'E', 'F', 'G'],
  },
};

// Masters tab: column -> list name
const MASTERS = {
  A: 'models', B: 'variants', C: 'colours', D: 'financiers', E: 'expenseCats', F: 'modes',
  G: 'serviceTypes', H: 'entryTypes', I: 'accounts', J: 'opening', K: 'bankTypes',
};

// What the Masters page can edit. max = rows the sheet's own formulas and dashboard cover.
// fixed = names the sheet's formulas look for: they can't be renamed or removed.
// locked = the whole list is fixed (the sheet's rules only know these values).
const MASTER_LISTS = [
  { key: 'models', label: 'Models', col: 'A', max: 20, hint: 'Bike models. Used in stock, bookings and sales.' },
  { key: 'variants', label: 'Variants', col: 'B', max: 148, hint: 'Variants for any model.' },
  { key: 'colours', label: 'Colours', col: 'C', max: 148, hint: 'Colours for any model.' },
  { key: 'accounts', label: 'Cash and bank accounts', col: 'I', opening: 'J', max: 12, fixed: ['Cash in Hand'], hint: 'Where money is received or paid from, with the opening balance of each.' },
  { key: 'financiers', label: 'Financiers', col: 'D', max: 16, hint: 'Banks and finance companies for HP sales.' },
  { key: 'expenseCats', label: 'Expense categories', col: 'E', max: 13, hint: 'Categories for the Expenses tab.' },
  { key: 'serviceTypes', label: 'Service types', col: 'G', max: 148, fixed: ['Paid', 'Free'], hint: 'Types of service job.' },
  { key: 'bankTypes', label: 'Bank entry types', col: 'K', max: 148, fixed: ['Cash Deposit', 'Transfer'], hint: 'Types for the Bank Entries tab.' },
  { key: 'modes', label: 'Purchase modes', col: 'F', locked: true, hint: 'Cash or HP. The sheet\'s rules work with these two only.' },
  { key: 'entryTypes', label: 'Expense entry types', col: 'H', locked: true, hint: 'Receipt or Expense. The sheet\'s rules work with these two only.' },
];

const ROLES = ['Admin', 'Manager', 'Staff', 'Viewer'];

function colIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const inputCols = (sh) => sh.cols.filter((c) => c.type !== 'auto');

module.exports = { FIRST_ROW, LAST_ROW, SHEETS, MASTERS, MASTER_LISTS, ROLES, colIndex, colLetter, inputCols };
