/**
 * Page bridge — runs in YouTube's own JavaScript context ("main world").
 *
 * Content scripts live in an isolated world and can't call YouTube's player
 * API (#movie_player.setPlaybackQualityRange, getAvailableAudioTracks, ...).
 * The manifest runs this file in the page's own world ("world": "MAIN"), where
 * it answers requests sent with window.postMessage. It also strips ad data
 * from player responses before the player sees them.
 *
 * Note: never use innerHTML here — YouTube enforces Trusted Types.
 */
(() => {
  if (window.__ytpvBridge) return;
  window.__ytpvBridge = true;

  const FROM_CONTENT = 'ytpv-content';
  const FROM_PAGE = 'ytpv-page';

  /* ---------------------------------------------------------------- */
  /* Ad data stripping                                                */
  /* ---------------------------------------------------------------- */

  // The content script mirrors the setting into localStorage so we can read it
  // synchronously before YouTube's own scripts run.
  let stripAds = true;
  try { stripAds = localStorage.getItem('ytpv-strip-ads') !== '0'; } catch (_) {}

  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];

  function strip(obj) {
    if (!stripAds || !obj || typeof obj !== 'object') return obj;
    for (const k of AD_KEYS) if (k in obj) delete obj[k];
    if (obj.playerResponse && typeof obj.playerResponse === 'object') strip(obj.playerResponse);
    return obj;
  }
  const looksLikePlayerData = (o) =>
    o && typeof o === 'object' && (o.adPlacements || o.playerAds || o.adSlots || o.playerResponse);

  // 1) Initial page load: ytInitialPlayerResponse is assigned by an inline script.
  try {
    let initial = window.ytInitialPlayerResponse;
    if (initial) strip(initial);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (v) => { initial = strip(v); }
    });
  } catch (_) {}

  // 2) Responses parsed with JSON.parse
  const origParse = JSON.parse;
  JSON.parse = function (...args) {
    const out = origParse.apply(this, args);
    return looksLikePlayerData(out) ? strip(out) : out;
  };

  // 3) SPA navigation fetches /youtubei/v1/player and reads it with response.json()
  const origJson = Response.prototype.json;
  Response.prototype.json = async function () {
    const out = await origJson.call(this);
    if (/\/youtubei\/v1\/(player|next)/.test(this.url || '')) strip(out);
    return out;
  };

  /* ---------------------------------------------------------------- */
  /* Remember timedtext (captions) URLs the player requests.          */
  /* Newer YouTube requires a "pot" token on caption URLs; reusing the */
  /* player's own URL is the most reliable way to get a transcript.   */
  /* ---------------------------------------------------------------- */

  const captionUrls = new Map(); // videoId -> last full timedtext URL
  function rememberCaptionUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.includes('/api/timedtext')) return;
      const v = u.searchParams.get('v');
      if (v) captionUrls.set(v, u.toString());
    } catch (_) {}
  }
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' || url instanceof URL) rememberCaptionUrl(String(url));
    return origOpen.call(this, method, url, ...rest);
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try { rememberCaptionUrl(typeof input === 'string' ? input : input?.url || ''); } catch (_) {}
    return origFetch.call(this, input, init);
  };

  /* ---------------------------------------------------------------- */
  /* Player helpers                                                   */
  /* ---------------------------------------------------------------- */

  const player = () => document.getElementById('movie_player');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function playerResponse() {
    const p = player();
    try { return p?.getPlayerResponse?.() || window.ytInitialPlayerResponse || null; } catch (_) { return null; }
  }

  /** Turn a player audio-track object into something readable. */
  function describeTrack(track) {
    const strings = [];
    const visit = (o, depth) => {
      if (!o || depth > 2) return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string' && v.length < 120) strings.push(v);
        else if (v && typeof v === 'object' && !Array.isArray(v)) visit(v, depth + 1);
      }
    };
    visit(track, 0);
    // An id looks like "bn.4" or "hi-IN.3"; "*.4" usually marks the original track.
    const id = strings.find((s) => /^[a-z]{2,3}(-[A-Za-z0-9]+)?\.\d+$/.test(s)) || '';
    return { id, text: strings.join(' | ') };
  }

  function audioTrackNames() {
    // adaptiveFormats carry human readable names for each audio track id.
    const map = {};
    const formats = playerResponse()?.streamingData?.adaptiveFormats || [];
    for (const f of formats) {
      if (f.audioTrack?.id) map[f.audioTrack.id] = f.audioTrack.displayName || '';
    }
    return map;
  }

  /* ---------------------------------------------------------------- */
  /* Transcript                                                       */
  /* ---------------------------------------------------------------- */

  function parseJson3(text) {
    const data = origParse(text);
    const out = [];
    for (const ev of data.events || []) {
      if (!ev.segs) continue;
      const t = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (t) out.push({ start: (ev.tStartMs || 0) / 1000, text: t });
    }
    return out;
  }

  function parseXml(text) {
    const out = [];
    const re = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    const decode = (s) =>
      s
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    let m;
    while ((m = re.exec(text))) {
      const t = decode(m[2]).replace(/\s+/g, ' ').trim();
      if (t) out.push({ start: parseFloat(m[1]), text: t });
    }
    return out;
  }

  async function fetchCaptionUrl(url) {
    const u = new URL(url, location.href);
    u.searchParams.set('fmt', 'json3');
    const res = await origFetch(u.toString(), { credentials: 'include' });
    const text = await res.text();
    if (!text || text.length < 20) return [];
    try { return parseJson3(text); } catch (_) { return parseXml(text); }
  }

  async function getTranscript({ languages = ['en', 'bn', 'hi'] } = {}) {
    const pr = playerResponse();
    const videoId = pr?.videoDetails?.videoId;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return { segments: [], reason: 'no_captions' };

    // Prefer human-made captions in a preferred language, then auto captions.
    const score = (t) => {
      let s = 0;
      if (t.kind !== 'asr') s += 10;
      const i = languages.findIndex((l) => t.languageCode?.startsWith(l));
      if (i >= 0) s += 5 - i;
      return s;
    };
    const track = [...tracks].sort((a, b) => score(b) - score(a))[0];
    const lang = track.languageCode;

    // Attempt 1: the plain baseUrl (works for many videos).
    try {
      const segs = await fetchCaptionUrl(track.baseUrl);
      if (segs.length) return { segments: segs, language: lang };
    } catch (_) {}

    // Attempt 2: reuse a URL the player itself requested (contains the pot token).
    let known = captionUrls.get(videoId);
    if (!known) {
      // Briefly switch captions on so the player fetches them, then restore.
      const p = player();
      let wasOn = false;
      try {
        const cur = p.getOption?.('captions', 'track');
        wasOn = !!(cur && cur.languageCode);
        p.loadModule?.('captions');
        p.setOption?.('captions', 'track', { languageCode: lang });
      } catch (_) {}
      for (let i = 0; i < 20 && !known; i++) {
        await sleep(200);
        known = captionUrls.get(videoId);
      }
      if (!wasOn) {
        try { p.setOption?.('captions', 'track', {}); p.unloadModule?.('captions'); } catch (_) {}
      }
    }
    if (known) {
      try {
        const segs = await fetchCaptionUrl(known);
        if (segs.length) return { segments: segs, language: lang };
      } catch (_) {}
    }
    return { segments: [], reason: 'fetch_failed' };
  }

  /* ---------------------------------------------------------------- */
  /* Command handlers                                                 */
  /* ---------------------------------------------------------------- */

  const handlers = {
    ping: () => true,

    setStripAds: ({ on }) => { stripAds = !!on; return true; },

    videoInfo: () => {
      const p = player();
      const pr = playerResponse();
      const d = pr?.videoDetails || {};
      const vd = p?.getVideoData?.() || {};
      return {
        videoId: vd.video_id || d.videoId || null,
        title: d.title || vd.title || document.title,
        author: d.author || vd.author || '',
        channelId: d.channelId || '',
        lengthSeconds: Number(d.lengthSeconds || 0),
        isLive: !!d.isLiveContent && !!vd.isLive,
        description: d.shortDescription || ''
      };
    },

    qualityLevels: () => {
      const p = player();
      return {
        levels: p?.getAvailableQualityLevels?.() || [],
        current: p?.getPlaybackQuality?.() || ''
      };
    },

    setQuality: ({ quality }) => {
      const p = player();
      if (!p) return false;
      try { p.setPlaybackQualityRange?.(quality, quality); } catch (_) {}
      try { p.setPlaybackQuality?.(quality); } catch (_) {}
      return p.getPlaybackQuality?.() || quality;
    },

    audioTracks: () => {
      const p = player();
      const tracks = p?.getAvailableAudioTracks?.() || [];
      const current = p?.getAudioTrack?.();
      const names = audioTrackNames();
      const curDesc = current ? describeTrack(current) : null;
      return tracks.map((t, index) => {
        const d = describeTrack(t);
        return {
          index,
          id: d.id,
          name: names[d.id] || '',
          text: d.text,
          isCurrent: t === current || (!!curDesc?.id && curDesc.id === d.id)
        };
      });
    },

    setAudioTrack: ({ index }) => {
      const p = player();
      const t = p?.getAvailableAudioTracks?.()[index];
      if (!t) return false;
      p.setAudioTrack(t);
      return true;
    },

    transcript: (opts) => getTranscript(opts)
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.source !== FROM_CONTENT || !handlers[msg.type]) return;
    let result = null;
    let error = null;
    try { result = await handlers[msg.type](msg.payload || {}); } catch (err) { error = String(err?.message || err); }
    window.postMessage({ source: FROM_PAGE, id: msg.id, result, error }, '*');
  });

  window.postMessage({ source: FROM_PAGE, type: 'ready' }, '*');
})();
