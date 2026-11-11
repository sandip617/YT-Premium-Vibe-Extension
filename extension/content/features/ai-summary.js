/**
 * FEATURE 10 — AI Summary (Google Gemini)
 *
 * "AI Summary" pill → a glass side panel on the same page.
 *   1. Gets the transcript: captions via the page bridge → the on-page
 *      "Show transcript" panel → if neither works, sends the video URL so
 *      Gemini watches the video itself.
 *   2. Streams a chapter-by-chapter, teacher-style study summary
 *      in English or Bangla.
 *   3. Follow-up chat in the same panel ("explain this part in Bangla").
 * Timestamps like [4:05] in answers are clickable and seek the video.
 */
(() => {
  const YTPV = globalThis.YTPV;
  const { el, icon, ICONS } = YTPV;
  const BTN_ID = 'ytpv-ai-btn';
  const PANEL_ID = 'ytpv-ai-panel';
  const MAX_TRANSCRIPT_CHARS = 600000; // ~150k tokens, well inside Gemini's context

  // One conversation per video + language, kept for this tab session.
  const sessions = new Map();
  let current = null; // active session
  let activeStream = null; // { port, finish } while an answer is streaming
  let panel = null;
  let ui = {};

  /* ================================================================ */
  /* Prompts                                                          */
  /* ================================================================ */

  function systemPrompt(lang) {
    const langRule = lang === 'bn'
      ? 'Write in Bangla (বাংলা) using simple, natural, everyday Bangla that a student understands easily. The first time an important technical term appears, keep the English word in brackets, e.g. সালোকসংশ্লেষণ (photosynthesis).'
      : 'Write in clear, simple English.';
    return [
      'You are "Vibe Tutor", a friendly and patient teacher. You help a student understand a YouTube video well enough to do well in an exam on it.',
      'Rules:',
      '- Explain simply and clearly: short sentences, everyday words, and a small example when it helps.',
      '- Define each technical term the first time it appears.',
      '- Stay faithful to the video. Never invent facts that are not in it; if something is unclear, say so.',
      '- Use Markdown: "## " for sections, "### " for chapters, bullet points, and **bold** for key terms.',
      '- When you refer to a moment in the video, write its timestamp in square brackets like [4:05] or [1:02:30].',
      `- ${langRule}`,
      '- In follow-up questions, if the student asks for a specific language (for example "explain in Bangla"), answer in that language.'
    ].join('\n');
  }

  function extractChapters(description) {
    return (description || '')
      .split('\n')
      .filter((l) => /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s+\S/.test(l))
      .slice(0, 60)
      .join('\n');
  }

  function summaryRequest(info, sourceNote) {
    const chapters = extractChapters(info.description);
    return [
      'Summarize this video so I can study it for an exam.',
      '',
      `Title: ${info.title}`,
      `Channel: ${info.author}`,
      info.lengthSeconds ? `Length: ${YTPV.formatTime(info.lengthSeconds)}` : '',
      chapters ? `\nThe creator's own chapters:\n${chapters}` : '',
      '',
      'Use exactly this structure:',
      '## In one line',
      'One sentence about what the video teaches.',
      '## Chapter by chapter',
      chapters
        ? "Follow the creator's chapters above."
        : 'Split the video into logical chapters yourself (usually 4–10).',
      'For each chapter write "### [timestamp] Chapter title", then 3–6 bullet points that explain it like a teacher: what it is, why it matters, and a simple example if helpful.',
      '## Key terms',
      'Short, simple definitions of the important words.',
      '## Key takeaways',
      '3–6 bullets I must remember.',
      '## Exam practice',
      '5 likely exam questions, each followed by a short model answer.',
      '',
      sourceNote
    ].filter((l) => l !== null).join('\n');
  }

  /* ================================================================ */
  /* Transcript                                                       */
  /* ================================================================ */

  function formatTranscript(segments) {
    // Merge short caption lines into ~20 second blocks to save tokens.
    const lines = [];
    let block = null;
    for (const s of segments) {
      if (!block || s.start - block.start > 20) {
        if (block) lines.push(`[${YTPV.formatTime(block.start)}] ${block.text}`);
        block = { start: s.start, text: s.text };
      } else {
        block.text += ' ' + s.text;
      }
    }
    if (block) lines.push(`[${YTPV.formatTime(block.start)}] ${block.text}`);
    let text = lines.join('\n');
    if (text.length > MAX_TRANSCRIPT_CHARS) text = text.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[transcript truncated]';
    return text;
  }

  const parseTs = (t) => t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);

  /** Fallback: open YouTube's own transcript panel and read it from the page. */
  async function scrapeTranscriptPanel() {
    const btn = document.querySelector(
      'ytd-video-description-transcript-section-renderer button, ' +
      'ytd-video-description-transcript-section-renderer yt-button-shape button'
    );
    if (!btn) return [];
    const panelSel = 'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]';
    const wasOpen = document.querySelector(panelSel)?.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
    btn.click();
    let nodes = [];
    for (let i = 0; i < 25; i++) {
      await YTPV.sleep(250);
      nodes = document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model');
      if (nodes.length) break;
    }
    const segments = [];
    for (const n of nodes) {
      const raw = n.textContent.replace(/\s+/g, ' ').trim();
      const m = raw.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(.*)$/);
      if (m && m[2]) segments.push({ start: parseTs(m[1]), text: m[2] });
    }
    if (!wasOpen) {
      document.querySelector(`${panelSel} #visibility-button button, ${panelSel} button[aria-label*="Close" i]`)?.click();
    }
    return segments;
  }

  async function getTranscript(info) {
    const pref = YTPV.settings.gemini.language === 'bn' ? ['bn', 'en', 'hi'] : ['en', 'bn', 'hi'];
    try {
      const res = await YTPV.page.call('transcript', { languages: pref }, 20000);
      if (res?.segments?.length) return { segments: res.segments, via: 'captions' };
    } catch (e) {
      console.warn('[YT Vibe] transcript via captions failed', e);
    }
    if (info.videoId !== YTPV.getVideoId()) return { segments: [] };
    try {
      const segs = await scrapeTranscriptPanel();
      if (segs.length) return { segments: segs, via: 'transcript panel' };
    } catch (_) {}
    return { segments: [] };
  }

  /* ================================================================ */
  /* Markdown → DOM (no innerHTML, so it's Trusted-Types safe)        */
  /* ================================================================ */

  const TS_RE = /\[?\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b\]?/;
  const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\s][^*]*\*(?!\*)|\[?\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b\]?)/g;

  function seek(seconds) {
    const v = YTPV.getVideo();
    if (!v) return;
    v.currentTime = seconds;
    v.play?.().catch(() => {});
  }

  function inline(text) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(INLINE_RE)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) frag.append(el('strong', {}, inline(tok.slice(2, -2))));
      else if (tok.startsWith('`')) frag.append(el('code', {}, tok.slice(1, -1)));
      else if (tok.startsWith('*')) frag.append(el('em', {}, tok.slice(1, -1)));
      else {
        const t = tok.match(TS_RE)[1];
        const secs = parseTs(t);
        const max = current?.info?.lengthSeconds;
        if (max && secs > max + 5) frag.append(tok); // not a real timestamp
        else frag.append(el('button', { class: 'ytpv-ts', type: 'button', title: 'Jump to this moment', onclick: () => seek(secs) }, t));
      }
      last = m.index + tok.length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function renderMarkdown(src) {
    const root = document.createDocumentFragment();
    const lines = src.replace(/\r/g, '').split('\n');
    let list = null;
    let para = [];
    let code = null;

    const flushPara = () => {
      if (para.length) root.append(el('p', {}, inline(para.join(' '))));
      para = [];
    };
    const closeList = () => { list = null; };

    for (const raw of lines) {
      if (code) {
        if (/^```/.test(raw)) { root.append(el('pre', {}, el('code', {}, code.join('\n')))); code = null; }
        else code.push(raw);
        continue;
      }
      if (/^```/.test(raw)) { flushPara(); closeList(); code = []; continue; }

      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushPara(); closeList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList();
        const level = Math.min(6, m[1].length + 1); // # → h2, ## → h3 ...
        root.append(el(`h${Math.max(3, level)}`, { class: `ytpv-md-h${m[1].length}` }, inline(m[2].replace(/\*\*/g, ''))));
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); root.append(el('hr')); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); closeList(); root.append(el('blockquote', {}, inline(m[1]))); continue; }
      if ((m = line.match(/^(\s*)(?:[-*•]|(\d+)[.)])\s+(.*)$/))) {
        flushPara();
        const ordered = !!m[2];
        const nested = m[1].length >= 2;
        const tag = ordered ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = el(tag);
          root.append(list);
        }
        list.append(el('li', { class: nested ? 'ytpv-md-nested' : null }, inline(m[3])));
        continue;
      }
      closeList();
      para.push(line.trim());
    }
    if (code) root.append(el('pre', {}, el('code', {}, code.join('\n'))));
    flushPara();
    return root;
  }

  /* ================================================================ */
  /* Panel UI                                                         */
  /* ================================================================ */

  function buildPanel() {
    if (panel?.isConnected) return panel;
    const lang = YTPV.settings.gemini.language;

    const segBtn = (code, label) => el('button', {
      type: 'button', class: 'ytpv-seg__btn', dataset: { lang: code },
      'aria-pressed': String(lang === code), onclick: () => switchLanguage(code)
    }, label);

    ui.seg = el('div', { class: 'ytpv-seg', role: 'group', 'aria-label': 'Summary language' },
      segBtn('en', 'English'), segBtn('bn', 'বাংলা'));
    ui.refresh = el('button', { class: 'ytpv-iconbtn', type: 'button', title: 'Summarize again', onclick: () => regenerate() },
      icon(ICONS.refresh));
    const closeBtn = el('button', { class: 'ytpv-iconbtn', type: 'button', title: 'Close (Esc)', onclick: () => closePanel() },
      icon(ICONS.close));

    ui.title = el('div', { class: 'ytpv-ai__video' });
    ui.badge = el('span', { class: 'ytpv-badge', hidden: true });
    ui.body = el('div', { class: 'ytpv-ai__body' });

    const chips = ['Explain this in Bangla', 'Make it simpler', 'Quiz me with 5 MCQs', 'Give me short exam notes']
      .map((t) => el('button', { type: 'button', class: 'ytpv-chip', onclick: () => ask(t) }, t));
    ui.chips = el('div', { class: 'ytpv-ai__chips' }, chips);

    ui.input = el('textarea', { class: 'ytpv-ai__input', rows: '1', placeholder: 'Ask a follow-up… e.g. “explain chapter 2 in Bangla”' });
    ui.input.addEventListener('input', autosize);
    ui.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    ui.send = el('button', { class: 'ytpv-ai__send', type: 'submit', title: 'Send' }, icon(ICONS.send));
    const form = el('form', { class: 'ytpv-ai__composer', onsubmit: (e) => { e.preventDefault(); submit(); } }, ui.input, ui.send);

    panel = el('aside', { id: PANEL_ID, class: 'ytpv-ai', 'aria-label': 'AI Summary' },
      el('header', { class: 'ytpv-ai__head' },
        el('div', { class: 'ytpv-ai__brand' },
          el('span', { class: 'ytpv-ai__logo' }, icon(ICONS.sparkle)),
          el('div', {},
            el('div', { class: 'ytpv-ai__name' }, 'AI Summary'),
            el('div', { class: 'ytpv-ai__sub' }, `Gemini ${YTPV.settings.gemini.speed === 'smart' ? 'Smart' : 'Fast'} · Vibe Tutor`))),
        el('div', { class: 'ytpv-ai__controls' }, ui.seg, ui.refresh, closeBtn)),
      el('div', { class: 'ytpv-ai__meta' }, ui.title, ui.badge),
      ui.body,
      ui.chips,
      form);

    // Keep YouTube's keyboard shortcuts (k, j, l, f, m...) out of the panel.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      panel.addEventListener(type, (e) => {
        if (e.key === 'Escape' && type === 'keydown') closePanel();
        e.stopPropagation();
      });
    }
    document.body.append(panel);
    return panel;
  }

  function autosize() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(140, ui.input.scrollHeight)}px`;
  }

  function setBusy(busy) {
    panel?.classList.toggle('ytpv-ai--busy', busy);
    ui.send.replaceChildren(icon(busy ? ICONS.close : ICONS.send));
    ui.send.title = busy ? 'Stop' : 'Send';
    ui.refresh.disabled = busy;
  }

  function scrollToBottom(force = false) {
    const b = ui.body;
    if (force || b.scrollHeight - b.scrollTop - b.clientHeight < 140) b.scrollTop = b.scrollHeight;
  }

  function statusCard(text) {
    return el('div', { class: 'ytpv-status' }, el('span', { class: 'ytpv-spinner' }), el('span', {}, text));
  }

  function messageNode(msg) {
    if (msg.role === 'user') {
      return el('div', { class: 'ytpv-msg ytpv-msg--user' }, el('div', { class: 'ytpv-msg__bubble' }, msg.display || msg.text));
    }
    const content = el('div', { class: 'ytpv-msg__md' });
    content.append(renderMarkdown(msg.text || ''));
    const copyBtn = el('button', {
      class: 'ytpv-msg__copy', type: 'button', title: 'Copy',
      onclick: () => navigator.clipboard.writeText(msg.text).then(() => {
        copyBtn.classList.add('ytpv-msg__copy--done');
        setTimeout(() => copyBtn.classList.remove('ytpv-msg__copy--done'), 1200);
      })
    }, icon(ICONS.copy), icon(ICONS.check));
    return el('div', { class: 'ytpv-msg ytpv-msg--model' }, content, msg.text ? copyBtn : null);
  }

  function renderSession() {
    if (!panel || !current) return;
    ui.title.textContent = current.info?.title || '';
    ui.badge.hidden = !current.source;
    ui.badge.textContent = current.source === 'video' ? 'Source: video (no transcript)' : `Source: ${current.source || ''}`;
    ui.badge.classList.toggle('ytpv-badge--video', current.source === 'video');
    for (const b of ui.seg.children) b.setAttribute('aria-pressed', String(b.dataset.lang === current.lang));
    ui.body.replaceChildren(...current.messages.filter((m) => !m.hidden).map(messageNode));
    ui.chips.hidden = !current.messages.some((m) => m.role === 'model' && m.text);
  }

  /* ---------------- Errors & API key ---------------- */

  function keyCard(message) {
    const input = el('input', { class: 'ytpv-key__input', type: 'password', placeholder: 'Paste your Gemini API key', autocomplete: 'off' });
    const note = el('p', { class: 'ytpv-key__note' });
    const save = () => {
      const key = input.value.trim();
      if (!key) return input.focus();
      note.textContent = 'Saving…';
      // Use the key right away; saving it to storage happens in the background.
      YTPV.settings.gemini.apiKey = key;
      YTPVSettings.update('gemini.apiKey', key)
        .then(() => YTPV.toast('Gemini key saved', { icon: ICONS.check, duration: 2000 }))
        .catch((e) => {
          console.warn('[YT Vibe] saving key failed', e);
          YTPV.toast(`Key works for now, but saving failed: ${e?.message || e}`, { duration: 8000 });
        });
      try {
        regenerate();
      } catch (e) {
        note.textContent = `Error: ${e?.message || e}`;
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    return el('div', { class: 'ytpv-card' },
      el('div', { class: 'ytpv-card__title' }, 'Connect Google Gemini'),
      el('p', {}, message || 'Paste your free Gemini API key once. It stays on this Mac, with a backup in your Mac’s Keychain, so you won’t have to paste it again.'),
      el('ol', { class: 'ytpv-card__steps' },
        el('li', {}, 'Open ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey')),
        el('li', {}, 'Click “Create API key” and copy it'),
        el('li', {}, 'Paste it below')),
      el('div', { class: 'ytpv-key' }, input, el('button', { class: 'ytpv-btn', type: 'button', onclick: save }, 'Save & summarize')),
      note);
  }

  function errorCard(err, retry) {
    if (err.code === 'bad_key' || err.code === 'no_key') return keyCard(err.message);
    const title = {
      rate_limit: 'Slow down a little',
      network: 'No connection',
      blocked: 'Request blocked',
      live: 'Live stream'
    }[err.code] || 'Something went wrong';
    return el('div', { class: 'ytpv-card ytpv-card--error' },
      el('div', { class: 'ytpv-card__title' }, title),
      el('p', {}, err.message || 'Unknown error.'),
      retry ? el('button', { class: 'ytpv-btn', type: 'button', onclick: retry }, 'Try again') : null);
  }

  /* ================================================================ */
  /* Gemini calls                                                     */
  /* ================================================================ */

  /** Stop the answer that is currently streaming (keeps any text received so far). */
  function stopStream() {
    const s = activeStream;
    activeStream = null;
    if (!s) return;
    try { s.port.disconnect(); } catch (_) {}
    s.finish(null);
  }

  /** Build the "contents" array. Follow-ups drop the heavy video part to save quota. */
  function buildContents(session, { followUp }) {
    return session.messages.map((m, i) => {
      if (i === 0 && session.source === 'video') {
        const parts = [{ text: m.text }];
        if (!followUp) parts.unshift({ fileData: { fileUri: session.videoUrl, mimeType: 'video/*' } });
        else parts.push({ text: '(The video itself was provided earlier; use your summary above as context.)' });
        return { role: 'user', parts };
      }
      return { role: m.role, parts: [{ text: m.text }] };
    }).filter((c) => c.parts.some((p) => p.text || p.fileData));
  }

  function stream(session, { followUp, attempt = 0 }) {
    return new Promise((resolve) => {
      const reply = { role: 'model', text: '' };
      session.messages.push(reply);
      const node = messageNode(reply);
      const md = node.querySelector('.ytpv-msg__md');
      md.append(el('span', { class: 'ytpv-typing' }, el('i'), el('i'), el('i')));
      ui.body.append(node);
      scrollToBottom(true);
      setBusy(true);

      let raf = false;
      const paint = () => {
        raf = false;
        md.replaceChildren(renderMarkdown(reply.text), el('span', { class: 'ytpv-caret' }));
        scrollToBottom();
      };

      stopStream();
      const thisPort = YTPV.api.runtime.connect({ name: 'ytpv-gemini' });
      let finished = false;
      // Safari may suspend an idle extension worker while Gemini is still thinking.
      // A small message every 5s keeps it awake.
      const heartbeat = setInterval(() => {
        try { thisPort.postMessage({ type: 'heartbeat' }); } catch (_) {}
      }, 5000);
      const finish = (err) => {
        if (finished) return;
        finished = true;
        clearInterval(heartbeat);
        if (activeStream?.port === thisPort) activeStream = null;
        try { thisPort.disconnect(); } catch (_) {}
        setBusy(false);
        const idx = session.messages.indexOf(reply);
        if (!reply.text && idx >= 0) session.messages.splice(idx, 1);
        if (session === current && node.isConnected) {
          if (err) node.replaceWith(errorCard(err, retryLast));
          else if (reply.text) node.replaceWith(messageNode(reply));
          else node.remove();
          ui.chips.hidden = !session.messages.some((m) => m.role === 'model' && m.text);
          scrollToBottom();
        }
        resolve(!err);
      };
      activeStream = { port: thisPort, finish };

      thisPort.onMessage.addListener((msg) => {
        if (finished) return;
        if (msg.type === 'chunk') {
          reply.text += msg.text;
          if (!raf && session === current) { raf = true; requestAnimationFrame(paint); }
        } else if (msg.type === 'done') finish(null);
        else if (msg.type === 'error') finish(msg);
      });
      thisPort.onDisconnect.addListener(() => {
        if (!finished && !reply.text && attempt < 2 && session === current) {
          // Connection dropped before any text arrived: quietly try again.
          finished = true;
          clearInterval(heartbeat);
          if (activeStream?.port === thisPort) activeStream = null;
          const idx = session.messages.indexOf(reply);
          if (idx >= 0) session.messages.splice(idx, 1);
          node.remove();
          setTimeout(() => stream(session, { followUp, attempt: attempt + 1 }).then(resolve), 800);
          return;
        }
        finish(reply.text ? null : { code: 'network', message: 'Lost the connection to the extension. Try again.' });
      });

      thisPort.postMessage({
        apiKey: YTPV.settings.gemini.apiKey,
        speed: YTPV.settings.gemini.speed || 'fast',
        customModel: (YTPV.settings.gemini.customModel || '').trim(),
        systemInstruction: systemPrompt(session.lang),
        contents: buildContents(session, { followUp }),
        useLowMediaRes: session.source === 'video' && !followUp
      });
    });
  }

  /* ================================================================ */
  /* Actions                                                          */
  /* ================================================================ */

  async function generate(session) {
    ui.body.replaceChildren(statusCard('Getting video details…'));
    if (!YTPV.settings.gemini.apiKey) {
      // Safari may have wiped storage: ask the Mac app for the backed-up key first.
      try {
        const res = await YTPV.send({ type: 'restoreSettings' });
        if (res?.apiKey) YTPV.settings.gemini.apiKey = res.apiKey;
      } catch (_) {}
      if (session !== current) return;
      if (!YTPV.settings.gemini.apiKey) {
        ui.body.replaceChildren(keyCard());
        return;
      }
    }

    // Video info (retry until the player shows the new video after navigation).
    let info = null;
    for (let i = 0; i < 8; i++) {
      try {
        const v = await YTPV.page.call('videoInfo', {}, 1500);
        if (v?.videoId === session.videoId) { info = v; break; }
      } catch (_) {
        break; // bridge not answering: use what the page shows instead
      }
      await YTPV.sleep(300);
    }
    if (session !== current) return;
    info = info || {
      videoId: session.videoId,
      title: document.querySelector('ytd-watch-metadata h1')?.textContent.trim() || document.title.replace(/ - YouTube$/, ''),
      author: document.querySelector('ytd-watch-metadata #owner #channel-name a')?.textContent.trim() || '',
      description: document.querySelector('ytd-watch-metadata #description-inner, #description')?.textContent.trim().slice(0, 5000) || '',
      lengthSeconds: Math.round(YTPV.getVideo()?.duration || 0)
    };
    session.info = info;
    ui.title.textContent = info.title;
    if (info.isLive) {
      ui.body.replaceChildren(errorCard({ code: 'live', message: 'Summaries work best on regular videos. Try again after the live stream ends.' }));
      return;
    }

    ui.body.replaceChildren(statusCard('Reading the transcript…'));
    const { segments, via } = await getTranscript(info);
    if (session !== current) return;

    let request;
    if (segments.length) {
      session.source = via;
      request = summaryRequest(info, `Here is the full transcript with timestamps:\n\n${formatTranscript(segments)}`);
    } else {
      session.source = 'video';
      ui.body.replaceChildren(statusCard('No transcript found. Asking Gemini to watch the video…'));
      request = summaryRequest(info, 'There is no transcript, so watch the attached video and base everything on what is said and shown.');
    }
    session.messages = [{ role: 'user', text: request, hidden: true }];
    renderSession();
    await stream(session, { followUp: false });
  }

  function retryLast() {
    if (!current) return;
    // Drop a trailing model error placeholder; re-run the last request.
    const lastUser = [...current.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || current.messages.length <= 1) return regenerate();
    renderSession();
    stream(current, { followUp: true });
  }

  /** Run generate() and show any unexpected error in the panel instead of failing silently. */
  function runGenerate(session) {
    Promise.resolve()
      .then(() => generate(session))
      .catch((e) => {
        console.warn('[YT Vibe] summary failed', e);
        if (session === current) ui.body.replaceChildren(errorCard({ code: 'internal', message: `Unexpected error: ${e?.message || e}` }, () => regenerate()));
      });
  }

  function regenerate() {
    if (!current) return openPanel();
    stopStream();
    current.messages = [];
    runGenerate(current);
  }

  async function ask(text) {
    if (!current || activeStream) return;
    if (!current.messages.some((m) => m.role === 'model' && m.text)) return;
    current.messages.push({ role: 'user', text });
    ui.body.append(messageNode({ role: 'user', text }));
    scrollToBottom(true);
    await stream(current, { followUp: true });
  }

  function submit() {
    if (activeStream) return stopStream(); // the Send button acts as Stop while streaming
    const text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = '';
    autosize();
    ask(text);
  }

  function switchLanguage(lang) {
    if (current?.lang === lang && current.messages.length) return;
    YTPVSettings.update('gemini.language', lang);
    YTPV.settings.gemini.language = lang;
    openPanel({ focus: false });
  }

  /**
   * auto: start summarizing right away (true when you click the button).
   * After navigating to another video with the panel open we pass auto:false,
   * so your free Gemini quota is only used when you ask for it.
   */
  function openPanel({ focus = true, auto = true } = {}) {
    const videoId = YTPV.getVideoId();
    if (!videoId) return;
    buildPanel();
    stopStream();
    const lang = YTPV.settings.gemini.language;
    const key = `${videoId}|${lang}`;
    let session = sessions.get(key);
    if (!session) {
      session = { videoId, lang, messages: [], videoUrl: `https://www.youtube.com/watch?v=${videoId}` };
      sessions.set(key, session);
    }
    current = session;
    requestAnimationFrame(() => panel.classList.add('ytpv-ai--open'));
    document.documentElement.setAttribute('ytpv-ai-open', '');
    renderSession();
    const hasSummary = session.messages.some((m) => m.role === 'model' && m.text);
    if (hasSummary) scrollToBottom(true);
    else if (auto) runGenerate(session);
    else {
      ui.title.textContent = document.title.replace(/ - YouTube$/, '');
      ui.body.replaceChildren(el('div', { class: 'ytpv-card' },
        el('div', { class: 'ytpv-card__title' }, 'New video'),
        el('p', {}, 'Want a study summary of this one too?'),
        el('button', { class: 'ytpv-btn', type: 'button', onclick: () => runGenerate(session) }, 'Summarize this video')));
    }
    if (focus) setTimeout(() => ui.input.focus({ preventScroll: true }), 300);
  }

  function closePanel() {
    stopStream();
    panel?.classList.remove('ytpv-ai--open');
    document.documentElement.removeAttribute('ytpv-ai-open');
  }

  /* ================================================================ */
  /* Button + lifecycle                                               */
  /* ================================================================ */

  function ensureButton() {
    if (!YTPV.isWatchPage()) return;
    const bar = YTPV.ensureActionBar();
    if (!bar || document.getElementById(BTN_ID)) return;
    const btn = YTPV.pillButton({
      id: BTN_ID, label: 'AI Summary', icon: ICONS.sparkle, order: 1,
      onClick: () => (panel?.classList.contains('ytpv-ai--open') && current?.videoId === YTPV.getVideoId() ? closePanel() : openPanel())
    });
    btn.classList.add('ytpv-pill--ai');
    bar.prepend(btn);
  }

  YTPV.register({
    id: 'aiSummary',
    disable() {
      closePanel();
      panel?.remove();
      panel = null;
      document.getElementById(BTN_ID)?.remove();
    },
    onNavigate() {
      ensureButton();
      // Panel open and the video changed: follow the new video.
      if (panel?.classList.contains('ytpv-ai--open')) {
        if (!YTPV.isWatchPage()) closePanel();
        else if (current?.videoId !== YTPV.getVideoId()) openPanel({ focus: false, auto: false });
      }
    },
    onMutation: ensureButton
  });
})();
