/**
 * FEATURE 6 — Cinema Mode (Blur)
 *
 * Four fixed glass panels (top / bottom / left / right) sit around the video
 * and softly blur whatever is behind them using backdrop-filter. Hovering a
 * panel's area fades it out so you can read or click what's underneath.
 *
 * Why overlays instead of blurring YouTube's own elements? The blur cost stays
 * the size of your screen (not the whole page), and YouTube's DOM is never
 * touched. The panels ignore the mouse (pointer-events: none), so every click
 * goes straight through to YouTube.
 */
(() => {
  const YTPV = globalThis.YTPV;
  const SIDES = ['top', 'bottom', 'left', 'right'];

  let layer = null;
  const regions = {};
  const rects = {};
  let rafPending = false;
  let resizeObs = null;
  let observedPlayer = null;
  let mouse = null;

  function build() {
    if (layer?.isConnected) return;
    layer = YTPV.el('div', { id: 'ytpv-cinema', class: 'ytpv-cinema', hidden: true });
    for (const side of SIDES) {
      regions[side] = YTPV.el('div', { class: `ytpv-cinema__region ytpv-cinema__region--${side}` });
      layer.append(regions[side]);
    }
    document.body.append(layer);
    applyStyle();
  }

  function applyStyle() {
    if (!layer) return;
    const { blur, dim } = YTPV.settings.cinema;
    layer.style.setProperty('--ytpv-blur', `${blur}px`);
    layer.style.setProperty('--ytpv-dim', String(dim));
  }

  const schedule = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(update);
  };

  function update() {
    rafPending = false;
    if (!layer) return;
    const player = document.querySelector('ytd-watch-flexy #movie_player') || YTPV.getPlayer();
    const r = player?.getBoundingClientRect();
    const show = YTPV.isWatchPage() && !YTPV.isFullscreen() && r && r.width > 200 && r.bottom > 80 && r.top < innerHeight;
    layer.hidden = !show;
    if (!show) return;

    if (player !== observedPlayer) {
      resizeObs?.disconnect();
      resizeObs = new ResizeObserver(schedule);
      resizeObs.observe(player);
      observedPlayer = player;
    }

    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const top = Math.max(0, r.top);
    const bottom = Math.min(vh, r.bottom);
    rects.top = { x: 0, y: 0, w: vw, h: top };
    rects.bottom = { x: 0, y: bottom, w: vw, h: Math.max(0, vh - bottom) };
    rects.left = { x: 0, y: top, w: Math.max(0, r.left), h: bottom - top };
    rects.right = { x: r.right, y: top, w: Math.max(0, vw - r.right), h: bottom - top };

    for (const side of SIDES) {
      const q = rects[side];
      const s = regions[side].style;
      s.transform = `translate(${q.x}px, ${q.y}px)`;
      s.width = `${q.w}px`;
      s.height = `${q.h}px`;
    }
    updateHover();
  }

  function updateHover() {
    for (const side of SIDES) {
      const q = rects[side];
      const inside = !!mouse && q && mouse.x >= q.x && mouse.x < q.x + q.w && mouse.y >= q.y && mouse.y < q.y + q.h;
      regions[side].classList.toggle('ytpv-cinema__region--clear', inside);
    }
  }

  let hoverRaf = false;
  function onMouseMove(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (hoverRaf) return;
    hoverRaf = true;
    requestAnimationFrame(() => { hoverRaf = false; updateHover(); });
  }
  function onMouseOut(e) {
    if (!e.relatedTarget) { mouse = null; updateHover(); }
  }

  YTPV.register({
    id: 'cinemaMode',

    enable() {
      window.addEventListener('scroll', schedule, { passive: true, capture: true });
      window.addEventListener('resize', schedule, { passive: true });
      document.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('mouseout', onMouseOut, { passive: true });
      document.addEventListener('fullscreenchange', schedule);
      document.addEventListener('webkitfullscreenchange', schedule);
      if (document.body) { build(); schedule(); }
    },

    disable() {
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('fullscreenchange', schedule);
      document.removeEventListener('webkitfullscreenchange', schedule);
      resizeObs?.disconnect();
      resizeObs = observedPlayer = null;
      layer?.remove();
      layer = null;
    },

    onSettings() { applyStyle(); },
    onNavigate() { build(); schedule(); },
    onMutation() { build(); schedule(); }
  });
})();
