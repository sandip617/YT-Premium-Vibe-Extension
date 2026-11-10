YT Premium Vibe — Setup Guide
=============================

Makes YouTube feel premium in Safari: ad blocking, sponsor skip, no Shorts,
AI summaries (English/Bangla), downloads, volume boost, Picture-in-Picture and more.

You need: macOS 13 or newer and an up-to-date Safari.
Works on Apple Silicon (M1–M4) and Intel Macs.


STEP 1 — Put the app in Applications
------------------------------------
Unzip the file and drag "YT Premium Vibe.app" into your Applications folder.


STEP 2 — Open it once
---------------------
The app isn't signed with a paid Apple Developer ID, so macOS blocks it the first time.

  Option A (no Terminal):
    1. Double-click the app. When macOS says it can't be opened, click Done/OK.
    2. Open System Settings → Privacy & Security, scroll down, and next to
       "YT Premium Vibe was blocked…" click "Open Anyway". Enter your password, then click Open.

  Option B (Terminal):
    Paste this into Terminal, press Enter, then open the app:
      xattr -dr com.apple.quarantine "/Applications/YT Premium Vibe.app"

A small window opens. That's expected. You can close it.


STEP 3 — Turn it on in Safari
-----------------------------
  1. Safari → Settings → Advanced → tick "Show features for web developers".
  2. Safari → Settings → Developer → tick "Allow unsigned extensions" (asks for your password).
  3. Safari → Settings → Extensions → tick "YT Premium Vibe".
  4. Open youtube.com, click the new toolbar icon, choose "Always Allow on This Website",
     then reload the page.

  Note: Safari turns "Allow unsigned extensions" off every time it quits (⌘Q).
  After restarting Safari, just repeat item 2. Your settings are kept.


STEP 4 — AI Summary (free)
--------------------------
  1. Go to https://aistudio.google.com/apikey and sign in with your Google account.
  2. Click "Create API key" and copy it.
  3. On any YouTube video, click "AI Summary", paste the key, and click "Save & summarize".
  The key stays on your Mac. Click "বাংলা" at the top of the panel for summaries in Bangla.


STEP 5 — Download (one-time setup)
----------------------------------
Click "Download" under a video. The first time, the extension sets up its downloader by itself.

If you see a "One-time setup" message instead:
  1. Click "Copy setup command" in that message.
  2. Open Terminal, paste, and press Enter. It may ask for your password and take 5–10 minutes.
  3. Click Download again on YouTube.

Files are saved to your Downloads folder. You can pick another folder in the settings popup.


SETTINGS
--------
Click the toolbar icon to switch each feature on or off.
Speed shortcuts: S = slower, D = faster, R = normal.


TROUBLESHOOTING
---------------
• Not in the Extensions list → open the app once, and check "Allow unsigned extensions" is on.
• No buttons on YouTube → Safari → Settings → Websites → Extensions → YT Premium Vibe →
  set youtube.com to "Allow", then reload.
• A video won't play while another ad blocker (e.g. uBlock) is on → turn one of them off.
