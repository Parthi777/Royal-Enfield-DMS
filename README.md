# Pradhanaa Motors LLP: Royal Enfield showroom web app

A web app for the Royal Enfield showroom on top of the **RE Showroom Google Sheet**: vehicle stock, bookings, vehicle sales, service, expenses, bank entries, bank ledger and dashboard.

## Sign-in, users and roles

- **Sign-in.** People sign in with a username and password that the Admin creates under **Users & Roles**. At their first sign-in, they set their own password.
- **Roles.** Each person has one role. A role sets the access level for every section:

  | Level | What it allows |
  |---|---|
  | No access | The section is hidden. |
  | View | Can only look. |
  | Add | New entries, fill empty fields, and request edits to saved values. |
  | Edit | Can also change saved entries directly. Every change goes to the Edit Log. |

  Two extra switches per role: **Approve edit requests** and **Manage users and roles**.
- **Ready-made roles.** Admin (fixed, full access), Manager, Sales Executive, Service Advisor, Accountant and Viewer. You can change them or add your own.
- **Money figures.** Only roles that can see the Bank Ledger see cash and bank balances and expenses on the dashboard.
- **Who manages whom.** Only an Admin can create or change Admins, people whose role has **Manage users**, and roles. Someone else with Manage users can add, turn off and reset ordinary staff only.
- **Security.**
  - Passwords are stored hashed (scrypt), never in plain text.
  - Five wrong passwords lock that username for 10 minutes. Ten wrong setup codes lock setup for 10 minutes.
  - **Sign out** ends that session even if the cookie was copied. **Sign out of all devices** (in the user menu) ends every session.
  - Resetting someone's password or turning their account off signs them out everywhere.
  - Vehicle purchase values are sent only to roles that can view Vehicle Stock.
  - The site sends Content-Security-Policy, HSTS and Permissions-Policy headers.

### First start: create the Admin

1. When there are no users yet, the app prints a one-time code in the Railway deploy logs: `FIRST-TIME SETUP CODE: XXXX-XXXX`.
2. Open the app, enter the code, your name, a username and a password.

Only someone who can see your Railway logs can create the first Admin.

### Keep accounts across deploys (Railway volume)

Users and roles are saved in `accounts.json` in the app's data folder.

- **On Railway:** add a volume to the service mounted at **`/data`** (right-click the service → *Attach volume*, mount path `/data`). Without it, accounts are lost at every redeploy.
- **Elsewhere:** set `DATA_DIR` to the folder to use.

## Masters (dropdown lists)

**Control → Masters** is where the dropdown lists are kept: models, variants, colours, cash and bank accounts (with opening balances), financiers, expense categories, service types and bank entry types. You can add, rename, remove and reorder items.

- **Renaming:** renaming an item also changes it in every saved entry, so old entries still match. For example, renaming "Bank A/c 1" to "HDFC CA 4521" keeps its ledger.
- **Removing:** a removed item leaves the dropdown, and saved entries keep the old name. An account that has saved entries can't be removed: rename it instead.
- **Fixed names:** some names are used by the sheet's formulas: Cash, Paid/Free, Cash Deposit/Transfer and Cash/HP. They can't be renamed or removed.
- **Limits:** the sheet's dashboard has room for 20 models, 12 accounts, 16 financiers and 13 expense categories.
- **Edit Log:** every change is recorded there.
- **Access:** set it per role under Users & Roles (No access, View or Edit). The Admin always has Edit.

## Vehicle Sales

- **Customer lookup:** type the mobile number first. If that customer has an open booking, the name, the allotted engine and the booking advance fill in by themselves. In Bookings, a repeat customer's name fills in the same way.
- **Customer payments:** in the sale form, **Customer payments → Add payment** adds a row: date, amount, account (Cash or a bank) and the UTR for bank payments. Any number of payments. Each one is saved as a row in the sheet's **Sale Payments** tab, linked by engine number. There is no separate page: open a saved payment from its sale.
- **HP sales:** Document charges (column S) collected from the customer add to what the customer owes. DD sanctioned, DD received, date and account as before.
- Customer paid (AF) = booking advance + every payment. Customer balance (AI) = vehicle cost + document charges − customer paid − DD.

## Expenses

Expenses are money going out only: date, particulars, category, **Paid from** (Cash or a bank), amount, bill / UTR no, remarks. Money coming into cash from the office goes in **Bank Entries** (Account = Cash, Type = Cash from Office).

