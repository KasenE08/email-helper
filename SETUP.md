# Setup: connect your Gmail

About 10 minutes, once. Do this on a **computer**, because the Apps Script editor is hard to use on a phone.
Nothing here costs money. The script runs in your own Google account and only **reads** Gmail.

You'll create one Apps Script project with 3 files:

| File in Apps Script | What to paste |
|---|---|
| `appsscript.json` | [`apps-script/appsscript.json`](apps-script/appsscript.json) |
| `Code.gs` | [`apps-script/dist/EmailHelper.gs`](apps-script/dist/EmailHelper.gs) (everything in one file) |
| `Config.gs` | your **private** config: the one Claude sent you, or a copy of [`Config.example.gs`](apps-script/Config.example.gs) with your info |

Tip: on GitHub, open a file and click the **Copy raw file** button (two squares) at the top right of the file view.

---

## 1. Create the project
1. Go to **https://script.google.com** and sign in with the Gmail account you want sorted.
2. Click **New project**.
3. Click **Untitled project** at the top and rename it **Email Helper**.

## 2. Paste the manifest (turns on the Gmail service + permissions)
1. Click the **gear icon** (Project Settings) on the left.
2. Tick **Show "appsscript.json" manifest file in editor**.
3. Click the **< >** icon (Editor) on the left. Open **appsscript.json**.
4. Select everything, delete it, and paste the contents of `apps-script/appsscript.json`.

## 3. Paste the code
Each paste goes into its **own file**: click the file's name in the **Files** list on the left first.
Don't put the code inside `appsscript.json`.

1. Click **Code.gs** in the Files list. Select everything, delete it, and paste the contents of `apps-script/dist/EmailHelper.gs`.
2. Click the **+** next to "Files" and choose **Script**. Name it **Config** (it becomes `Config.gs`).
3. Delete what's in it and paste your private config.
4. Press **Ctrl+S** / **⌘S** to save.

When you're done, the Files list shows exactly three files:
```
appsscript.json   ← settings only
Code.gs           ← the big EmailHelper.gs paste
Config.gs         ← your private config
```

## 4. Run setup (creates your secret token)
1. In the toolbar function dropdown (next to **Debug**), pick **setup** and click **Run**.
2. Google asks for permission. Click **Review permissions**, then pick your account.
3. You'll see **"Google hasn't verified this app"**. That's normal for your own script. Click **Advanced**, then **Go to Email Helper (unsafe)**, then **Allow**.
   - It asks to *read* your email and to *create a spreadsheet* (where it stores its sorting data).
4. The **Execution log** opens at the bottom and shows **YOUR TOKEN**. Copy it somewhere safe; you'll paste it into the app.

## 5. (Optional) Check it works
- Pick **testRules** and click **Run**. The log should end with `All passed`.
- Pick **previewMyInbox** and click **Run**. It scans your inbox (up to ~5 min) and logs where every email landed, sorted by section. If something's in the wrong place, adjust `Config.gs` or tell Claude.

## 6. Deploy as a web app
1. Click **Deploy** (top right), then **New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**. The app has no Google sign-in, so it needs this. Your token is the lock: without it, every request is refused.
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

## 7. Connect the app
1. Open the app on your iPhone, then tap **⚙︎ Settings**.
2. Paste the **Script URL** and the **Token**, and type your Gmail address.
3. Tap **Test connection**. It should say **✓ Connected**. If not, the message says what to fix.
4. Turn **Demo data** off and tap **Save**. The first refresh starts on its own: it reads ~60 days of inbox in chunks
   and shows "Processing inbox… x/y". After that, refreshes only read what changed.
5. Tap any card to read the full email in the app. **Open Gmail** copies the subject and opens the Gmail app,
   so you can paste it into Gmail search when you need to reply.

---

## Updating the code later
When the code changes, paste the new `EmailHelper.gs` into `Code.gs`, save, then:

**Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.**

The URL stays the same. If you skip this, the app keeps running the old version.

## Changing your lists
Edit `Config.gs` in Apps Script (family, counselor, whitelist, junk senders…), save, then **Deploy → Manage deployments → ✏️ → New version → Deploy**.
The next Refresh automatically re-sorts everything with the new rules.

## Handy functions (pick one in the dropdown, then click Run)
| Function | What it does |
|---|---|
| `setup` | Creates the token and data sheet (safe to re-run; it keeps your token) |
| `newToken` | Makes a new token (the old one stops working). Paste the new one into the app. |
| `testRules` | Runs the built-in sample emails through the rules |
| `previewMyInbox` | Shows where each of your real emails lands |
| `rescan` | Forgets the cache so the next refresh re-reads everything (hidden cards stay hidden) |

## Troubleshooting
- **"bad-token" in the app:** the token in the app doesn't match. Run `setup` again and copy the token from the log.
- **App still behaves the old way after a code change:** you didn't make a **New version** in Manage deployments.
- **"Exceeded maximum execution time":** lower `CHUNK_SECONDS` in `Config.gs` (e.g. 25).
- **Want to start over:** delete the "Email Helper Data" spreadsheet from Google Drive and run `setup`.
