# Testing checklist

Do these on `https://www.youtube.com` in Safari, after enabling the extension (see README §3).
Tip: also test once **after navigating between videos without reloading**. That's the case YouTube's single-page app usually breaks.

## General
- [ ] Toolbar icon opens the popup. All 11 cards are shown with toggles, and "N of 11 features active" is correct.
- [ ] Toggle any feature → a green **Saved** pill appears → the YouTube tab reacts **without reloading**.
- [ ] Close and reopen the popup → settings are still there.
- [ ] Click from video A → B → C (suggestions, no reload): buttons stay, nothing appears twice.
- [ ] YouTube still feels as fast as before (scrolling home feed, opening videos).

## 1. Sponsor Skip
- [ ] Open a video known to have sponsors (most big tech/education channels). Green marks appear on the progress bar.
- [ ] At a sponsor segment the video jumps forward, and a **"Sponsor skipped"** toast appears with **Undo**.
- [ ] Click **Undo** → video goes back and plays the segment (it isn't skipped again).
- [ ] Popup → Sponsor Skip ⌄ → enable *Self-promo* → its yellow segments now skip too.

## 2. Hide Shorts
- [ ] Home: no Shorts shelf. Left menu: no "Shorts" entry (also in the collapsed mini menu).
- [ ] Search "funny cats": no Shorts shelf or Shorts results. The "Shorts" filter chip is hidden.
- [ ] Subscriptions page: no Shorts. Watch page sidebar: no Shorts.
- [ ] A channel page: no "Shorts" tab.
- [ ] Open a `youtube.com/shorts/<id>` link → it opens in the normal player (`/watch?v=<id>`).
- [ ] Toggle off → Shorts come back immediately.

## 3. Custom Speed
- [ ] Press **D** repeatedly → 1.25×, 1.5× … up to **4×** (stops there). Glass indicator shows in the player.
- [ ] Press **S** → down to **0.25×** (stops there). Press **R** → back to 1×.
- [ ] Typing **d/s/r** in the YouTube search box or a comment does **not** change speed.
- [ ] Set 1.75× on channel X → open another video from channel X → starts at 1.75×. A video from channel Y → 1×.
- [ ] Popup → change the "Faster" key to `]` → it works on YouTube immediately.
- [ ] Change speed using YouTube's own ⚙ menu → it's kept (not reset).

## 4. Smart Quality
- [ ] Normal view: ⚙ → Quality shows **720p**. A small "Normal view · 720p" toast appears.
- [ ] Press **F** (fullscreen) → switches to the highest (e.g. 1080p/1440p/4K) with a toast.
- [ ] Exit fullscreen → back to 720p.
- [ ] A video whose max is 480p → stays at 480p in normal view (no error).
- [ ] Popup → Normal view = 1080p → takes effect on the current video.

## 5. Picture-in-Picture
- [ ] A PiP icon appears in the player's bottom-right controls and matches YouTube's style.
- [ ] Click → video floats in a PiP window. Click again (or close the PiP window) → back in the page.
- [ ] Move to another video → button is still there and works.

## 6. Cinema Mode
- [ ] Turn on → in normal watch view the header, sidebar, area under the video and side margins are softly blurred and dimmed. The video stays sharp.
- [ ] Hover the sidebar → it smoothly un-blurs. Hover the title/comments area → that clears. Move back over the video → everything blurs again.
- [ ] Clicks on blurred areas still work (e.g. click a suggestion).
- [ ] Scroll down to comments (video off screen) → blur disappears.
- [ ] Fullscreen → no blur. Theater mode → blur follows the bigger player.
- [ ] Popup → Blur strength / Dim sliders change it live.

## 7. Ad Blocker
- [ ] Play several videos (ideally signed out or on a new channel): no pre-roll ads. If one starts, it's muted and skipped within about a second.
- [ ] Mid-roll positions in long videos: no ads, or instantly skipped.
- [ ] Home feed / search: no "Sponsored" cards or banner/masthead ads. Watch page: no ad above suggestions.
- [ ] If YouTube shows an "Ad blockers are not allowed" popup → it's removed automatically and the video keeps playing (toast: "Blocked an ad-blocker warning").
- [ ] Toggle off → network rules disabled (ads may appear again on the next video).

## 8. Volume Boost
- [ ] A speaker icon with **100%** sits next to YouTube's volume control.
- [ ] Click it → glass popover with slider and 100/150/200/300% presets. Clicks inside don't pause the video.
- [ ] Set 200% → clearly louder. Set 300% on loud music → louder but **no crackling/clipping**.
- [ ] Scroll the mouse wheel over the button → changes in 10% steps.
- [ ] Back to 100% → normal sound. Reload the page with a saved boost >100% → boost applies after your first click or keypress (Safari requires a gesture for audio).

## 9. Download
- [ ] A **Download** pill appears above the Like / Share row, the same width as that row.
- [ ] Click → menu: *Best quality video* / *Audio only*, with the save folder shown.
- [ ] First time only: "Setting up the downloader…" appears. yt-dlp is fetched and checksum-verified automatically.
- [ ] Best quality video → progress (%) on the button → "Finishing…" → **"Done ✓ filename"** → **Show in Finder** highlights the file.
- [ ] Audio only → `.m4a` (or `.mp3` if chosen) appears in the folder.
- [ ] Popup → folder `~/Movies/YouTube` → next download goes there (created automatically).
- [ ] Click the pill during a download → **Cancel download** → "Download cancelled".
- [ ] Bangla/Hindi title → the filename keeps the original script.
- [ ] Popup → Download → **Test yt-dlp** shows "✓ yt-dlp … ready".
- [ ] On a Mac without Python 3.10+: a "One-time setup" toast with **Copy setup command** appears.

## 10. AI Summary
- [ ] With **no API key**: click **✦ AI Summary** → panel slides in from the right with a "Connect Google Gemini" card. Paste the key → *Save & summarize* starts.
- [ ] With a key: summary streams in: *In one line → Chapter by chapter (with timestamps) → Key terms → Key takeaways → Exam practice*.
- [ ] Badge shows **Source: captions**. Click a timestamp → the video jumps there.
- [ ] Switch to **বাংলা** → a new summary in simple Bangla. Switch back to English → the earlier English summary shows instantly (cached).
- [ ] Ask "explain chapter 2 in Bangla" → answer in Bangla. Quick chips (*Make it simpler*, *Quiz me*) work.
- [ ] Press the send button while it's answering → it stops (acts as Stop).
- [ ] Typing in the chat box doesn't trigger YouTube shortcuts (K, F, M, J/L) or speed keys. **Esc** closes the panel.
- [ ] Video without captions (e.g. a music video with no subs) → "No transcript found. Asking Gemini to watch the video…" → summary arrives. Badge: **Source: video**.
- [ ] Wrong key → "Your Gemini API key is not valid" card with a key field.
- [ ] Spam requests quickly → rate-limit message "Wait a minute and try again" with **Try again**.
- [ ] Turn off Wi-Fi → "No connection"-style error, no crash.
- [ ] Open another video while the panel is open → panel shows "New video · Summarize this video" (it doesn't spend quota automatically).

## 11. Auto Audio Track
- [ ] Find a video with multiple audio tracks (⚙ → *Audio track* exists; e.g. MrBeast videos have Hindi and others).
- [ ] With Bangla available → switches to Bangla, toast "Audio track: Bangla".
- [ ] With Hindi but no Bangla → switches to Hindi.
- [ ] With neither → original audio stays.
- [ ] Popup → move **English** to the top and enable it → next such video uses English.
- [ ] After auto-selection, choose a different track yourself → it isn't overridden for that video.
