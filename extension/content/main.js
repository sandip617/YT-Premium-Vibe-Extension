/**
 * Orchestrator — loaded last. Starts/stops features from settings and
 * fans out the shared events to them:
 *
 *   enable(settings)   feature switched on (or page loaded with it on)
 *   disable()          feature switched off — must undo everything it did
 *   onSettings(s)      settings changed while the feature is on
 *   onNavigate()       YouTube SPA navigation finished (yt-navigate-finish)
 *   onMutation()       DOM changed (ONE shared, throttled MutationObserver)
 *   onVideo(video)     the <video> element appeared or was replaced
 *
 * Every hook is optional. A crash in one feature never breaks the others.
 */
(async () => {
  const YTPV = globalThis.YTPV;
  const active = new Set();

  const safe = (feature, hook, ...args) => {
    try {
      const r = feature[hook]?.(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => console.warn(`[YT Vibe] ${feature.id}.${hook}`, e));
    } catch (e) {
      console.warn(`[YT Vibe] ${feature.id}.${hook}`, e);
    }
  };
  const each = (hook, ...args) => { for (const f of active) safe(f, hook, ...args); };

  // The main-world bridge is started by the manifest; just wait for it to answer.
  YTPV.connectBridge();

  let settings = await YTPVSettings.load();
  YTPV.settings = settings;

  /** Mirror a few flags where synchronous code (CSS / page bridge) can see them. */
  function mirrorFlags(s) {
    const strip = s.features.adBlocker && s.adBlock.stripPlayerAds;
    try { localStorage.setItem('ytpv-strip-ads', strip ? '1' : '0'); } catch (_) {}
    YTPV.page.call('setStripAds', { on: strip }).catch(() => {});
  }

  let lastVideo = null;

  function applySettings(s) {
    for (const f of YTPV.features) {
      const want = !!s.features[f.id];
      if (want && !active.has(f)) {
        active.add(f);
        safe(f, 'enable', s);
        if (document.body) {
          if (lastVideo) safe(f, 'onVideo', lastVideo);
          safe(f, 'onNavigate');
        }
      } else if (!want && active.has(f)) {
        active.delete(f);
        safe(f, 'disable');
      } else if (want) {
        safe(f, 'onSettings', s);
      }
    }
  }

  mirrorFlags(settings);
  applySettings(settings);

  YTPVSettings.onChange((s) => {
    settings = s;
    YTPV.settings = s;
    mirrorFlags(s);
    applySettings(s);
  });

  /* ---------------- Video element tracking ---------------- */

  function checkVideo() {
    const v = YTPV.getVideo();
    if (v && v !== lastVideo) {
      lastVideo = v;
      each('onVideo', v);
    }
  }

  /* ---------------- SPA navigation ---------------- */

  let lastNav = '';
  function navigated() {
    document.documentElement.toggleAttribute('ytpv-watch', YTPV.isWatchPage());
    const key = location.href;
    const now = Date.now();
    if (key === lastNav.split('@')[0] && now - Number(lastNav.split('@')[1]) < 600) return;
    lastNav = `${key}@${now}`;
    checkVideo();
    each('onNavigate');
  }
  document.addEventListener('yt-navigate-finish', navigated);
  document.addEventListener('yt-navigate-start', () => each('onNavigateStart'));

  /* ---------------- One shared, throttled MutationObserver ---------------- */

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      checkVideo();
      each('onMutation');
    }, 300);
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    navigated();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
