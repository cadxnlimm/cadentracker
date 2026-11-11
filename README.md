# Caden Tracker

A private personal tracker for **money**, **to-dos & reminders**, **Google Calendar**, and **trainings**, with a morning brief of what's due today and this week.

It's a web app you can install on your phone's home screen and also open on your laptop. There's no server, no account and no database in the cloud. Everything you enter is **encrypted on your device** with a passphrase only you know.

## What it does

| Section | Features |
|---|---|
| **Today** | Morning brief: overdue and today's to-dos, today's calendar events, this week's to-dos, trainings and bills, and the month's money snapshot. Quick-add a to-do. |
| **Money** | Log income (one-off or monthly). Savings budgets with a monthly amount, a goal and progress. Bills & subscriptions with weekly/monthly/yearly cycles, a "Paid" button that rolls the due date forward, and monthly/yearly totals. **Spending is logged automatically from your DBS/POSB alert emails** (card, PayNow, PayLah!), sorted into categories you can correct (the app remembers your corrections). Cash can be added by hand, or paste any DBS alert text. "Left to spend" = income − bills − savings − spending. |
| **To-dos** | To-dos with due date/time, notes and reminders. You can push any to-do to Google Calendar or download it as an `.ics` file. |
| **Training** | Each programme tracks group/trainees, current lesson out of total, next session, notes and a lesson history. "Lesson done" logs it, moves to the next lesson and asks for the next date. |
| **Calendar** | Connect Google Calendar to see the next 7 days and add events (with a reminder) when you want to. |
| **Settings** | Currency, morning brief time, auto-lock, notifications, encrypted backup export/import, change passphrase, erase device. |

## Privacy model

- **Encrypted at rest.** Data is encrypted with AES-256-GCM using a key derived from your passphrase (PBKDF2-SHA256, 600,000 iterations). Only ciphertext is written to the browser's storage. The passphrase and key are never saved.
- **No backend.** The code in this repo is static files. Whoever hosts them (e.g. GitHub Pages) only serves code. They never receive your data.
- **Auto-lock.** After a set idle time (10 min by default) the key is wiped from memory and you have to unlock again.
- **Strict Content-Security-Policy.** The page can only run its own scripts and talk to Google's Calendar API. It can't send data anywhere else.
- **Google Calendar is opt-in.** Google's sign-in script only loads when you press *Connect*. Calls go straight from your browser to Google. The access token lives in memory only and expires within an hour. Events you put in Google Calendar are, of course, stored by Google.
- **DBS spending import is opt-in and read-only.** When you press *Connect Gmail & import*, the app asks Gmail (straight from your device) only for emails from `ibanking.alert@dbs.com` and `paylah.alert@dbs.com`. Each email must pass the DMARC check that Google's own mail servers stamped on it for `dbs.com`, so a fake "DBS" email can't add expenses. The email is read in memory and only the amount, payee, date and payment type are kept, encrypted. No bank login, no aggregator, no server. Google's consent screen says "read your email" because Gmail has no narrower permission; the app's code only ever searches for those two senders.
- **No recovery.** If you forget your passphrase, nobody can recover the data, including you. Export a backup now and then.

> Code vs data: it's fine for this repo to be public because it holds **only code**, never your data. If you'd rather keep the code private too, see "Hosting from a private repo" below.

## Phone ↔ laptop

Each device keeps its own encrypted copy. To move data, open **Settings → Export encrypted backup** on one device and **Import backup** on the other. The `.ctbackup` file can't be read without your passphrase, so AirDrop, a USB drive or your own cloud storage are all fine.

## Reminders: what to expect

Web apps can't wake themselves up to run code without a server, and this app has no server on purpose. So:

