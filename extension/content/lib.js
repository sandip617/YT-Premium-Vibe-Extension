/**
 * Shared helpers for all content-script features.
 * Creates the global YTPV namespace (isolated world, not visible to YouTube).
 *
 * DOM is built with createElement instead of innerHTML so nothing can clash
 * with YouTube's Trusted Types policy.
 */
(() => {
  const YTPV = (globalThis.YTPV = globalThis.YTPV || {});
  YTPV.api = globalThis.browser || globalThis.chrome;
  YTPV.features = [];
  YTPV.register = (feature) => YTPV.features.push(feature);

  /* ---------------------------------------------------------------- */
  /* DOM builders                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * el('div', { class: 'x', onclick: fn, style: {...} }, child, 'text', ...)
   */
  YTPV.el = function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  };

  /** Build an SVG icon from one or more path "d" strings. */
  YTPV.icon = function icon(paths, viewBox = '0 0 24 24', cls = 'ytpv-icon') {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    for (const d of [].concat(paths)) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  };

  YTPV.ICONS = {
    pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
    download: 'M12 16l-5-5 1.4-1.4 2.6 2.6V4h2v8.2l2.6-2.6L17 11l-5 5zm-7 2h14v2H5v-2z',
    sparkle: 'M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
    close: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
    send: 'M3 20.5v-7l9-1.5-9-1.5v-7L22 12 3 20.5z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    music: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
    film: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4h-4z',
    copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z'
  };

  /* ---------------------------------------------------------------- */
  /* YouTube page helpers                                             */
  /* ---------------------------------------------------------------- */

  YTPV.isWatchPage = () => location.pathname === '/watch';
  YTPV.getVideoId = () => new URLSearchParams(location.search).get('v');
  YTPV.getPlayer = () => document.getElementById('movie_player');
  YTPV.getVideo = () =>
    document.querySelector('#movie_player video.html5-main-video') ||
    document.querySelector('video.html5-main-video');
  YTPV.isFullscreen = () =>
    !!(document.fullscreenElement || document.webkitFullscreenElement) ||
    !!YTPV.getPlayer()?.classList.contains('ytp-fullscreen');
  YTPV.isAdShowing = () => !!YTPV.getPlayer()?.classList.contains('ad-showing');

  /** True when the user is typing in a text field (don't hijack keys then). */
  YTPV.isTyping = (e) => {
    const t = e.composedPath?.()[0] || e.target;
    if (!t || !t.tagName) return false;
    return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
      !!t.closest?.('[contenteditable="true"], #ytpv-ai-panel');
  };

  YTPV.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  YTPV.formatTime = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };

  /** Send a message to the background worker. */
  YTPV.send = (msg) => YTPV.api.runtime.sendMessage(msg);

  /* ---------------------------------------------------------------- */
  /* Toast (glass pill inside the player, also works in fullscreen)   */
  /* ---------------------------------------------------------------- */

  function toastHost() {
    const player = YTPV.getPlayer();
    const parent = player || document.body;
    let host = parent.querySelector(':scope > .ytpv-toast-host');
    if (!host) {
      host = YTPV.el('div', { class: 'ytpv-toast-host' + (player ? '' : ' ytpv-toast-host--page') });
      parent.append(host);
    }
    return host;
  }

  /**
   * YTPV.toast('Sponsor skipped', { action: { label: 'Undo', onClick }, duration: 5000 })
   * Returns an object with update(text) and close().
   */
  YTPV.toast = function toast(message, opts = {}) {
    const { action, duration = 3500, icon, sticky = false, id } = opts;
    const host = toastHost();
    if (id) host.querySelector(`[data-toast-id="${id}"]`)?.remove();

    const text = YTPV.el('span', { class: 'ytpv-toast__text' }, message);
    const node = YTPV.el('div', { class: 'ytpv-toast', role: 'status', dataset: id ? { toastId: id } : {} },
      icon ? YTPV.icon(icon, '0 0 24 24', 'ytpv-toast__icon') : null,
      text);
    const close = () => {
      node.classList.add('ytpv-toast--out');
      setTimeout(() => node.remove(), 250);
    };
    for (const a of [].concat(action || [])) {
      node.append(YTPV.el('button', {
        class: 'ytpv-toast__action',
        onclick: (e) => { e.stopPropagation(); a.onClick?.(); if (!a.keepOpen) close(); }
      }, a.label));
    }
    host.append(node);
    requestAnimationFrame(() => node.classList.add('ytpv-toast--in'));
    let timer = sticky ? null : setTimeout(close, duration);
    return {
      node,
      close,
      update(msg, newDuration) {
        text.textContent = msg;
        if (newDuration) { clearTimeout(timer); timer = setTimeout(close, newDuration); }
      }
    };
  };

  /* ---------------------------------------------------------------- */
  /* Player control buttons (match YouTube's native .ytp-button)      */
  /* ---------------------------------------------------------------- */

  /**
   * Ensure a button exists in the player's control bar.
   * side: 'right' (before settings/fullscreen) or 'left' (after volume).
   * Safe to call repeatedly (e.g. on every mutation tick).
   */
  YTPV.ensurePlayerButton = function ({ id, title, build, side = 'right' }) {
    const existing = document.getElementById(id);
    if (existing?.isConnected) return existing;
    const bar = document.querySelector(side === 'right'
      ? '#movie_player .ytp-right-controls'
      : '#movie_player .ytp-left-controls');
    if (!bar) return null;
    const btn = build();
    btn.id = id;
    btn.classList.add('ytp-button', 'ytpv-player-btn');
    btn.setAttribute('aria-label', title);
    btn.setAttribute('data-title-no-tooltip', title);
    btn.title = title;
    if (side === 'right') {
      bar.prepend(btn);
    } else {
      const vol = bar.querySelector('.ytp-volume-area');
      vol ? vol.after(btn) : bar.append(btn);
    }
    return btn;
  };

  /* ---------------------------------------------------------------- */
  /* Action bar under the video (Download / AI Summary pills)         */
  /* ---------------------------------------------------------------- */

  /**
   * Our own row of buttons, placed right above YouTube's Like / Share row and
   * kept exactly as wide as it, so the two rows line up on both sides.
   */
  let rowObserver = null;
  YTPV.ensureActionBar = function () {
    let bar = document.getElementById('ytpv-actions');
    const actions = document.querySelector('ytd-watch-metadata #actions');
    const likeRow = actions?.querySelector('#actions-inner') || actions?.querySelector('#top-level-buttons-computed');
    if (bar?.isConnected && bar.parentElement === actions) return bar;
    if (!actions) return null;
    bar = bar || YTPV.el('div', { id: 'ytpv-actions', class: 'ytpv-actions' });
    actions.prepend(bar);

    // Match the Like row's width, and follow it when it changes (window resize, translations…).
    rowObserver?.disconnect();
    if (likeRow) {
      // Measure the buttons you can actually see (Like … ⋯), not the wider box around them.
      const sync = () => {
        let left = Infinity, right = -Infinity, height = 0;
        for (const b of likeRow.querySelectorAll('button')) {
          const r = b.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          height = Math.max(height, r.height);
        }
        if (right > left) bar.style.setProperty('--ytpv-row-w', `${Math.round(right - left)}px`);
        if (height) bar.style.setProperty('--ytpv-row-h', `${Math.round(height)}px`);
      };
      rowObserver = new ResizeObserver(sync);
      rowObserver.observe(likeRow);
      sync();
    }
    return bar;
  };

  /** A pill button that looks like YouTube's Like/Share buttons. */
  YTPV.pillButton = function ({ id, label, icon, onClick, order = 0 }) {
    const btn = YTPV.el('button', { id, class: 'ytpv-pill', type: 'button', onclick: onClick, style: { order } },
      YTPV.icon(icon, '0 0 24 24', 'ytpv-pill__icon'),
      YTPV.el('span', { class: 'ytpv-pill__label' }, label));
    return btn;
  };
})();
