# Design CRM

A lightweight, static CRM for a design & branding subscription company. Runs entirely in the browser — no server required. Host for free on GitHub Pages.

---

## Features

- **Lead pipeline** with 7 stages (Not Contacted → Closed Won/Lost)
- **Kanban board** overview on the dashboard
- **Email templates** with smart placeholders (`{{name}}`, `{{company}}`, `{{sender}}`)
- **Send emails** directly from the CRM via Gmail API (OAuth, no password needed)
- **Reply detection** — one-click check scans Gmail threads for replies and auto-updates lead status
- **Activity history** per lead
- **CSV import** — drop your existing lead spreadsheet (export to CSV first)
- **JSONBin.io storage** — free cloud JSON database, with automatic localStorage backup
- **Export** all data as JSON anytime

---

## Quick Start (Local)

Just open `index.html` in your browser. Everything works offline with localStorage — no setup needed for basic use.

---

## Full Setup (Gmail + Cloud Storage)

### 1. JSONBin.io (free cloud storage)

1. Go to [jsonbin.io](https://jsonbin.io) and create a free account
2. Create a new **Bin** — paste `{"leads":[],"templates":[]}` as the initial content
3. Copy your **Master API Key** (Account → API Keys)
4. Copy the **Bin ID** from the bin URL (the long hex string)
5. In the CRM → **Settings**, paste both values and click **Save Settings**
6. Click **Test Connection** to verify

### 2. Gmail API (send & read emails)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Design CRM")
3. Enable **Gmail API** (APIs & Services → Library → search "Gmail API")
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add your domain to **Authorized JavaScript origins**:
   - For local use: `http://localhost` and `http://127.0.0.1`
   - For GitHub Pages: `https://yourusername.github.io`
7. Copy the **Client ID** (ends in `.apps.googleusercontent.com`)
8. In the CRM → **Settings**, paste it and click **Save Settings**
9. Click **Connect Gmail** in the sidebar — a Google popup will ask for permission

> Gmail OAuth tokens last 1 hour. Click **Connect Gmail** again if it disconnects.

### 3. Sender Info

In Settings, fill in your **Name** and **Email** — these appear as the From address in outgoing emails.

---

## Host on GitHub Pages

1. Push this folder to a GitHub repository
2. Go to repository **Settings → Pages**
3. Source: **Deploy from branch → main → / (root)**
4. Your CRM will be live at `https://yourusername.github.io/repo-name`
5. Add that URL to your Google OAuth **Authorized JavaScript origins**

---

## CSV Import

Export your Excel lead lists as CSV (File → Save As → CSV), then use the **Import CSV** button on the Leads page.

**Expected columns** (column names are flexible, matched by keyword):
| Column | Matched by |
|---|---|
| Company name | `company` or `name` |
| Contact person | `contact` or `person` |
| Email | `email` ✱ required |
| Phone | `phone` |
| Website | `website` |
| Source | `source` |

Duplicate emails are automatically skipped.

---

## Email Placeholders

Use these in template subjects and bodies:

| Placeholder | Replaced with |
|---|---|
| `{{name}}` | Contact person's name (falls back to company name) |
| `{{company}}` | Company name |
| `{{sender}}` | Your name (from Settings) |

---

## Lead Statuses

| Status | Meaning |
|---|---|
| Not Contacted | Lead added, no outreach yet |
| Contacted | Email sent, awaiting reply |
| Replied | Lead replied (auto-detected or manual) |
| Proposal Sent | Proposal delivered |
| Negotiating | In active discussion |
| Closed Won | Deal closed! |
| Closed Lost | Passed or unresponsive |

---

## Data Storage

- **Primary**: JSONBin.io (synced to cloud, accessible from any device)
- **Backup**: Browser localStorage (automatic, works offline)
- Settings are always stored in localStorage only (never sent to JSONBin)
