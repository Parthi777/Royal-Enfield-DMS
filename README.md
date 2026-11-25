# RE Showroom web app

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
- **Security.** Passwords are stored hashed (scrypt), never in plain text. Five wrong passwords lock that username for 10 minutes. Resetting someone's password or turning their account off signs them out everywhere.

### First start: create the Admin

1. When there are no users yet, the app prints a one-time code in the Railway deploy logs: `FIRST-TIME SETUP CODE: XXXX-XXXX`.
2. Open the app, enter the code, your name, a username and a password.

Only someone who can see your Railway logs can create the first Admin.

### Keep accounts across deploys (Railway volume)

Users and roles are saved in `accounts.json` in the app's data folder.

- **On Railway:** add a volume to the service mounted at **`/data`** (right-click the service → *Attach volume*, mount path `/data`). Without it, accounts are lost at every redeploy.
- **Elsewhere:** set `DATA_DIR` to the folder to use.

## Payment reference (UTR)

When a customer pays into a bank account (GPay, UPI, NEFT, card), the form asks for the **UTR / reference no** next to that payment:

- the booking advance (Bookings, column Q)
- payments 1–3 (Vehicle Sales, columns AM, AN and AO)
- the service bill (Service, column H)

Cash payments don't need one. The UTR also shows in the bank ledger particulars.

## Excel and PDF reports

Every list has **Export → Excel / PDF**: stock, bookings, sales, service, expenses, bank entries, bank ledger statement, edit requests, users and roles, and the dashboard daily report.

- The export follows the current filter and search.
- Excel files have every column, with ₹ amounts in Indian format, dates, filters and totals.
- PDFs show the on-screen columns, sized to fit the page, with page numbers.

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
| `SHOWROOM_NAME` | Name shown in the app and on reports |
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
