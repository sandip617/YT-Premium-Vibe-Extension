/**
 * FEATURE 9 — Download button
 *
 * Adds a "Download" pill under the video with two choices:
 * best-quality video, or audio only. The download itself runs in yt-dlp on
 * your Mac. Path: content script → background → native messaging →
 * SafariWebExtensionHandler.swift (in the macOS app) → yt-dlp.
 * Progress is polled once per second and shown on the button.
 */
(() => {
  const YTPV = globalThis.YTPV;
  const ID = 'ytpv-download-btn';
  const MENU_ID = 'ytpv-download-menu';
  const jobs = new Map(); // videoId -> { jobId, mode, percent, state, title }

  const native = (payload) => YTPV.send({ type: 'native', payload });

  // Installs Homebrew (if missing), then yt-dlp + ffmpeg. Used only when this Mac has no Python 3.10+.
  const BREW_SETUP = 'command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; ' +
    'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install yt-dlp ffmpeg';

  function cliCommand(url, mode) {
    const s = YTPV.settings.download;
    const out = `${s.folder || '~/Downloads'}/%(title)s [%(id)s].%(ext)s`;
    return mode === 'audio'
      ? `yt-dlp -f ba -x --audio-format ${s.audioFormat} -o "${out}" "${url}"`
      : `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "${out}" "${url}"`;
  }

  function copy(text, done = 'Copied') {
    navigator.clipboard.writeText(text).then(
      () => YTPV.toast(done, { duration: 1800 }),
      () => YTPV.toast('Could not copy to clipboard', { duration: 2000 })
    );
  }

  function explainError(res, url, mode) {
    if (res?.error === 'python_missing') {
      YTPV.toast('One-time setup: the downloader needs Homebrew’s yt-dlp on this Mac.', {
        sticky: true,
        action: [
          { label: 'Copy setup command', onClick: () => copy(BREW_SETUP, 'Copied. Paste it in Terminal, press Enter, then try again.') },
          { label: 'Dismiss' }
        ]
      });
    } else if (res?.error === 'ytdlp_missing') {
      YTPV.toast(res.message || 'The downloader could not be set up.', {
        sticky: true,
        action: [{ label: 'Try again', onClick: () => start(mode) }, { label: 'Dismiss' }]
      });
    } else if (res?.error === 'ytdlp_standalone') {
      YTPV.toast('Your yt-dlp is the standalone build, which Safari’s sandbox blocks. Replace it with the Python version.', {
        sticky: true,
        action: [
          { label: 'Copy fix command', onClick: () => copy(res.fix, 'Command copied. Paste it in Terminal, then try again.') },
          { label: 'Dismiss' }
        ]
      });
    } else if (res?.error === 'native_unavailable') {
      YTPV.toast('Can’t reach the YT Premium Vibe app. Open it once from Applications, then try again.', {
        sticky: true,
        action: [{ label: 'Copy yt-dlp command', onClick: () => copy(cliCommand(url, mode)) }, { label: 'Dismiss' }]
      });
    } else {
      YTPV.toast(`Download failed: ${res?.message || res?.error || 'unknown error'}`, {
        sticky: true,
        action: [{ label: 'Copy yt-dlp command', onClick: () => copy(cliCommand(url, mode)) }, { label: 'Dismiss' }]
      });
    }
  }

  async function start(mode) {
    closeMenu();
    const videoId = YTPV.getVideoId();
    if (!videoId || jobs.has(videoId)) return;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const title = document.querySelector('ytd-watch-metadata h1')?.textContent.trim() || 'video';
    const s = YTPV.settings.download;

    jobs.set(videoId, { mode, percent: 0, state: 'starting', title });
    render();
    const slow = setTimeout(() => YTPV.toast('Setting up the downloader (first time only)…', { id: 'dl-setup', duration: 6000 }), 2500);
    const res = await native({
      cmd: 'download', url, mode,
      folder: s.folder, audioFormat: s.audioFormat, quicktime: s.quicktimeCompatible
    });
    clearTimeout(slow);
    if (!res?.ok) {
      jobs.delete(videoId);
      render();
      return explainError(res, url, mode);
    }
    jobs.get(videoId).jobId = res.jobId;
    YTPV.toast(mode === 'audio' ? 'Downloading audio…' : 'Downloading best quality…', { icon: YTPV.ICONS.download, duration: 2200 });
    poll(videoId, url);
  }

  async function poll(videoId, url) {
    const job = jobs.get(videoId);
    if (!job) return;
    const res = await native({ cmd: 'status', jobId: job.jobId });
    if (!res?.ok) {
      jobs.delete(videoId);
      render();
      return explainError(res, url, job.mode);
    }
    job.state = res.state;
    job.percent = res.percent ?? job.percent;
    job.speed = res.speed;
    job.eta = res.eta;
    render();

    if (res.state === 'done') {
      jobs.delete(videoId);
      render();
      const name = res.file ? res.file.split('/').pop() : job.title;
      YTPV.toast(`Done ✓  ${name}`, {
        icon: YTPV.ICONS.check,
        duration: 10000,
        action: res.file ? { label: 'Show in Finder', onClick: () => native({ cmd: 'reveal', path: res.file }) } : null
      });
    } else if (res.state === 'error') {
      jobs.delete(videoId);
      render();
      explainError({ message: res.message }, url, job.mode);
    } else if (res.state === 'cancelled') {
      jobs.delete(videoId);
      render();
      YTPV.toast('Download cancelled', { duration: 2000 });
    } else {
      setTimeout(() => poll(videoId, url), 1000);
    }
  }

  async function cancel() {
    closeMenu();
    const job = jobs.get(YTPV.getVideoId());
    if (job?.jobId) await native({ cmd: 'cancel', jobId: job.jobId });
  }

  /* ------------------------------ UI ------------------------------ */

  function closeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function openMenu(btn) {
    if (document.getElementById(MENU_ID)) return closeMenu();
    const job = jobs.get(YTPV.getVideoId());
    const item = (icon, title, sub, onClick) =>
      YTPV.el('button', { class: 'ytpv-menu__item', type: 'button', onclick: onClick },
        YTPV.icon(icon, '0 0 24 24', 'ytpv-menu__icon'),
        YTPV.el('span', { class: 'ytpv-menu__text' },
          YTPV.el('span', { class: 'ytpv-menu__title' }, title),
          YTPV.el('span', { class: 'ytpv-menu__sub' }, sub)));

    const menu = YTPV.el('div', { id: MENU_ID, class: 'ytpv-menu' },
      job
        ? item(YTPV.ICONS.close, 'Cancel download', `${Math.round(job.percent || 0)}% done`, cancel)
        : [
            item(YTPV.ICONS.film, 'Best quality video', YTPV.settings.download.quicktimeCompatible ? 'MP4 · H.264 (QuickTime)' : 'MP4 · highest resolution', () => start('video')),
            item(YTPV.ICONS.music, 'Audio only', YTPV.settings.download.audioFormat.toUpperCase(), () => start('audio'))
          ],
      YTPV.el('div', { class: 'ytpv-menu__foot' }, `Saves to ${YTPV.settings.download.folder}`));
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom + 8}px`, left: `${Math.max(8, r.left)}px` });
    document.body.append(menu);
    requestAnimationFrame(() => menu.classList.add('ytpv-menu--in'));
  }

  function render() {
    const btn = document.getElementById(ID);
    if (!btn) return;
    const job = jobs.get(YTPV.getVideoId());
    const label = btn.querySelector('.ytpv-pill__label');
    if (!job) {
      label.textContent = 'Download';
      btn.classList.remove('ytpv-pill--busy');
      btn.style.removeProperty('--p');
      btn.title = 'Download with yt-dlp';
      return;
    }
    btn.classList.add('ytpv-pill--busy');
    const pct = Math.round(job.percent || 0);
    btn.style.setProperty('--p', `${pct}%`);
    label.textContent =
      job.state === 'processing' ? 'Finishing…' :
      job.state === 'starting' ? 'Starting…' : `${pct}%`;
    btn.title = job.speed ? `${job.speed} · ETA ${job.eta || '?'}` : 'Downloading…';
  }

  function ensure() {
    if (!YTPV.isWatchPage()) return;
    const bar = YTPV.ensureActionBar();
    if (!bar || document.getElementById(ID)) return;
    const btn = YTPV.pillButton({
      id: ID, label: 'Download', icon: YTPV.ICONS.download, order: 2,
      onClick: (e) => { e.stopPropagation(); openMenu(btn); }
    });
    bar.append(btn);
    render();
  }

  const outside = (e) => {
    if (!e.target.closest?.(`#${MENU_ID}, #${ID}`)) closeMenu();
  };

  YTPV.register({
    id: 'download',
    enable() { document.addEventListener('click', outside, true); },
    disable() {
      document.removeEventListener('click', outside, true);
      document.getElementById(ID)?.remove();
      closeMenu();
    },
    onNavigate() { closeMenu(); ensure(); render(); },
    onMutation: ensure
  });
})();
