/**
 * Talks to page/bridge.js (YouTube's main world) via window.postMessage.
 *   const levels = await YTPV.page.call('qualityLevels');
 */
(() => {
  const YTPV = globalThis.YTPV;
  const pending = new Map();
  let seq = 0;
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));

  /**
   * page/bridge.js is started by the manifest in YouTube's main world
   * ("world": "MAIN"). Ping it until it answers, then mark it ready.
   */
  YTPV.connectBridge = async function () {
    for (let i = 0; i < 20; i++) {
      if (await ping(500)) return true;
    }
    console.warn('[YT Vibe] page bridge did not answer');
    return false;
  };

  function ping(timeout) {
    return new Promise((resolve) => {
      const id = `ytpv-ping-${++seq}`;
      const timer = setTimeout(() => { pending.delete(id); resolve(false); }, timeout);
      pending.set(id, { resolve: () => { readyResolve(); resolve(true); }, reject: () => resolve(false), timer });
      window.postMessage({ source: 'ytpv-content', id, type: 'ping', payload: {} }, '*');
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.source !== 'ytpv-page') return;
    if (msg.type === 'ready') return readyResolve();
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
  });

  YTPV.page = {
    ready,
    /** Call a bridge command; rejects after `timeout` ms. */
    async call(type, payload = {}, timeout = 8000) {
      await Promise.race([ready, YTPV.sleep(3000)]);
      const id = `ytpv-${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`bridge timeout: ${type}`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        window.postMessage({ source: 'ytpv-content', id, type, payload }, '*');
      });
    }
  };
})();