## Payment reference (UTR)

When a customer pays into a bank account (GPay, UPI, NEFT, card), the form asks for the **UTR / reference no**:

- the booking advance (Bookings, column P)
- each sale payment (Sale Payments, column F)
- the service bill (Service, column G)

Cash payments don't need one. The UTR also shows in the bank ledger and day book particulars.

## Day Book

**Day Book** shows one day at a time: every receipt (money in) and payment (money out) with its account, then cash and bank accounts with opening balance, received, paid and closing balance, and the same for each account. Use the arrows or the date box to move between days. Exports to Excel and PDF.

## Bank Ledger

The Bank Ledger page shows bank accounts only: a statement per account with opening, received, paid and closing. Cash is in the Day Book.

## Dashboard

- **Today:** sales, bookings, service, collections; then cash opening and closing, bank opening and closing, bank deposits and expenses.
- **This month:** the same figures for the month so far.
- **Below:** the cash and bank account table, then charts (money in and out by day, follow-ups, vehicles sold, stock, expenses, sales mix).

Roles without Bank Ledger access see the sales and bookings figures only.

## Stock status

A booking with an engine number marks that vehicle **Allotted** in Vehicle Stock; a sale marks it **Sold** and the booking **Delivered**. The sheet's old Check columns were removed: the app refuses those entries instead (see below).

## Checks on entries

- **Dates:** impossible dates such as 31 Feb are refused.
- **Refused entries:**
  - an expense or bank entry with no amount
  - a cash sale with financier, document charges or DD filled
  - a commitment date before the booking date
  - a payment for a vehicle that hasn't been sold, or a bank payment without its UTR
- **Confirmations:** amounts far above normal ask before saving, for example a booking advance over ₹5 lakh. So do sales payments above the vehicle cost.
- **Edit requests:** an approval can be withdrawn, and a rejected request can't be reopened.

## Excel and PDF reports

Every list has **Export → Excel / PDF**: stock, bookings, sales, sale payments, service, expenses, bank entries, bank ledger statement, day book, edit requests, users and roles, and the dashboard daily report.

- The export follows the current filter and search.
- Excel files have every column, with ₹ amounts in Indian format, dates, filters and totals.
- PDFs show the on-screen columns, sized to fit the page, with page numbers.
- One export runs at a time per person, up to 5,000 rows. Filter the list first for more.

## Demo mode

Without `GOOGLE_SERVICE_ACCOUNT_JSON` (or with `DEMO_MODE=true`), the app runs on sample data kept in memory. Sign-in, roles and reports all work, but entries are not saved to the sheet.

## Connect your Google Sheet

1. In Google Cloud:
   1. Turn on the **Google Sheets API**.
   2. Create a **service account** and download its JSON key.
   3. Share the Google Sheet with the service account's email as **Editor**.
   4. In the sheet's Apps Script (`RE_RowLock_GoogleSheets.gs`), put that email in `CONFIG.APP_ACCOUNTS` and run **RE Admin → Set up** again, so the app can write to locked cells.
2. In Railway → Variables, set these and remove `DEMO_MODE`:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: paste the whole key file.
   - `SHEET_ID`: the long ID from the sheet link.

## Variables

| Variable | What it is |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account key for the Google Sheet (not needed in demo mode) |
| `SHEET_ID` | ID of the RE Showroom Google Sheet |
| `SHOWROOM_NAME` | Name shown in the app and on reports (default: Pradhanaa Motors LLP) |
| `DATA_DIR` | Where accounts are saved (default `/data` if it exists) |
| `SESSION_SECRET` | Optional; otherwise one is generated and kept with the accounts |
| `DEMO_MODE` | `true` = sample data |

## Files

- `server.js`: routes, sign-in, sessions, access checks
- `accounts.js`: users, roles and passwords
- `data.js`: sheet rules: locks, approvals, edit log, UTR, ledger, dashboard
- `export.js`: Excel and PDF reports
- `schema.js`: the sheet's columns
- `store.js`: Google Sheets access (or demo data)
- `index.html`, `app.js`, `style.css`, `icons.js`: the web pages ([Lucide](https://lucide.dev) icons, ISC licence)
- `fonts/`: IBM Plex Sans, used in the PDFs (SIL Open Font Licence)
- `brand/`: Pradhanaa Motors logo, used in the app, browser tab and reports
