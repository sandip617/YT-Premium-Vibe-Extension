/**
 * Popup settings panel.
 * Renders one card per feature (toggle + optional expandable settings)
 * and saves to browser.storage.local automatically. Content scripts pick
 * up changes live through storage.onChanged — no page reload needed.
 */
(async () => {
  const api = globalThis.browser || globalThis.chrome;
  let s = await YTPVSettings.load();

  /* ---------------- tiny DOM helper ---------------- */
  function h(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(c));
    return n;
  }
  const svg = (d) => {
    const NS = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    el.append(p);
    return el;
  };

  /* ---------------- saving ---------------- */
  let saveTimer = null;
  let savedTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await YTPVSettings.save(s);
      const pill = document.getElementById('saved');
      pill.classList.add('show');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => pill.classList.remove('show'), 1300);
      renderSummary();
    }, 200);
  }

  /* ---------------- reusable controls ---------------- */
  function toggle(checked, onChange, small = false) {
    const input = h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
    return h('label', { class: `switch${small ? ' small' : ''}` }, input, h('span', { class: 'track' }));
  }
  function inlineToggle(label, checked, onChange) {
    return h('div', { class: 'inline' }, h('span', { class: 'label' }, label), toggle(checked, onChange, true));
  }
  function field(label, control, hint) {
    return h('div', { class: 'field' }, h('label', {}, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
  }
  function select(value, options, onChange) {
    return h('select', { onchange: (e) => onChange(e.target.value) },
      options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  }
  function range(value, min, max, step, onInput, format) {
    const out = h('span', { class: 'label' }, format(value));
    const input = h('input', { type: 'range', min, max, step, value });
    const paint = () => input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`);
    input.addEventListener('input', () => { out.textContent = format(Number(input.value)); paint(); onInput(Number(input.value)); });
    paint();
    return [input, out];
  }

  /* ---------------- icons ---------------- */
  const I = {
    sponsor: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
    shorts: 'M17.8 10.2l-1.6-.8 1.3-.7a3.8 3.8 0 0 0-3.5-6.7L7.6 5.3a3.8 3.8 0 0 0-.1 6.8l1.6.8-1.3.7a3.8 3.8 0 0 0 3.5 6.7l6.4-3.3a3.8 3.8 0 0 0 .1-6.8zM10 14.6V9.4l4.5 2.6-4.5 2.6zM3.3 3.3l17.4 17.4-1.4 1.4L1.9 4.7z',
    speed: 'M20.4 8.6l-1.2 1.9a8 8 0 0 1-.2 7.5H5a8 8 0 0 1 10.6-11.1l1.9-1.2A10 10 0 0 0 3.3 19a2 2 0 0 0 1.7 1h14a2 2 0 0 0 1.7-1 10 10 0 0 0-.3-10.4zm-10 6.4a2 2 0 0 0 2.8 0l5.7-8.5-8.5 5.7a2 2 0 0 0 0 2.8z',
    quality: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-8 12H9.5v-2h-2v2H6V9h1.5v2.5h2V9H11v6zm7-1a1 1 0 0 1-1 1h-4V9h4a1 1 0 0 1 1 1v4zm-3.5-.5h2v-3h-2v3z',
    pip: 'M19 11h-8v6h8v-6zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 0H3V5h18v14z',
    cinema: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4h-4z',
    ad: 'M12 2L4 5v6c0 5.5 3.4 10.7 8 12 4.6-1.3 8-6.5 8-12V5l-8-3zm4.6 13.2l-1.4 1.4L12 13.4l-3.2 3.2-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 3.2 3.2 3.2-3.2 1.4 1.4-3.2 3.2 3.2 3.2z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
    download: 'M12 16l-5-5 1.4-1.4 2.6 2.6V4h2v8.2l2.6-2.6L17 11l-5 5zm-7 2h14v2H5v-2z',
    ai: 'M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14z',
    audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
    chevron: 'M7.4 8.6L12 13.2l4.6-4.6L18 10l-6 6-6-6z',
    up: 'M7.4 15.4L12 10.8l4.6 4.6L18 14l-6-6-6 6z',
    down: 'M7.4 8.6L12 13.2l4.6-4.6L18 10l-6 6-6-6z'
  };

  /* ---------------- per-feature settings ---------------- */

  function sponsorSettings() {
    const cats = [['sponsor', 'Sponsor'], ['selfpromo', 'Self-promo'], ['interaction', 'Subscribe reminders'], ['intro', 'Intro'], ['outro', 'Outro']];
    const wrap = h('div', { class: 'chips' });
    for (const [id, label] of cats) {
      const chip = h('button', { class: `chip${s.sponsor.categories.includes(id) ? ' on' : ''}`, type: 'button' }, label);
      chip.addEventListener('click', () => {
        const set = new Set(s.sponsor.categories);
        set.has(id) ? set.delete(id) : set.add(id);
        if (!set.size) set.add('sponsor');
        s.sponsor.categories = [...set];
        for (const [i, c] of [...wrap.children].entries()) c.classList.toggle('on', s.sponsor.categories.includes(cats[i][0]));
        save();
      });
      wrap.append(chip);
    }
    return [field('Skip these segments', wrap, 'Data from the community-run SponsorBlock project.')];
  }

  function shortsSettings() {
    return [inlineToggle('Open Shorts links as normal videos', s.shorts.redirect, (v) => { s.shorts.redirect = v; save(); })];
  }

  function speedSettings() {
    let listening = null;
    const keys = h('div', { class: 'keys' });
    const labels = { down: 'Slower', up: 'Faster', reset: 'Reset' };
    const render = () => {
      keys.replaceChildren(...['down', 'up', 'reset'].map((k) => {
        const b = h('button', { class: `key${listening === k ? ' listening' : ''}`, type: 'button' },
          h('kbd', {}, listening === k ? '…' : s.speed.keys[k]), h('span', {}, labels[k]));
        b.addEventListener('click', () => { listening = listening === k ? null : k; render(); });
        return b;
      }));
    };
    window.addEventListener('keydown', (e) => {
      if (!listening) return;
      e.preventDefault();
      if (e.key === 'Escape') { listening = null; return render(); }
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey) return;
      s.speed.keys[listening] = e.key.toLowerCase();
      listening = null;
      render();
      save();
    });
    render();
    const speeds = [];
    for (let r = 0.25; r <= 4; r += 0.25) speeds.push([String(r), `${r}×`]);
    return [
      field('Keyboard shortcuts (click to change)', keys, 'Steps of 0.25×, from 0.25× to 4×.'),
      inlineToggle('Remember speed per channel', s.speed.rememberPerChannel, (v) => { s.speed.rememberPerChannel = v; save(); }),
      field('Default speed', select(String(s.speed.defaultSpeed), speeds, (v) => { s.speed.defaultSpeed = Number(v); save(); })),
      h('button', {
        class: 'btn', type: 'button',
        onclick: async (e) => { await api.storage.local.remove('channelSpeeds'); e.target.textContent = 'Cleared ✓'; }
      }, 'Clear saved channel speeds')
    ];
  }

  function qualitySettings() {
    return [
      field('Normal view (with suggestions)', select(s.quality.normal, [
        ['hd1080', '1080p'], ['hd720', '720p (recommended)'], ['large', '480p'], ['medium', '360p']
      ], (v) => { s.quality.normal = v; save(); })),
      h('div', { class: 'hint' }, 'Fullscreen always switches to the highest quality available.')
    ];
  }

  function cinemaSettings() {
    const [blur, blurOut] = range(s.cinema.blur, 1, 10, 1, (v) => { s.cinema.blur = v; save(); }, (v) => `${v}px`);
    const [dim, dimOut] = range(Math.round(s.cinema.dim * 100), 0, 70, 5, (v) => { s.cinema.dim = v / 100; save(); }, (v) => `${v}%`);
    return [
      h('div', { class: 'field' }, h('div', { class: 'inline' }, h('span', { class: 'label' }, 'Blur strength'), blurOut), blur),
      h('div', { class: 'field' }, h('div', { class: 'inline' }, h('span', { class: 'label' }, 'Dim'), dimOut), dim)
    ];
  }

  function adSettings() {
    return [
      inlineToggle('Remove ads from player data (strongest)', s.adBlock.stripPlayerAds, (v) => { s.adBlock.stripPlayerAds = v; save(); }),
      h('div', { class: 'hint' }, 'If a video ever refuses to play, turn this off. Ads are still skipped instantly.')
    ];
  }

  function downloadSettings() {
    const status = h('div', { class: 'status', hidden: true });
    const folder = h('input', { type: 'text', value: s.download.folder, placeholder: '~/Downloads', spellcheck: 'false' });
    folder.addEventListener('input', () => { s.download.folder = folder.value.trim() || '~/Downloads'; save(); });
    const test = h('button', { class: 'btn', type: 'button' }, 'Test yt-dlp');
    test.addEventListener('click', async () => {
      status.hidden = false;
      status.className = 'status';
      status.textContent = 'Checking… (the first time this also sets up yt-dlp)';
      const res = await api.runtime.sendMessage({ type: 'native', payload: { cmd: 'check' } }).catch((e) => ({ ok: false, message: String(e) }));
      if (res?.ok && res.standalone) {
        status.className = 'status bad';
        status.textContent = `yt-dlp found, but it's the standalone build, which Safari's sandbox blocks.\nReplace it with the Python version. In Terminal run:\n${res.fix}`;
      } else if (res?.ok && res.ytdlp && !res.version) {
        status.className = 'status bad';
        status.textContent = `yt-dlp found but failed to start:\n${res.error || 'unknown error'}`;
      } else if (res?.ok && res.ytdlp) {
        status.className = 'status ok';
        status.textContent = `✓ yt-dlp ${res.version || ''} ready\n${res.ffmpeg ? '✓ ffmpeg found' : '⚠︎ ffmpeg missing: videos max out at 720p. Run "brew install ffmpeg" for full quality.'}`;
      } else if (res?.ok && /Python/.test(res.error || '')) {
        status.className = 'status bad';
        status.textContent = 'One-time setup needed. In Terminal run:\nbrew install yt-dlp ffmpeg\n(No Homebrew? Get it from brew.sh first.)';
      } else if (res?.ok) {
        status.className = 'status bad';
        status.textContent = res.error || 'yt-dlp could not be set up.';
      } else {
        status.className = 'status bad';
        status.textContent = 'Can’t reach the YT Premium Vibe app. Open it once from Applications (or run it from Xcode), then try again.';
      }
    });
    return [
      field('Save to folder', h('div', { class: 'with-btn' }, folder),
        'Any folder in your home folder, e.g. ~/Downloads or ~/Movies/YouTube'),
      field('Audio-only format', select(s.download.audioFormat, [['m4a', 'M4A (original quality, fast)'], ['mp3', 'MP3 (works everywhere)']],
        (v) => { s.download.audioFormat = v; save(); })),
      inlineToggle('QuickTime-compatible video (H.264, max 1080p)', s.download.quicktimeCompatible, (v) => { s.download.quicktimeCompatible = v; save(); }),
      h('div', { class: 'with-btn' }, test),
      status
    ];
  }

  function aiSettings() {
    const key = h('input', { type: 'password', value: s.gemini.apiKey, placeholder: 'Paste your Gemini API key', spellcheck: 'false', autocomplete: 'off' });
    key.addEventListener('input', () => { s.gemini.apiKey = key.value.trim(); save(); });
    const show = h('button', { class: 'btn', type: 'button' }, 'Show');
    show.addEventListener('click', () => {
      key.type = key.type === 'password' ? 'text' : 'password';
      show.textContent = key.type === 'password' ? 'Show' : 'Hide';
    });
    const seg = h('div', { class: 'seg' });
    const renderSeg = () => seg.replaceChildren(...[['en', 'English'], ['bn', 'বাংলা Bangla']].map(([code, label]) =>
      h('button', { type: 'button', class: s.gemini.language === code ? 'on' : '', onclick: () => { s.gemini.language = code; renderSeg(); save(); } }, label)));
    renderSeg();
    const speedSeg = h('div', { class: 'seg' });
    const renderSpeed = () => speedSeg.replaceChildren(...[['fast', '⚡ Fast'], ['smart', '🧠 Smart']].map(([v, label]) =>
      h('button', { type: 'button', class: s.gemini.speed === v ? 'on' : '', onclick: () => { s.gemini.speed = v; renderSpeed(); save(); } }, label)));
    renderSpeed();
    const model = h('input', { type: 'text', value: s.gemini.customModel, placeholder: 'Leave empty (recommended)', spellcheck: 'false' });
    model.addEventListener('input', () => { s.gemini.customModel = model.value.trim(); save(); });

    const link = h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank' }, 'aistudio.google.com/apikey');
    return [
      field('Gemini API key', h('div', { class: 'with-btn' }, key, show), h('span', {}, 'Free key from ', link, '. Stored only on this Mac.')),
      field('Summary language', seg),
      field('Speed', speedSeg, 'Fast starts answering in a second or two. Smart is more detailed but slower.'),
      field('Custom model (optional)', model, 'e.g. gemini-3.6-flash. Overrides the speed choice.')
    ];
  }

  const LANG_NATIVE = { bn: 'বাংলা', hi: 'हिन्दी', en: 'English', ur: 'اردو', ar: 'العربية' };
  function audioSettings() {
    const list = h('ul', { class: 'prio' });
    const render = () => {
      const items = s.audioPriority.map((p, i) => {
        const up = h('button', { type: 'button', title: 'Move up', disabled: i === 0 }, svg(I.up));
        const down = h('button', { type: 'button', title: 'Move down', disabled: i === s.audioPriority.length - 1 }, svg(I.down));
        up.addEventListener('click', () => { swap(i, i - 1); });
        down.addEventListener('click', () => { swap(i, i + 1); });
        const rank = s.audioPriority.slice(0, i + 1).filter((x) => x.enabled).length;
        return h('li', { class: p.enabled ? '' : 'off' },
          h('span', { class: 'rank' }, p.enabled ? String(rank) : '–'),
          h('span', { class: 'lang' }, p.label, h('small', {}, LANG_NATIVE[p.code] || p.code)),
          h('span', { class: 'move' }, up, down),
          toggle(p.enabled, (v) => { p.enabled = v; render(); save(); }, true));
      });
      items.push(h('li', { class: 'fallback' }, h('span', { class: 'rank' }, '↩'), h('span', { class: 'lang' }, 'Otherwise keep the original audio')));
      list.replaceChildren(...items);
    };
    const swap = (a, b) => {
      const arr = s.audioPriority;
      [arr[a], arr[b]] = [arr[b], arr[a]];
      render();
      save();
    };
    render();
    return [field('Priority (top wins)', list, 'Used only when a video has more than one audio track.')];
  }

  const FEATURES = [
    { id: 'adBlocker', name: 'Ad Blocker', desc: 'Skip video ads, hide banner & feed ads', icon: I.ad, settings: adSettings },
    { id: 'sponsorSkip', name: 'Sponsor Skip', desc: 'Auto-skip sponsor segments (SponsorBlock)', icon: I.sponsor, settings: sponsorSettings },
    { id: 'hideShorts', name: 'Hide Shorts', desc: 'Remove Shorts from home, search, sidebar…', icon: I.shorts, settings: shortsSettings },
    { id: 'customSpeed', name: 'Custom Speed', desc: 'Shortcuts for 0.25× – 4× playback', icon: I.speed, settings: speedSettings },
    { id: 'smartQuality', name: 'Smart Quality', desc: 'Highest in fullscreen, 720p in page view', icon: I.quality, settings: qualitySettings },
    { id: 'pip', name: 'Picture-in-Picture', desc: 'One-click floating video button', icon: I.pip },
    { id: 'cinemaMode', name: 'Cinema Mode', desc: 'Softly blur everything around the video', icon: I.cinema, settings: cinemaSettings },
    { id: 'volumeBoost', name: 'Volume Boost', desc: 'Up to 300% with a slider in the player', icon: I.volume },
    { id: 'download', name: 'Download', desc: 'Save video or audio with yt-dlp', icon: I.download, settings: downloadSettings },
    { id: 'aiSummary', name: 'AI Summary', desc: 'Gemini study notes + chat, in Bangla or English', icon: I.ai, settings: aiSettings },
    { id: 'audioTrack', name: 'Auto Audio Track', desc: 'Prefer Bangla, then Hindi dubbed audio', icon: I.audio, settings: audioSettings }
  ];

  /* ---------------- render ---------------- */
  function renderSummary() {
    const on = FEATURES.filter((f) => s.features[f.id]).length;
    const el = document.getElementById('summary');
    el.replaceChildren(h('b', {}, `${on} of ${FEATURES.length}`), ' features active');
  }

  const root = document.getElementById('features');
  for (const f of FEATURES) {
    const card = h('section', { class: `card${s.features[f.id] ? ' on' : ''}` });
    const sw = toggle(s.features[f.id], (v) => {
      s.features[f.id] = v;
      card.classList.toggle('on', v);
      save();
    });
    const row = h('div', { class: 'row' },
      h('div', { class: 'ficon' }, svg(f.icon)),
      h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name), h('div', { class: 'desc', title: f.desc }, f.desc)));
    if (f.settings) {
      const exp = h('button', { class: 'expand', type: 'button', title: 'Settings', 'aria-expanded': 'false' }, svg(I.chevron));
      exp.addEventListener('click', () => {
        const open = card.classList.toggle('open');
        exp.setAttribute('aria-expanded', String(open));
      });
      row.append(exp);
    }
    row.append(sw);
    card.append(row);
    if (f.settings) {
      card.append(h('div', { class: 'panel' }, h('div', { class: 'inner' }, h('div', { class: 'content' }, f.settings()))));
    }
    root.append(card);
  }
  renderSummary();
  try { document.getElementById('version').textContent = api.runtime.getManifest().version; } catch (_) {}
})();
