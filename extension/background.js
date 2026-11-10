/**
 * YT Premium Vibe — background service worker.
 *
 * Does the work content scripts can't (or shouldn't) do themselves:
 *   1. SponsorBlock API lookups (privacy-preserving hash prefix)
 *   2. Gemini API calls, streamed back to the page over a Port
 *   3. Native messaging to the containing macOS app (yt-dlp downloads)
 *   4. Turning the network ad-block ruleset on/off with the Ad Blocker toggle
 */
importScripts('shared/settings.js');

const api = globalThis.browser || globalThis.chrome;
const NATIVE_APP_ID = 'com.ytpremiumvibe.app'; // Safari ignores the value, but it's required.

/* ------------------------------------------------------------------ */
/* 1. SponsorBlock                                                    */
/* ------------------------------------------------------------------ */

const sponsorCache = new Map(); // key: videoId|categories -> segments

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSponsorSegments(videoId, categories) {
  const key = `${videoId}|${categories.join(',')}`;
  if (sponsorCache.has(key)) return sponsorCache.get(key);

  // Only the first 4 hash characters leave the browser, so SponsorBlock
  // never learns exactly which video you are watching.
  const prefix = (await sha256Hex(videoId)).slice(0, 4);
  const url =
    `https://sponsor.ajay.app/api/skipSegments/${prefix}` +
    `?categories=${encodeURIComponent(JSON.stringify(categories))}` +
    `&actionTypes=${encodeURIComponent(JSON.stringify(['skip']))}`;

  const res = await fetch(url);
  let segments = [];
  if (res.ok) {
    const list = await res.json();
    const match = list.find((v) => v.videoID === videoId);
    segments = (match?.segments || []).map((s) => ({
      start: s.segment[0],
      end: s.segment[1],
      category: s.category,
      uuid: s.UUID
    }));
  } else if (res.status !== 404) {
    throw new Error(`SponsorBlock HTTP ${res.status}`);
  }
  sponsorCache.set(key, segments);
  if (sponsorCache.size > 200) sponsorCache.delete(sponsorCache.keys().next().value);
  return segments;
}

/* ------------------------------------------------------------------ */
/* 2. Gemini (streaming over a Port)                                  */
/* ------------------------------------------------------------------ */

// Models tried in order (checked Nov 2026: gemini-2.0-flash is shut down,
// gemini-2.5-flash is deprecated). "fast" models start writing almost at once;
// "smart" models think a little first, so they take longer.
const MODELS = {
  fast: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
  smart: ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']
};
const THINKING = { fast: 'minimal', smart: 'low' };

// Models that rejected our optional settings, and models that don't exist:
// remembered so later requests don't waste a round trip on them.
const leanModels = new Set();
const missingModels = new Set();

function geminiError(status, body) {
  const msg = body?.error?.message || '';
  const reason = JSON.stringify(body?.error?.details || '');
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(msg + reason))
    return { code: 'bad_key', message: 'Your Gemini API key is not valid. Check it in the extension settings.' };
  if (status === 403)
    return { code: 'forbidden', message: 'Gemini refused the request (403). Make sure the key is enabled for the Generative Language API.' };
  if (status === 429)
    return { code: 'rate_limit', message: 'Gemini free-tier rate limit reached. Wait a minute and try again.' };
  if (status === 404) return { code: 'no_model', message: msg || 'Model not found.' };
  if (status >= 500) return { code: 'server', message: `Gemini is having trouble right now (HTTP ${status}${msg ? `: ${msg}` : ''}). Try again shortly.` };
  return { code: 'http', message: msg || `Gemini error (HTTP ${status}).` };
}

/**
 * Stream a generateContent call. Calls onChunk(text) for each piece.
 * Tries fallback models if the configured one doesn't exist.
 */
/** Pull the answer text out of one generateContent response object. */
function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const block = data?.promptFeedback?.blockReason;
  if (block) throw { code: 'blocked', message: `Gemini blocked this request (${block}).` };
  return parts.map((p) => (p.thought ? '' : p.text || '')).join('');
}

