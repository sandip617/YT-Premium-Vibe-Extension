/**
 * FEATURE 6 — Cinema Mode (Blur)
 *
 * One fixed glass layer covers the whole screen and blurs everything behind
 * it using backdrop-filter, with a hole cut out (clip-path) exactly where the
 * video is. A single layer means one even blur — no seams between panels.
 * Moving the mouse off the video fades the blur out so you can read or click
 * the page.
 *
 * Why an overlay instead of blurring YouTube's own elements? The blur cost stays
 * the size of your screen (not the whole page), and YouTube's DOM is never
 * touched. The layer ignores the mouse (pointer-events: none), so every click
 * goes straight through to YouTube.
 */
(() => {
  const YTPV = globalThis.YTPV;

  let layer = null;
  let hole = null;
  let rafPending = false;
  let resizeObs = null;
  let observedPlayer = null;
  let mouse = null;

  function build() {
    if (layer?.isConnected) return;
    layer = YTPV.el('div', { id: 'ytpv-cinema', class: 'ytpv-cinema', hidden: true });
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

    hole = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    // Whole screen, minus the video rectangle (evenodd turns the inner rect into a hole).
    layer.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
      `${hole.l}px ${hole.t}px, ${hole.r}px ${hole.t}px, ${hole.r}px ${hole.b}px, ${hole.l}px ${hole.b}px, ${hole.l}px ${hole.t}px)`;
    updateHover();
  }

  function updateHover() {
    if (!layer || !hole) return;
    const onVideo = !mouse || (mouse.x >= hole.l && mouse.x < hole.r && mouse.y >= hole.t && mouse.y < hole.b);
    layer.classList.toggle('ytpv-cinema--clear', !onVideo);
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
      layer = hole = null;
    },

    onSettings() { applyStyle(); },
    onNavigate() { build(); schedule(); },
    onMutation() { build(); schedule(); }
  });
})();
