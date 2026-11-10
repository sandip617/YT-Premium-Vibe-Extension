/**
 * FEATURE 5 — Picture-in-Picture
 * Adds a native-looking PiP button to the player's right controls.
 */
(() => {
  const YTPV = globalThis.YTPV;
  const ID = 'ytpv-pip-btn';

  async function togglePip() {
    const v = YTPV.getVideo();
    if (!v) return;
    try {
      v.disablePictureInPicture = false;
      v.removeAttribute('disablepictureinpicture');
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (v.requestPictureInPicture) {
        await v.requestPictureInPicture();
      } else if (v.webkitSupportsPresentationMode?.('picture-in-picture')) {
        // Older Safari API
        v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      }
    } catch (e) {
      YTPV.toast('Picture-in-Picture is not available for this video', { duration: 2500 });
    }
  }

  function ensure() {
    if (!YTPV.isWatchPage()) return;
    YTPV.ensurePlayerButton({
      id: ID,
      title: 'Picture-in-Picture',
      side: 'right',
      build: () => {
        const b = YTPV.el('button', { onclick: togglePip });
        b.append(YTPV.icon(YTPV.ICONS.pip, '-6 -6 36 36', 'ytpv-player-icon'));
        return b;
      }
    });
  }

  YTPV.register({
    id: 'pip',
    disable() { document.getElementById(ID)?.remove(); },
    onNavigate: ensure,
    onMutation: ensure
  });
})();
