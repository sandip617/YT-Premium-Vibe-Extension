/**
 * FEATURE 1 — Sponsor Skip (SponsorBlock)
 *
 * Fetches community-submitted segments for the current video (through the
 * background worker), skips them automatically, shows a "Sponsor skipped"
 * toast with Undo, and marks the segments on the progress bar.
 */
(() => {
  const YTPV = globalThis.YTPV;

  const LABELS = {
    sponsor: 'Sponsor',
    selfpromo: 'Self-promo',
    interaction: 'Interaction reminder',
    intro: 'Intro',
    outro: 'Outro'
  };

  let segments = [];
  let videoId = null;
  let video = null;
  let lastCats = '';
  const allowed = new Set(); // segments the user chose to watch (Undo)

  function onTimeUpdate() {
    if (!video || YTPV.adActive || !segments.length) return;
    const t = video.currentTime;
    for (const seg of segments) {
      if (allowed.has(seg.uuid)) continue;
      // Skip if we're inside the segment (with a small margin at the end).
      if (t >= seg.start && t < seg.end - 0.35) {
        const from = t;
        video.currentTime = seg.end;
        const label = LABELS[seg.category] || 'Segment';
        YTPV.toast(`${label} skipped`, {
          id: 'sponsor',
          icon: YTPV.ICONS.check,
          duration: 5000,
          action: {
            label: 'Undo',
            onClick: () => {
              allowed.add(seg.uuid);
              video.currentTime = Math.max(seg.start, from - 0.5);
            }
          }
        });
        break;
      }
    }
  }

  function attach(v) {
    if (video === v) return;
    video?.removeEventListener('timeupdate', onTimeUpdate);
    video = v;
    video?.addEventListener('timeupdate', onTimeUpdate, { passive: true });
  }

  /** Draw small green markers on the progress bar. */
  function drawMarkers() {
    document.getElementById('ytpv-sb-markers')?.remove();
    if (!segments.length || !video || !Number.isFinite(video.duration) || !video.duration) return;
    const bar = document.querySelector('#movie_player .ytp-progress-bar');
    if (!bar) return;
    const layer = YTPV.el('div', { id: 'ytpv-sb-markers', class: 'ytpv-sb-markers' });
    for (const s of segments) {
      layer.append(YTPV.el('div', {
        class: `ytpv-sb-marker ytpv-sb-${s.category}`,
        style: {
          left: `${(s.start / video.duration) * 100}%`,
          width: `${Math.max(0.3, ((s.end - s.start) / video.duration) * 100)}%`
        },
        title: LABELS[s.category] || s.category
      }));
    }
    bar.append(layer);
  }

  async function load() {
    const id = YTPV.getVideoId();
    if (!YTPV.isWatchPage() || !id) { segments = []; videoId = null; return; }
    if (id === videoId) return;
    videoId = id;
    segments = [];
    allowed.clear();
    document.getElementById('ytpv-sb-markers')?.remove();
    try {
      const res = await YTPV.send({
        type: 'sponsorblock',
        videoId: id,
        categories: YTPV.settings.sponsor.categories
      });
      if (id !== YTPV.getVideoId()) return; // navigated away meanwhile
      segments = res?.ok ? res.segments : [];
      if (video?.readyState >= 1) drawMarkers();
      else video?.addEventListener('loadedmetadata', drawMarkers, { once: true });
    } catch (e) {
      console.warn('[YT Vibe] SponsorBlock', e);
    }
  }

  YTPV.register({
    id: 'sponsorSkip',
    enable(s) { lastCats = s.sponsor.categories.join(); attach(YTPV.getVideo()); },
    disable() {
      attach(null);
      segments = [];
      videoId = null;
      document.getElementById('ytpv-sb-markers')?.remove();
    },
    onSettings(s) {
      const cats = s.sponsor.categories.join();
      if (cats !== lastCats) { lastCats = cats; videoId = null; load(); }
    },
    onVideo(v) { attach(v); },
    onNavigate() { load(); },
    onMutation() {
      if (segments.length && !document.getElementById('ytpv-sb-markers')) drawMarkers();
    }
  });
})();