- **While the app is open and unlocked**, it pops up reminders for to-dos, a heads-up 1 hour before training sessions, and the morning brief at the time you choose (the first time you open it after that hour).
- **For reminders when the app is closed**, tick **"Also add to Google Calendar"** on a to-do (or press **+ Cal** / **+ Google Cal**). The event gets a popup reminder, so your phone's Google Calendar notifies you.
- On iPhone, notifications only work once the app is **added to the Home Screen** (iOS 16.4+).

## Setup

### 1. Host it with GitHub Pages (free)

1. In this repo on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
2. After a minute your app is at **https://cadxnlimm.github.io/cadentracker/**.

The page is public but shows nothing except a lock screen. Your data is only ever on your own devices.

### 2. Install it

- **iPhone (Safari):** open the link → Share → **Add to Home Screen**.
- **Android (Chrome):** open the link → ⋮ → **Install app**.
- **Laptop (Chrome / Edge):** open the link → click the install icon in the address bar (or just bookmark it).

On first launch, create your passphrase.

### 3. Connect Google Calendar (optional, ~5 minutes)

The app uses your **own** Google Cloud OAuth client, so no third-party app ever sits between you and your calendar.

1. Go to <https://console.cloud.google.com/> and create a project (e.g. "Caden Tracker").
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **Google Auth Platform → Branding / Audience** (the "OAuth consent screen"): choose **External**, fill in the app name and your email. Leave it in **Testing** and add your own Gmail under **Test users**.
4. **Google Auth Platform → Clients → Create client** → **Web application**. Under **Authorised JavaScript origins** add:
   - `https://cadxnlimm.github.io`
   - `http://localhost:8000` (only if you'll run it locally)
5. Copy the **Client ID** (`…apps.googleusercontent.com`) into the app's **Settings → Google OAuth Client ID**, save, then press **Connect Google Calendar**.

Google will warn that the app is unverified. That's expected because it's your own unpublished app; click **Continue**. Calendar asks only for `calendar.events` (read and create events).

### 4. Log DBS spending automatically (optional, ~5 minutes)

1. **Get an email for every payment.** In the DBS digibank app: **More → Manage Alerts**.
   - **Cards:** set the alert threshold to **S$0.01** and tick **Email**.
   - **Funds transfer / PayNow:** set the lowest threshold and tick **Email**.
   - **PayLah!:** in the PayLah! app, turn on **Outgoing Payments** email alerts and set the lowest threshold.
2. **Turn on the Gmail API** in the same Google Cloud project: **APIs & Services → Library → Gmail API → Enable**.
3. In the app, open **Money → Connect Gmail & import**. The first import covers this month. After that, the app checks for new alerts every 10 minutes while it's open and unlocked. After you lock the app, tap **Import new DBS spending** once to reconnect.

Recurring GIRO payments don't send alerts, so keep those under **Bills & subscriptions**. If a payee matches one of your bills, the app files it as "Already in Bills list" so it isn't counted twice.

### Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

### Hosting from a private repo

GitHub Pages on a private repo needs a paid GitHub plan. Free alternatives that deploy from a private repo: **Cloudflare Pages** or **Netlify** (connect the repo, no build command, output directory `/`). Add that site's URL to the Google OAuth "Authorised JavaScript origins".

## Project structure

```
index.html            App shell + Content-Security-Policy
css/styles.css        Mist Blue neumorphism styles (floating bottom nav on phone, sidebar on laptop)
js/crypto.js          PBKDF2 + AES-GCM encryption
js/store.js           Encrypted IndexedDB vault, backups
js/gcal.js            Google Calendar (direct from browser) + .ics export
js/gmail.js           Reads DBS alert emails from Gmail (DBS senders only, DMARC-verified)
js/expenses.js        Parses DBS alerts, auto-categorises spending
tests/                node tests/expenses.test.mjs
js/views.js           Screens
js/app.js             Lock screen, actions, reminders, morning brief, auto-lock
js/util.js            Date and money helpers
sw.js                 Offline cache + notification clicks
manifest.webmanifest  Install-to-home-screen metadata
```

No build step and no dependencies.
