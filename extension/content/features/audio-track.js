/**
 * FEATURE 11 — Auto Audio Track
 *
 * When a video has several audio tracks (dubbed versions), pick the first
 * language from your priority list (default: Bangla → Hindi). If none of
 * them exist, the original track is kept. Runs once per video, so if you
 * change the track yourself afterwards, we leave it alone.
 */
(() => {
  const YTPV = globalThis.YTPV;

  // How each language may be named in a track's id/label.
  const MATCHERS = {
    bn: /\bbn([-_.][a-z0-9]+)*\b|bangla|bengali|বাংলা/i,
    hi: /\bhi([-_.][a-z0-9]+)*\b|hindi|हिन्दी|हिंदी/i,
    en: /\ben([-_.][a-z0-9]+)*\b|english/i,
    ur: /\bur([-_.][a-z0-9]+)*\b|urdu|اردو/i,
    ar: /\bar([-_.][a-z0-9]+)*\b|arabic|العربية/i
  };

  let doneFor = null;
  let lastSig = '';

  function matches(track, code) {
    // Prefer the structured id ("bn.4", "hi-IN.3"), fall back to readable names.
    if (track.id) {
      const lang = track.id.split('.')[0].split('-')[0].toLowerCase();
      if (lang === code) return true;
    }
    const re = MATCHERS[code] || new RegExp(`\\b${code}\\b`, 'i');
    return re.test(`${track.name} ${track.text}`);
  }

  async function apply() {
    const videoId = YTPV.getVideoId();
    if (!YTPV.isWatchPage() || !videoId || doneFor === videoId) return;
    doneFor = videoId;

    // Tracks become available a moment after the video loads.
    let tracks = [];
    for (let i = 0; i < 10; i++) {
      if (YTPV.getVideoId() !== videoId) return;
      try { tracks = await YTPV.page.call('audioTracks'); } catch (_) {}
      if (tracks.length > 1) break;
      await YTPV.sleep(600);
    }
    if (tracks.length < 2) return; // only one track: nothing to do

    const priority = YTPV.settings.audioPriority.filter((p) => p.enabled);
    for (const p of priority) {
      const track = tracks.find((t) => matches(t, p.code));
      if (!track) continue;
      if (!track.isCurrent) {
        const ok = await YTPV.page.call('setAudioTrack', { index: track.index });
        if (ok) YTPV.toast(`Audio track: ${p.label}`, { id: 'audio', icon: YTPV.ICONS.music, duration: 2500 });
      }
      return;
    }
    // No preferred language available → keep the original.
  }

  YTPV.register({
    id: 'audioTrack',
    disable() { doneFor = null; },
    onSettings(s) {
      const sig = JSON.stringify(s.audioPriority);
      if (sig !== lastSig) { lastSig = sig; doneFor = null; apply(); }
    },
    enable(s) { lastSig = JSON.stringify(s.audioPriority); },
    onVideo(v) {
      v.addEventListener('loadeddata', () => { if (YTPV.settings.features.audioTrack) apply(); });
    },
    onNavigate() { apply(); }
  });
})();
