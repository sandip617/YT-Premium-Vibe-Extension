/**
 * FEATURE 4 — Smart Quality
 *
 * Fullscreen      → highest available quality.
 * Normal page view → 720p (configurable), or the closest lower quality.
 * Switches as soon as you enter/exit fullscreen.
 */
(() => {
  const YTPV = globalThis.YTPV;

  // YouTube's internal quality names, highest first.
  const ORDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const LABEL = {
    highres: '8K', hd2880: '5K', hd2160: '4K', hd1440: '1440p', hd1080: '1080p',
    hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p'
  };

  let lastMode = null;
  let lastVideoId = null;
  let applying = false;
  let resizeTimer = null;
  let lastWanted = null;

  function pickTarget(levels, fullscreen) {
    const available = levels.filter((l) => l !== 'auto' && ORDER.includes(l));
    if (!available.length) return null;
    available.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (fullscreen) return available[0];
    const wanted = YTPV.settings.quality.normal || 'hd720';
    // Exact match, otherwise the best quality that is not above the wanted one.
    return available.find((l) => ORDER.indexOf(l) >= ORDER.indexOf(wanted)) || available[available.length - 1];
  }

  async function apply(force = false) {
    if (!YTPV.isWatchPage() || applying || YTPV.adActive) return;
    const fullscreen = YTPV.isFullscreen();
    const mode = fullscreen ? 'fs' : 'normal';
    const vid = YTPV.getVideoId();
    if (!force && mode === lastMode && vid === lastVideoId) return;
    applying = true;
    try {
      // Quality levels appear a moment after the video starts loading.
      for (let i = 0; i < 12; i++) {
        const { levels, current } = await YTPV.page.call('qualityLevels');
        const target = pickTarget(levels || [], fullscreen);
        if (target) {
          if (current !== target) {
            await YTPV.page.call('setQuality', { quality: target });
            YTPV.toast(`${fullscreen ? 'Fullscreen' : 'Normal view'} · ${LABEL[target] || target}`, {
              id: 'quality', duration: 1800
            });
          }
          lastMode = mode;
          lastVideoId = vid;
          break;
        }
        await YTPV.sleep(500);
      }
    } catch (e) {
      console.warn('[YT Vibe] quality', e);
    } finally {
      applying = false;
    }
  }

  const onFullscreen = () => setTimeout(() => apply(), 150);
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => apply(), 400);
  };
  const onLoaded = () => apply(true);
  let video = null;

  YTPV.register({
    id: 'smartQuality',
    enable(s) {
      lastWanted = s.quality.normal;
      document.addEventListener('fullscreenchange', onFullscreen);
      document.addEventListener('webkitfullscreenchange', onFullscreen);
      window.addEventListener('resize', onResize, { passive: true });
      document.addEventListener('ytpv-ad-end', onLoaded);
    },
    disable() {
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('ytpv-ad-end', onLoaded);
      video?.removeEventListener('loadeddata', onLoaded);
      video = null;
      lastMode = lastVideoId = null;
    },
    onSettings(s) {
      if (s.quality.normal !== lastWanted) { lastWanted = s.quality.normal; apply(true); }
    },
    onVideo(v) {
      video?.removeEventListener('loadeddata', onLoaded);
      video = v;
      video.addEventListener('loadeddata', onLoaded);
    },
    onNavigate() { lastVideoId = null; apply(true); }
  });
})();
