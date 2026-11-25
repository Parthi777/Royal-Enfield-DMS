# RE Showroom web app

A web app for the Royal Enfield showroom that works on top of your existing **RE Showroom Google Sheet**.
Staff sign in with their Google account. Every entry is saved straight into the same sheet, and the
sheet's formulas keep calculating status, balances, ledger and dashboard.

**Pages:** Dashboard · Vehicle Stock · Bookings · Vehicle Sales · Service · Expenses · Bank Entries ·
Bank Ledger · Edit Requests · Users

**Rules (same as the sheet):**

- Sign in only if your email is in the **Users** tab and Active = Yes.
- **Admin** can do everything and approves edits.
- **Manager / Staff** can add entries and fill empty fields (for example, allot an engine later, add Payment 2, or enter the DD received).
- A saved value is locked. To change it, use **Request edit** → the Admin approves → the row opens for **30 minutes, only for that person**. Every change is written to **Edit Log**.
- **Viewer** can only look.
- Sold bookings drop out of the "Open" list into "Delivered".

---

## 1. Try it first (no Google setup)

Deploy with only `DEMO_MODE=true`. It shows sample data, and you pick a role on the login page.
Nothing is written to your sheet.

Locally: `npm install` then `npm run demo` → http://localhost:3000

---

## 2. Google setup (one time, about 10 minutes)

Go to https://console.cloud.google.com, signed in with the Google account that owns the sheet.

1. **Create a project:** top bar → *New project* → name it `RE Showroom`.
2. **Turn on the Sheets API:** *APIs & Services → Library* → search **Google Sheets API** → *Enable*.
3. **Create the app's own Google account (service account):**
   1. Go to *APIs & Services → Credentials → Create credentials → Service account*. Name it `re-app` → *Done*.
   2. Open it → *Keys → Add key → Create new key → JSON*. A `.json` file downloads.
   3. Keep this file secret.
   4. Copy its email. It looks like `re-app@re-showroom-xxxx.iam.gserviceaccount.com`.
4. **Share the sheet with that email:** open the Google Sheet → *Share* → paste the service-account email → **Editor** → untick "Notify" → *Share*.
5. **Let it write locked cells:**
   1. In the sheet's Apps Script (`RE_RowLock_GoogleSheets.gs`), put the email in `CONFIG.APP_ACCOUNTS`, e.g. `APP_ACCOUNTS: ['re-app@re-showroom-xxxx.iam.gserviceaccount.com'],`.
   2. Save, then run **RE Admin → Set up (run once)** again.
   3. Without this step, saves fail with a "protected cell" message.
6. **Sign-in screen:** go to *APIs & Services → OAuth consent screen* (Google Auth Platform).
   1. Choose *External*, app name `RE Showroom`, and your email as support and developer contact.
   2. Under *Audience*, press **Publish app**. Basic sign-in (email and name) needs no Google review.
7. **Sign-in client ID:** go to *Credentials → Create credentials → OAuth client ID → Web application*.
   1. Name it `RE Showroom web`.
   2. Leave the origins empty for now: you add the Railway address in step 3.4.
   3. *Create* → copy the **Client ID** (`…apps.googleusercontent.com`).

---

## 3. Put it on Railway

### Option A: GitHub (recommended, auto-updates)

1. On github.com → **New repository** → name `re-showroom-app` → **Private** → *Create*.
2. On the new repo page, click **uploading an existing file**. Drag in everything inside this folder (not `node_modules`), then click *Commit changes*.
3. On https://railway.app → **New Project → Deploy from GitHub repo** → pick `re-showroom-app`.
   The first time, Railway asks to connect your GitHub account.
4. Open the service → **Settings → Networking → Generate Domain**. Copy the address, for example `https://re-showroom-app-production.up.railway.app`.
5. Back in Google Cloud, open the OAuth client from step 2.7. Under **Authorized JavaScript origins**, add that address (no trailing `/`) → *Save*.
6. In Railway → service → **Variables**, add:

   | Variable | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | open the downloaded `.json` file, copy everything, paste |
   | `GOOGLE_CLIENT_ID` | the Client ID from step 2.7 |
   | `SESSION_SECRET` | any long random text, 40+ characters |
   | `ADMIN_EMAILS` | your Gmail (always Admin) |
   | `SHEET_ID` | the long ID in your sheet's link (between `/d/` and `/edit`) |
   | `SHOWROOM_NAME` | e.g. `Pradhanaa Royal Enfield` |
   | `NODE_ENV` | `production` |

   Railway redeploys by itself. Open the address and sign in with Google.

### Option B: Railway CLI (from your computer)

```bash
npm i -g @railway/cli
cd re-showroom-app
railway login
railway init            # new project
railway up              # uploads and deploys this folder
railway domain          # gives you the https address
```

Then add the same Variables in the Railway dashboard (step 3.6) and the origin in Google (step 3.5).

### Custom domain (optional)

To use your own address, for example `app.yourshowroom.in`:

1. In Railway → *Settings → Networking → Custom Domain*, add the domain.
2. Create the CNAME record Railway shows you at your domain provider.
3. Add the same `https://app.yourshowroom.in` to the OAuth client's JavaScript origins.

---

## 4. Daily use

- **Add staff:** go to *Users* (Admin) → *Add user* → their Gmail and role.
  To also give them the sheet itself, run *RE Admin → Sync users & access* in the sheet.
- **Fix a saved entry (staff):** open the entry → *Request edit* → write the reason.
- **Approve (Admin):** go to *Edit Requests* → *Approve*.
- The sheet stays the master copy. You can keep working in the sheet and in the app at the same time.

## 5. Troubleshooting

| Message | Fix |
|---|---|
| "is not in the Users list" | Add the email in the Users tab (Active = Yes) |
| "The app cannot open the Google Sheet" | Share the sheet with the service-account email as Editor (2.4) |
| "The Google Sheet blocked this write" | Do step 2.5 (APP_ACCOUNTS + Set up) |
| Google button shows "origin not allowed" | Add the exact Railway address to Authorized JavaScript origins (3.5). It can take 5 minutes to apply. |
| Everyone is signed out after each deploy | Set `SESSION_SECRET` |

## Files

- `server.js`: API, Google sign-in, sessions
- `schema.js`: the sheet's columns, which ones you type and which ones are formulas
- `data.js`: rules: locks, approvals, edit log, ledger, dashboard
- `store.js`: Google Sheets access (or demo data)
- `index.html`, `app.js`, `style.css`: the web pages
- `demo-data.json`: sample data for demo mode