async function streamGemini({ apiKey, speed = 'fast', customModel, systemInstruction, contents, useLowMediaRes }, onChunk, signal) {
  const list = MODELS[speed] || MODELS.fast;
  const ordered = customModel ? [customModel, ...list.filter((m) => m !== customModel)] : list;
  const models = ordered.filter((m) => !missingModels.has(m));
  const base = 'https://generativelanguage.googleapis.com/v1beta/models/';
  let lastErr;
  let stream = true; // fall back to a single non-streamed answer if streaming fails

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const lean = leanModels.has(m); // this model rejected our optional settings before
    const url = stream
      ? `${base}${encodeURIComponent(m)}:streamGenerateContent?alt=sse`
      : `${base}${encodeURIComponent(m)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents
    };
    if (!lean) {
      body.generationConfig = {
        temperature: 0.4,
        thinkingConfig: { thinkingLevel: THINKING[speed] || 'low' } // less thinking = faster first words
      };
      if (useLowMediaRes) body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
    }

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (stream) { stream = false; i--; continue; } // retry this model without streaming
      throw e;
    }

    if (!res.ok) {
      let json = null;
      try { json = await res.json(); } catch (_) {}
      lastErr = geminiError(res.status, json);
      const msg = json?.error?.message || '';
      // An optional field (temperature / mediaResolution) isn't accepted: retry without it.
      if (res.status === 400 && !lean && /Unknown name|Invalid JSON|mediaResolution|temperature|thinking/i.test(msg)) {
        leanModels.add(m); i--; continue;
      }
      // Model missing, or that model's servers are overloaded: try the next model.
      if (lastErr.code === 'no_model') { missingModels.add(m); continue; }
      if (lastErr.code === 'server') continue;
      throw lastErr;
    }

    if (!stream) {
      const text = extractText(await res.json());
      if (!text) throw { code: 'empty', message: 'Gemini returned an empty answer. Try again.' };
      onChunk(text);
      return m;
    }

    // Parse Server-Sent Events: lines of "data: {json}"
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotText = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const text = extractText(JSON.parse(line.slice(5)));
          if (text) { gotText = true; onChunk(text); }
        } catch (e) {
          if (e?.code) throw e;
        }
      }
    }
    if (!gotText) throw { code: 'empty', message: 'Gemini returned an empty answer. Try again.' };
    return m;
  }
  throw lastErr || { code: 'no_model', message: 'No Gemini model available.' };
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ytpv-gemini') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (req) => {
    if (req?.type === 'heartbeat') return; // only keeps this worker awake
    try {
      const model = await streamGemini(req, (text) => port.postMessage({ type: 'chunk', text }), controller.signal);
      port.postMessage({ type: 'done', model });
    } catch (e) {
      if (controller.signal.aborted) return;
      const err = e?.code ? e : { code: 'network', message: 'Could not reach Gemini. Check your internet connection.' };
      try { port.postMessage({ type: 'error', ...err }); } catch (_) {}
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Native messaging (yt-dlp via the macOS app)                     */
/* ------------------------------------------------------------------ */

async function sendNative(message) {
  try {
    return await api.runtime.sendNativeMessage(NATIVE_APP_ID, message);
  } catch (e) {
    return { ok: false, error: 'native_unavailable', message: String(e?.message || e) };
  }
}

/* ------------------------------------------------------------------ */
/* 4. Network ad-block ruleset follows the Ad Blocker toggle          */
/* ------------------------------------------------------------------ */

async function syncAdRules(settings) {
  if (!api.declarativeNetRequest?.updateEnabledRulesets) return;
  const on = settings.features.adBlocker;
  try {
    await api.declarativeNetRequest.updateEnabledRulesets(
      on ? { enableRulesetIds: ['ad_rules'] } : { disableRulesetIds: ['ad_rules'] }
    );
  } catch (e) {
    console.warn('[YT Vibe] could not toggle ad rules', e);
  }
}

YTPVSettings.onChange(syncAdRules);
api.runtime.onInstalled.addListener(async () => {
  const s = await YTPVSettings.load();
  await YTPVSettings.save(s); // write defaults for new options
  syncAdRules(s);
});
api.runtime.onStartup?.addListener(async () => syncAdRules(await YTPVSettings.load()));

/* ------------------------------------------------------------------ */
/* Message router                                                     */
/* ------------------------------------------------------------------ */

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'sponsorblock':
        return { ok: true, segments: await getSponsorSegments(msg.videoId, msg.categories) };
      case 'native':
        return await sendNative(msg.payload);
      default:
        return { ok: false, error: 'unknown_message' };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // keep the channel open for the async response
});
