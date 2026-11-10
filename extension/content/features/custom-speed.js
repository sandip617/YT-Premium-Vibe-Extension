/**
 * FEATURE 3 — Custom Speed
 *
 * Keyboard shortcuts (default: D = faster, S = slower, R = reset) change
 * speed in 0.25 steps from 0.25x to 4x, with a glass on-screen indicator.
 * Optionally remembers the speed per channel.
 *
 * We set video.playbackRate directly because YouTube's own menu stops at 2x.
 */
(() => {
  const YTPV = globalThis.YTPV;
  const MIN = 0.25;
  const MAX = 4;
  const STEP = 0.25;

  let desired = 1;
  let video = null;
  let channelId = '';
  let settingRate = false;
  let indicatorTimer = null;

  const clamp = (r) => Math.min(MAX, Math.max(MIN, Math.round(r / STEP) * STEP));

  function showIndicator(rate) {
    const player = YTPV.getPlayer();
    if (!player) return;
    let ind = player.querySelector(':scope > .ytpv-speed');
    if (!ind) {
      ind = YTPV.el('div', { class: 'ytpv-speed' },
        YTPV.el('div', { class: 'ytpv-speed__value' }),
        YTPV.el('div', { class: 'ytpv-speed__bar' }, YTPV.el('div', { class: 'ytpv-speed__fill' })));
      player.append(ind);
    }
    ind.querySelector('.ytpv-speed__value').textContent = `${rate.toFixed(2).replace(/0$/, '')}×`;
    ind.querySelector('.ytpv-speed__fill').style.width = `${((rate - MIN) / (MAX - MIN)) * 100}%`;
    ind.classList.add('ytpv-speed--show');
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => ind.classList.remove('ytpv-speed--show'), 900);
  }

  function applyRate() {
    if (!video || YTPV.adActive) return;
    if (Math.abs(video.playbackRate - desired) < 0.001) return;
    settingRate = true;
    video.playbackRate = desired;
    setTimeout(() => (settingRate = false), 0);
  }

  async function saveChannelSpeed() {
    if (!YTPV.settings.speed.rememberPerChannel || !channelId) return;
    const { channelSpeeds = {} } = await YTPV.api.storage.local.get('channelSpeeds');
    if (desired === YTPV.settings.speed.defaultSpeed) delete channelSpeeds[channelId];
    else channelSpeeds[channelId] = desired;
    await YTPV.api.storage.local.set({ channelSpeeds });
  }

  function setSpeed(rate, { indicate = true, save = true } = {}) {
    desired = clamp(rate);
    applyRate();
    if (indicate) showIndicator(desired);
    if (save) saveChannelSpeed();
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || YTPV.isTyping(e)) return;
    if (!YTPV.getVideo()) return;
    const keys = YTPV.settings.speed.keys;
    const k = e.key.toLowerCase();
    let handled = true;
    if (k === keys.up) setSpeed(desired + STEP);
    else if (k === keys.down) setSpeed(desired - STEP);
    else if (k === keys.reset) setSpeed(YTPV.settings.speed.defaultSpeed || 1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  /**
   * Someone else changed the rate. Right after a video loads, that's YouTube
   * resetting it, so we put ours back. Any other time it's the user (YouTube's
   * speed menu or its Shift+> shortcut), so we adopt it as the new choice.
   */
  let loadedAt = 0;
  function onRateChange() {
    if (settingRate || YTPV.adActive || !video) return;
    if (Date.now() - loadedAt < 2500) return applyRate();
    desired = clamp(video.playbackRate);
    saveChannelSpeed();
  }
  const onLoaded = () => { loadedAt = Date.now(); applyRate(); };

  function attach(v) {
    if (video === v) return;
    if (video) {
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('loadeddata', onLoaded);
    }
    video = v;
    if (video) {
      video.addEventListener('ratechange', onRateChange);
      video.addEventListener('loadeddata', onLoaded);
      onLoaded();
    }
  }

  async function loadForVideo() {
    if (!YTPV.isWatchPage()) return;
    loadedAt = Date.now();
    const s = YTPV.settings.speed;
    let rate = s.defaultSpeed || 1;
    channelId = '';
    if (s.rememberPerChannel) {
      // Retry briefly: right after navigation the player may still hold the old video.
      const id = YTPV.getVideoId();
      for (let i = 0; i < 10; i++) {
        try {
          const info = await YTPV.page.call('videoInfo');
          if (info?.videoId === id && info.channelId) { channelId = info.channelId; break; }
        } catch (_) {}
        await YTPV.sleep(300);
      }
      if (channelId) {
        const { channelSpeeds = {} } = await YTPV.api.storage.local.get('channelSpeeds');
        if (channelSpeeds[channelId]) rate = channelSpeeds[channelId];
      }
    }
    desired = clamp(rate);
    applyRate();
    if (desired !== 1) showIndicator(desired);
  }

  const onAdEnd = () => onLoaded();

  YTPV.register({
    id: 'customSpeed',
    enable() {
      window.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('ytpv-ad-end', onAdEnd);
      attach(YTPV.getVideo());
    },
    disable() {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('ytpv-ad-end', onAdEnd);
      if (video) video.playbackRate = 1;
      attach(null);
      desired = 1;
    },
    onVideo(v) { attach(v); },
    onNavigate() { loadForVideo(); }
  });
})();
