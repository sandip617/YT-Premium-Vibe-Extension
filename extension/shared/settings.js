/**
 * Shared settings module.
 * Loaded by the content scripts, the popup, and the background worker.
 * Everything is stored in browser.storage.local under the key "settings".
 * Per-channel speeds are stored separately under "channelSpeeds" so
 * frequent speed changes don't rewrite the whole settings object.
 */
(() => {
  const api = globalThis.browser || globalThis.chrome;

  const DEFAULTS = {
    features: {
      sponsorSkip: true,
      hideShorts: true,
      customSpeed: true,
      smartQuality: true,
      pip: true,
      cinemaMode: false,
      adBlocker: true,
      volumeBoost: true,
      download: true,
      aiSummary: true,
      audioTrack: true
    },
    sponsor: {
      categories: ['sponsor'] // also: selfpromo, interaction, intro, outro
    },
    shorts: {
      redirect: true // open /shorts/ID links as normal /watch?v=ID videos
    },
    speed: {
      keys: { up: 'd', down: 's', reset: 'r' },
      rememberPerChannel: true,
      defaultSpeed: 1
    },
    quality: {
      normal: 'hd720', // quality used in the normal page view
      fullscreen: 'highest'
    },
    cinema: {
      blur: 3, // px
      dim: 0.25 // 0..1 darkening of blurred areas
    },
    adBlock: {
      stripPlayerAds: true // remove ad data before the player sees it
    },
    volumeBoost: {
      level: 100 // percent, 100..300
    },
    download: {
      folder: '~/Downloads',
      audioFormat: 'm4a', // m4a (no re-encode) or mp3
      quicktimeCompatible: false // true = H.264 (max 1080p) so QuickTime can play it
    },
    gemini: {
      apiKey: '',
      speed: 'fast', // fast = Flash-Lite (answers almost instantly) | smart = Flash with light thinking
      customModel: '', // optional: force a specific model id
      language: 'en' // en | bn
    },
    audioPriority: [
      { code: 'bn', label: 'Bangla', enabled: true },
      { code: 'hi', label: 'Hindi', enabled: true },
      { code: 'en', label: 'English', enabled: false },
      { code: 'ur', label: 'Urdu', enabled: false },
      { code: 'ar', label: 'Arabic', enabled: false }
    ]
  };

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  /** Deep-merge stored values over defaults so new options always exist. */
  function merge(base, over) {
    if (!isObj(over)) return structuredClone(base);
    const out = {};
    for (const key of Object.keys(base)) {
      const b = base[key];
      const o = over[key];
      if (isObj(b)) out[key] = merge(b, o);
      else out[key] = o === undefined ? structuredClone(b) : o;
    }
    return out;
  }

  async function load() {
    try {
      const { settings } = await api.storage.local.get('settings');
      return merge(DEFAULTS, settings);
    } catch (e) {
      console.warn('[YT Vibe] settings load failed', e);
      return structuredClone(DEFAULTS);
    }
  }

  async function save(settings) {
    await api.storage.local.set({ settings });
  }

  /** Update a nested value by dotted path, e.g. update('features.pip', false). */
  async function update(path, value) {
    const s = await load();
    const parts = path.split('.');
    let node = s;
    while (parts.length > 1) node = node[parts.shift()];
    node[parts[0]] = value;
    await save(s);
    return s;
  }

  function onChange(callback) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        callback(merge(DEFAULTS, changes.settings.newValue));
      }
    });
  }

  globalThis.YTPVSettings = { DEFAULTS, load, save, update, onChange, merge };
})();
