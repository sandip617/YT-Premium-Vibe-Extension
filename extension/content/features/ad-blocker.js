/**
 * FEATURE 7 — Ad Blocker
 *
 * Four layers, so if YouTube changes one thing the others still work:
 *   1. Network rules (rules/ad-rules.json) block ad servers and trackers.
 *   2. page/bridge.js removes ad data from the player before it loads.
 *   3. If a video ad still starts: mute it, fast-forward it to the end,
 *      and click "Skip" the moment it appears.
 *   4. CSS hides banner/feed/sidebar ads, and the ad-blocker warning
 *      popup is removed while the video is resumed.
 */
(() => {
  const YTPV = globalThis.YTPV;

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
    'button[id^="skip-button"]',
    '.ytp-ad-overlay-close-button'
  ].join(',');

  let playerObserver = null;
  let observedPlayer = null;
  let adLoop = null;
  let inAd = false;
  let saved = { muted: false, rate: 1 };
  let wasPlaying = false;

  function clickSkip() {
    for (const b of document.querySelectorAll(SKIP_SELECTORS)) {
      try { b.click(); } catch (_) {}
    }
  }

  function fastForward() {
    const v = YTPV.getVideo();
    if (!v) return;
    v.muted = true;
    try { v.playbackRate = 16; } catch (_) { v.playbackRate = 4; }
    if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.2) {
      v.currentTime = v.duration - 0.1;
    }
  }

  function onAdState() {
    const showing = YTPV.isAdShowing();
    const v = YTPV.getVideo();
    if (showing && !inAd) {
      inAd = true;
      YTPV.adActive = true;
      if (v) saved = { muted: v.muted, rate: v.playbackRate > 4 ? 1 : v.playbackRate };
      clickSkip();
      fastForward();
      // Keep pushing until the ad is gone (some ads need a few attempts).
      adLoop = setInterval(() => {
        if (!YTPV.isAdShowing()) return onAdState();
        clickSkip();
        fastForward();
      }, 250);
    } else if (!showing && inAd) {
      inAd = false;
      YTPV.adActive = false;
      clearInterval(adLoop);
      adLoop = null;
      if (v) {
        v.muted = saved.muted;
        v.playbackRate = saved.rate;
      }
      document.dispatchEvent(new CustomEvent('ytpv-ad-end'));
    }
  }

  function watchPlayer() {
    const player = YTPV.getPlayer();
    if (!player || player === observedPlayer) return;
    playerObserver?.disconnect();
    observedPlayer = player;
    // Cheap: only watches the class attribute of one element.
    playerObserver = new MutationObserver(onAdState);
    playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    onAdState();
  }

  /** Remove "Ad blockers are not allowed" popups and resume playback. */
  function killEnforcement() {
    const msg = document.querySelector('ytd-enforcement-message-view-model');
    if (!msg) return;
    const dialog = msg.closest('tp-yt-paper-dialog') || msg;
    dialog.remove();
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
    document.body.style.removeProperty('overflow');
    const v = YTPV.getVideo();
    if (v && v.paused && wasPlaying) v.play().catch(() => {});
    YTPV.toast('Blocked an ad-blocker warning', { duration: 2500 });
  }

  const trackPlaying = () => {
    const v = YTPV.getVideo();
    if (v) wasPlaying = !v.paused;
  };

  YTPV.register({
    id: 'adBlocker',

    enable() {
      document.documentElement.setAttribute('ytpv-adblock', '');
      this.playTimer = setInterval(trackPlaying, 1000);
    },

    disable() {
      document.documentElement.removeAttribute('ytpv-adblock');
      playerObserver?.disconnect();
      playerObserver = observedPlayer = null;
      clearInterval(adLoop);
      clearInterval(this.playTimer);
      if (inAd) { inAd = false; YTPV.adActive = false; }
    },

    onNavigate() { watchPlayer(); },

    onMutation() {
      watchPlayer();
      killEnforcement();
      if (inAd) clickSkip();
    }
  });
})();
