/**
 * FEATURE 8 — Volume Boost (up to 300%)
 *
 * Audio graph:  <video> → GainNode (1.0–3.0) → limiter (DynamicsCompressor) → speakers
 * The limiter catches peaks before they clip, so boosted audio stays clean.
 *
 * Important detail: once a <video> is routed through Web Audio, it only plays
 * sound while the AudioContext is running — and Safari only starts one after a
 * user gesture. So we build the graph lazily, only when boost > 100%, and only
 * from a click/keypress. At 100% the video is never touched.
 */
(() => {
  const YTPV = globalThis.YTPV;
  const ID = 'ytpv-boost-btn';

  let ctx = null;
  const graphs = new WeakMap(); // video -> { source, gain, limiter }
  let level = 100;
  let pendingGesture = false;

  function buildGraph(video) {
    if (graphs.has(video)) return graphs.get(video);
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaElementSource(video);
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; // dB: start limiting just below full scale
    limiter.knee.value = 2;
    limiter.ratio.value = 20; // hard limiting
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    source.connect(gain).connect(limiter).connect(ctx.destination);
    const g = { source, gain, limiter };
    graphs.set(video, g);
    return g;
  }

  /** Apply the current level. Must be called from a user gesture the first time. */
  function applyLevel() {
    const video = YTPV.getVideo();
    if (!video) return;
    const g = graphs.get(video);
    if (level <= 100 && !g) return; // never touch audio unless needed
    const graph = g || buildGraph(video);
    if (ctx.state === 'suspended') ctx.resume();
    graph.gain.gain.setTargetAtTime(level / 100, ctx.currentTime, 0.05);
    updateLabel();
  }

  /** Saved boost > 100% but no gesture yet: wait for the first click/key. */
  function armGesture() {
    if (pendingGesture || level <= 100) return;
    pendingGesture = true;
    const go = () => {
      pendingGesture = false;
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
      if (YTPV.settings.features.volumeBoost) applyLevel();
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  }

  let saveTimer = null;
  function setLevel(v) {
    level = Math.round(Math.min(300, Math.max(100, v)) / 10) * 10;
    applyLevel();
    updateLabel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => YTPVSettings.update('volumeBoost.level', level), 400);
  }

  const POP_ID = 'ytpv-boost-pop';

  function updateLabel() {
    const btn = document.getElementById(ID);
    if (btn) {
      btn.querySelector('.ytpv-boost__label').textContent = `${level}%`;
      btn.classList.toggle('ytpv-boost--active', level > 100);
    }
    const pop = document.getElementById(POP_ID);
    if (pop) {
      const slider = pop.querySelector('input');
      if (Number(slider.value) !== level) slider.value = level;
      slider.style.setProperty('--fill', `${((level - 100) / 200) * 100}%`);
      pop.querySelector('.ytpv-boost__value').textContent = `${level}%`;
    }
  }

  /** The popover lives on the player (not inside the control bar) so it is never clipped. */
  function getPop() {
    let pop = document.getElementById(POP_ID);
    const player = YTPV.getPlayer();
    if (pop?.isConnected || !player) return pop;
    const slider = YTPV.el('input', {
      type: 'range', min: '100', max: '300', step: '10', value: String(level),
      class: 'ytpv-boost__slider', 'aria-label': 'Volume boost'
    });
    slider.addEventListener('input', () => setLevel(Number(slider.value)));
    const presets = YTPV.el('div', { class: 'ytpv-boost__presets' },
      [100, 150, 200, 300].map((p) => YTPV.el('button', {
        type: 'button', class: 'ytpv-boost__preset', onclick: () => setLevel(p)
      }, `${p}%`)));
    pop = YTPV.el('div', { id: POP_ID, class: 'ytpv-boost__pop' },
      YTPV.el('div', { class: 'ytpv-boost__head' },
        YTPV.el('span', {}, 'Volume boost'),
        YTPV.el('span', { class: 'ytpv-boost__value' }, `${level}%`)),
      slider, presets,
      YTPV.el('div', { class: 'ytpv-boost__hint' }, 'Scroll on the button to adjust'));
    // Keep clicks inside the popover from pausing the video.
    for (const type of ['click', 'mousedown', 'pointerdown', 'dblclick']) {
      pop.addEventListener(type, (e) => e.stopPropagation());
    }
    player.append(pop);
    updateLabel();
    return pop;
  }

  function togglePop(btn) {
    const pop = getPop();
    const player = YTPV.getPlayer();
    if (!pop || !player) return;
    const open = !pop.classList.contains('ytpv-boost__pop--open');
    if (open) {
      const b = btn.getBoundingClientRect();
      const p = player.getBoundingClientRect();
      pop.style.left = `${Math.max(8, b.left - p.left + b.width / 2 - 110)}px`;
      pop.style.bottom = `${p.bottom - b.top + 8}px`;
    }
    pop.classList.toggle('ytpv-boost__pop--open', open);
  }

  function ensureButton() {
    if (!YTPV.isWatchPage()) return;
    const btn = YTPV.ensurePlayerButton({
      id: ID,
      title: 'Volume boost',
      side: 'left',
      build: () => {
        const b = YTPV.el('button', {
          class: 'ytpv-boost',
          onclick: (e) => { e.stopPropagation(); togglePop(b); }
        },
        YTPV.icon(YTPV.ICONS.volume, '-4 -4 32 32', 'ytpv-player-icon ytpv-boost__icon'),
        YTPV.el('span', { class: 'ytpv-boost__label' }, `${level}%`));
        // Mouse wheel over the button adjusts boost too.
        b.addEventListener('wheel', (e) => {
          e.preventDefault();
          setLevel(level + (e.deltaY < 0 ? 10 : -10));
        }, { passive: false });
        return b;
      }
    });
    if (btn) updateLabel();
  }

  const closePop = (e) => {
    const pop = document.getElementById(POP_ID);
    const btn = document.getElementById(ID);
    if (pop && !pop.contains(e.target) && !btn?.contains(e.target)) pop.classList.remove('ytpv-boost__pop--open');
  };

  YTPV.register({
    id: 'volumeBoost',
    enable(s) {
      level = s.volumeBoost.level || 100;
      document.addEventListener('click', closePop, true);
      armGesture();
    },
    disable() {
      document.removeEventListener('click', closePop, true);
      document.getElementById(ID)?.remove();
      document.getElementById(POP_ID)?.remove();
      // A media element can't be "un-routed"; set gain back to 1 instead.
      const g = graphs.get(YTPV.getVideo());
      if (g && ctx) g.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    },
    onVideo() { if (level > 100) armGesture(); },
    onNavigate: ensureButton,
    onMutation: ensureButton
  });
})();
