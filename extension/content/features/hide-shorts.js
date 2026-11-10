/**
 * FEATURE 2 — Hide Shorts
 *
 * Mostly pure CSS (see styles.css, rules under html[ytpv-hide-shorts]),
 * which costs nothing at runtime. JS only handles:
 *   - the "Shorts" filter chip on search/home (matched by its text)
 *   - redirecting /shorts/ID links to the normal /watch?v=ID player
 */
(() => {
  const YTPV = globalThis.YTPV;

  function hideShortsChips() {
    for (const chip of document.querySelectorAll('yt-chip-cloud-chip-renderer:not([ytpv-checked]), chip-view-model:not([ytpv-checked])')) {
      chip.setAttribute('ytpv-checked', '');
      if (chip.textContent.trim().toLowerCase() === 'shorts') chip.setAttribute('ytpv-shorts', '');
    }
  }

  function redirectShorts() {
    if (!YTPV.settings.shorts.redirect) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
    if (m) location.replace(`/watch?v=${m[1]}`);
  }

  YTPV.register({
    id: 'hideShorts',
    enable() {
      document.documentElement.setAttribute('ytpv-hide-shorts', '');
      redirectShorts();
    },
    disable() {
      document.documentElement.removeAttribute('ytpv-hide-shorts');
      document.querySelectorAll('[ytpv-shorts]').forEach((n) => n.removeAttribute('ytpv-shorts'));
    },
    onNavigate() { redirectShorts(); hideShortsChips(); },
    onMutation() { hideShortsChips(); }
  });
})();
