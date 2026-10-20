/* ============================================================
 * NativeBridge — スマホアプリ（Expo）の中で動くときだけ使う橋渡し
 *
 *  アプリの WebView の中では window.ReactNativeWebView がある。そのときだけ、
 *  window.claude.use('sample') と同じ形の関数を用意し、AIの呼び出しを
 *  スマホ側の端末内AI（llama.rn）へ送る。画面のコードは今までのまま動く。
 *
 *  Web → スマホ  {t:'hello'} / {t:'ai.run', id, mode, system, messages, images, schema, task}
 *                {t:'ai.stop', id} / {t:'ui.models'}
 *  スマホ → Web  window.__nativeBridge.receive({t:'status'|'ai.text'|'ai.done'|'ai.error', ...})
 *
 *  ブラウザや claude.ai では何もしない（window.ReactNativeWebView がないため）。
 * ============================================================ */
(function (global) {
  'use strict';

  const RN = global.ReactNativeWebView;
  if (!RN || typeof RN.postMessage !== 'function') return;

  const LIMITS = { maxPromptBytes: 200000, images: { maxCount: 2, maxInputBytes: 3000000, mediaTypes: ['image/jpeg', 'image/png'] } };
  const pending = new Map();
  const statusListeners = [];
  let seq = 0;
  let status = { ready: false, downloaded: false, vision: true, model: null, platform: null };

  function post(msg) {
    try { RN.postMessage(JSON.stringify(msg)); } catch (e) { /* 送れないときは何もしない */ }
  }
  function err(code, message, text) {
    const e = { code, message: message || code };
    if (text) e.text = text;
    return e;
  }

  /** 画面が作った指示を、system と会話に分ける（AdvisorKit の人格ヘッダーは system に） */
  function splitPrompt(input) {
    const AK = global.AdvisorKit;
    const heads = AK ? [AK.SYSTEM_PROMPT, AK.STUDY_PROMPT] : [];
    const cut = (text) => {
      const s = String(text || '');
      for (const h of heads) if (h && s.startsWith(h)) return { system: h, rest: s.slice(h.length).replace(/^\s+/, '') };
      return { system: '', rest: s };
    };
    if (typeof input === 'string') {
      const c = cut(input);
      return { system: c.system, messages: [{ role: 'user', content: c.rest }] };
    }
    const turns = Array.isArray(input) ? input.filter((t) => t && (t.role === 'user' || t.role === 'assistant')) : [];
    if (!turns.length) return { system: '', messages: [] };
    const first = cut(turns[0].content);
    const messages = [{ role: turns[0].role, content: first.rest }].concat(turns.slice(1).map((t) => ({ role: t.role, content: String(t.content || '') })));
    return { system: first.system, messages };
  }
  /** どのタスクか（端末側で、長さや温度を決めるのに使う） */
  function taskOf(messages) {
    const s = messages.length ? String(messages[0].content || '') : '';
    const m = s.match(/タスク: (suggest_units|session_advice)/);
    if (m) return m[1];
    if (/タスク: 単元の解説/.test(s)) return 'explain';
    if (/タスク: 定期試験に向けた練習問題/.test(s)) return 'problems';
    if (/タスク: 答案をまとめて採点/.test(s)) return 'grade_batch';
    if (/タスク: 答案を採点/.test(s)) return 'grade';
    if (/タスク: 学生の質問/.test(s)) return 'chat';
    if (/目次/.test(s)) return 'toc';
    return 'other';
  }
  /** JSON の形を、端末側の文法（grammar）で強制するためのスキーマ */
  function schemaFor(task) {
    const AK = global.AdvisorKit;
    if (!AK) return null;
    if (task === 'suggest_units') return AK.toApiSchema(AK.UNITS_SCHEMA);
    if (task === 'session_advice') return AK.toApiSchema(AK.ADVICE_SCHEMA);
    return null;
  }
  function blobToDataUrl(b) {
    return new Promise((resolve, reject) => {
      if (typeof b === 'string') { resolve(b); return; }
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(err('image_read', '写真を読み込めませんでした。'));
      r.readAsDataURL(b);
    });
  }
  /** sample.json と同じく、返事から JSON を取り出す（全体 → コードの囲み → 最初の { から最後の } まで） */
  function parseJsonLoose(text) {
    const s = String(text || '').trim();
    const tries = [s];
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) tries.push(fence[1]);
    const a = s.search(/[[{]/);
    const b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
    for (const t of tries) {
      try { return { ok: true, value: JSON.parse(t) }; } catch (e) { /* 次を試す */ }
    }
    return { ok: false };
  }

  function run(mode, input, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      if (o.signal && o.signal.aborted) { reject(err('cancelled', '止めました。')); return; }
      const id = 'r' + ++seq + '_' + Date.now().toString(36);
      const sp = splitPrompt(input);
      if (!sp.messages.length || !String(sp.messages[sp.messages.length - 1].content || '').trim()) { reject(err('bad_request', '指示が空です。')); return; }
      const task = taskOf(sp.messages);
      const images = Array.isArray(o.images) ? o.images.slice(0, LIMITS.images.maxCount) : [];
      Promise.all(images.map(blobToDataUrl)).then((urls) => {
        if (o.signal && o.signal.aborted) { reject(err('cancelled', '止めました。')); return; }
        pending.set(id, { mode, resolve, reject, onText: typeof o.onText === 'function' ? o.onText : null, text: '' });
        if (o.signal) o.signal.addEventListener('abort', () => { if (pending.has(id)) post({ t: 'ai.stop', id }); }, { once: true });
        post({ t: 'ai.run', id, mode, task, system: sp.system, messages: sp.messages, images: urls, schema: mode === 'json' ? schemaFor(task) : null });
      }, reject);
    });
  }

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'status') {
      status = Object.assign({}, status, msg.status || {});
      statusListeners.forEach((f) => { try { f(status); } catch (e) { /* 表示側のエラーは無視 */ } });
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.t === 'ai.text') {
      const text = String(msg.text || '');
      const delta = text.startsWith(p.text) ? text.slice(p.text.length) : text;
      p.text = text;
      if (p.onText) { try { p.onText({ text, delta }); } catch (e) { /* 表示側のエラーは無視 */ } }
    } else if (msg.t === 'ai.done') {
      pending.delete(msg.id);
      const text = String(msg.text || '');
      if (p.mode === 'json') {
        const r = parseJsonLoose(text);
        if (r.ok && !msg.truncated) p.resolve(r.value);
        else p.reject(err('invalid_json', 'AIの返事をJSONとして読めませんでした。', text));
      } else p.resolve({ text, truncated: !!msg.truncated, stats: msg.stats || null });
    } else if (msg.t === 'ai.error') {
      pending.delete(msg.id);
      p.reject(err(msg.code || 'unavailable', msg.message, p.text));
    }
  }

  const sample = (input, opts) => run('text', input, opts);
  sample.json = (input, opts) => run('json', input, opts);
  sample.limits = () => Promise.resolve(status.vision === false ? { maxPromptBytes: LIMITS.maxPromptBytes } : LIMITS);

  global.__nativeBridge = { receive };
  global.NativeAI = {
    get status() { return status; },
    onStatus(f) { if (typeof f === 'function') statusListeners.push(f); },
    openModels() { post({ t: 'ui.models' }); },
    _split: splitPrompt,
    _task: taskOf,
    _parse: parseJsonLoose,
  };
  if (!global.claude) {
    global.claude = { use: (name) => Promise.resolve(name === 'sample' ? sample : null) };
  }
  post({ t: 'hello' });
})(typeof window !== 'undefined' ? window : globalThis);
