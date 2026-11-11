# YT Premium Vibe

A Safari Web Extension for macOS (Manifest V3) that makes YouTube feel premium.
It has 11 features in one extension, and each one can be turned on or off from a dark glass popup.

| # | Feature | What it does |
|---|---------|--------------|
| 1 | **Sponsor Skip** | Auto-skips sponsor segments (SponsorBlock), shows a toast with **Undo**, and marks segments on the progress bar |
| 2 | **Hide Shorts** | Removes Shorts from home, search, sidebar, subscriptions, channel tabs and the menu. Can open `/shorts/` links in the normal player |
| 3 | **Custom Speed** | `S` / `D` / `R` = slower / faster / reset, 0.25× to 4× in 0.25 steps, with an on-screen indicator. Can remember the speed per channel |
| 4 | **Smart Quality** | Highest quality in fullscreen, 720p in normal view. Switches instantly |
| 5 | **Picture-in-Picture** | Native-looking PiP button in the player controls |
| 6 | **Cinema Mode** | Softly blurs everything around the video. Hovering an area clears it |
| 7 | **Ad Blocker** | Network blocking, ad data removed before the player loads, ads fast-forwarded with auto-click on Skip, feed/banner ads hidden, ad-blocker warnings removed |
| 8 | **Volume Boost** | Up to 300% with a slider in the player. A limiter prevents distortion |
| 9 | **Download** | Best-quality video or audio only through yt-dlp, with progress on the button and *Show in Finder* when done |
| 10 | **AI Summary** | Gemini side panel: chapter-by-chapter study notes in **English or Bangla**, clickable timestamps, follow-up chat |
| 11 | **Auto Audio Track** | Picks dubbed audio in your order (default Bangla → Hindi → original) |

**Just want to install it?** Download the latest `YT-Premium-Vibe-for-Mac.zip` from
[Releases](../../releases) and follow `README-Setup-Guide.txt` inside. No Xcode needed.

---

## Build from source

Requirements: macOS 13+, the latest Safari, and Xcode. A paid Apple Developer account is **not** needed.

1. Open `YT Premium Vibe/YT Premium Vibe.xcodeproj` in Xcode.
2. Choose the **YT Premium Vibe** scheme and **My Mac**, then press **⌘R**.
3. In Safari:
   - **Settings → Advanced** → turn on **Show features for web developers**.
   - **Settings → Developer** → turn on **Allow unsigned extensions**. Safari turns this off every time it quits, so turn it on again after each restart.
   - **Settings → Extensions** → tick **YT Premium Vibe**.
   - Open youtube.com → click the toolbar icon → **Always Allow on This Website**.

The Xcode project points directly at the `extension/` folder. After editing code, press ⌘R again and reload YouTube.

**Keep it on after restarting your Mac:** extensions built without a signing team switch off whenever Safari quits.
If Xcode is signed in with your Apple ID (a free one is enough) and you have an *Apple Development* certificate,
run `./install-on-my-mac.sh`. It signs the app with your certificate and installs it in Applications.
Safari then treats the extension as signed, so it stays on and you don't need *Allow unsigned extensions*.

### AI Summary
Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then paste it in the panel (or in the popup).
The key is stored only in Safari's extension storage. It is sent only to Google's Gemini API.

- **⚡ Fast** (default) uses Flash-Lite and starts answering in a few seconds. **🧠 Smart** uses Flash with light thinking: more detail, but slower.
- Captions are used when available. Otherwise Gemini watches the video itself (badge: *Source: video*).

### Download
The first time you click **Download**, the extension downloads the official Python build of yt-dlp from GitHub. It verifies the file against the release's SHA-256 checksums and keeps it in its own container. The copy updates itself every two weeks.

- It needs **Python 3.10+**: Homebrew, `uv`, or `~/.local/bin/python3.1x` all work. If none is found, the extension offers a one-click **Copy setup command** that installs Homebrew, yt-dlp and ffmpeg.
- Without **ffmpeg**, videos are limited to the best single file (usually 720p). With it, you get full quality.
- A Homebrew `yt-dlp` is used if present.

> Only download videos you have the right to save.

---

## How it's built

```
extension/
├── manifest.json            Manifest V3
├── background.js            SponsorBlock lookups, Gemini streaming, native messaging, ad-rule toggle
├── shared/settings.js       default settings + storage helpers (popup, content and background)
├── page/bridge.js           runs in YouTube's own page ("world": "MAIN"): player API, ad-data removal, captions
├── content/
│   ├── lib.js               DOM helpers, toasts, native-style player and action-bar buttons
│   ├── bridge-client.js     talks to page/bridge.js
│   ├── main.js              starts/stops features; ONE throttled MutationObserver; SPA navigation
│   ├── styles.css           all injected styles (scoped, so turning a feature off removes them)
│   └── features/            one file per feature
├── popup/                   settings panel
└── rules/ad-rules.json      network ad-blocking rules (declarativeNetRequest)

YT Premium Vibe/             Xcode project (macOS app + Safari extension)
└── YT Premium Vibe Extension/SafariWebExtensionHandler.swift   runs yt-dlp via native messaging
```

- **One observer, not eleven.** Features implement small hooks (`enable`, `disable`, `onNavigate`, `onMutation`, `onVideo`, `onSettings`). A crash in one never affects the others.
- **CSS first.** Hiding Shorts and feed ads is pure CSS behind an attribute on `<html>`.
- **Live settings.** The popup writes to `browser.storage.local`, and open tabs react without a reload.
- **Trusted Types safe.** All injected UI is built with `createElement`, never `innerHTML`.
- **Sandboxed downloads.** yt-dlp runs inside the extension's sandbox. Its permissions are limited to the network, your home folder, and Homebrew/Python installs.

## Sharing a build

`./make-friend-package.sh` builds a universal app (Apple Silicon + Intel) and writes
`dist/YT-Premium-Vibe-for-Mac.zip` with the setup guide included.
The app is signed for local use only, so on another Mac it must be allowed once in
**System Settings → Privacy & Security → Open Anyway**. Removing that step requires a paid Developer ID and notarization.

## Troubleshooting

| Problem | Fix |
|---|---|
| Not listed in Safari Extensions | Open the app once, and check that **Allow unsigned extensions** is on |
| Disappeared after restarting Safari | Turn **Allow unsigned extensions** back on |
| No buttons on YouTube | Safari → Settings → Websites → Extensions → YT Premium Vibe → youtube.com → **Allow**, then reload |
| A video won't play | Popup → Ad Blocker → turn off **Remove ads from player data**. Also avoid running two ad blockers at once |
| AI: "API key is not valid" | Create a new key at aistudio.google.com/apikey |
| AI: rate limit | The free tier allows a limited number of requests per minute. Wait and retry |

See [TESTING.md](TESTING.md) for a per-feature checklist.
