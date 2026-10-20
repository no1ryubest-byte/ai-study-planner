/* ============================================================
 * TocReader — 教科書の目次を単元に変える（副作用なしの純粋関数）
 *
 *  1) normalizeToc     : AIが読み取った目次（JSON）を検査し、見出しの一覧に整える
 *  2) computeSpans     : 次の見出しの開始ページから、各見出しのページ範囲を求める
 *  3) unitNodes        : 「章ごと」「節ごと」など、分け方に応じて単元になる見出しを選ぶ
 *  4) initialSelection : 試験範囲メモ（p.40〜120 など）やAIの判定から、最初のチェックを決める
 *  5) selectedUnits    : チェックした見出しを {name, from, to} の単元にする
 *  ほかに、単元欄の1行（「名前 p.12-25」）の読み書き
 * ============================================================ */
(function (global) {
  'use strict';

  const MAX_PAGE = 3000;
  const MAX_ITEMS = 300;
  const MAX_SPAN = 400;
  const GRAN_LABELS = { 0: '部ごと', 1: '章ごと', 2: '節ごと', 3: '項ごと' };

  // 本文以外の見出し（ページ範囲の区切りには使うが、単元にはしない）
  const OTHER_RE = /^(?:まえがき|はしがき|はじめに|序文|目次|もくじ|索引|さくいん|付録|附録|補遺|解答|略解|問題の?解答|答え|参考文献|参考図書|あとがき|おわりに|奥付|index\b|appendix|answers?\b|contents\b|preface\b|references\b|bibliography\b)/i;
  // 章末の問題やまとめ（直前の見出しのページに含める）
  const EXERCISE_RE = /(?:演習問題|練習問題|章末問題|確認問題|総合問題|発展問題|補充問題|問題演習|^演習$|^まとめ$|のまとめ$|^exercises?$|^problems$)/i;
  // 見出しの先頭についた番号（「第1章」「1.2」「§3」「Lesson 4」）
  const NO_RE = /^((?:第\s*[0-9０-９一二三四五六七八九十百]+\s*[部編章節項講課回])|(?:(?:chapter|lesson|unit|section)\s*[0-9０-９]+)|(?:§\s*[0-9０-９]+(?:[.．][0-9０-９]+)*)|(?:[0-9０-９]+(?:[.．-][0-9０-９]+){0,3}[.．]?))[\s　:：]+(.+)$/i;

  /* ---------- 小道具 ---------- */
  function toAscii(s) {
    return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  }
  function parsePage(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
    if (typeof v === 'string') {
      const s = toAscii(v).trim();
      if (/^\d+\s*[-‐－−–]\s*\d+$/.test(s)) return null; // 「2-1」のような章ごとのページ番号は使わない
      const m = s.match(/\d{1,4}/);
      return m ? Number(m[0]) : null;
    }
    return null;
  }
  function clean(v, n) {
    return v == null ? '' : String(v).replace(/[\s　]+/g, ' ').trim().slice(0, n);
  }
  function pick(o, keys) {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
    return null;
  }
  function levelValue(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    if (typeof v === 'string' && /^\s*\d\s*$/.test(v)) return Number(v);
    return null;
  }
  function levelFromNo(no) {
    const s = toAscii(no).trim();
    if (!s) return null;
    if (/^第.*[部編]$/.test(s)) return 0;
    if (/^第.*[章講課回]$/.test(s) || /^(?:chapter|lesson|unit)\s*\d+$/i.test(s)) return 1;
    if (/^第.*節$/.test(s) || /^section\s*\d+$/i.test(s)) return 2;
    if (/^第.*項$/.test(s)) return 3;
    const m = s.match(/^§?\s*(\d+(?:[.．-]\d+)*)[.．]?$/);
    if (m) return Math.min(3, m[1].split(/[.．-]/).length);
    return null;
  }

  /* ---------- 1) 読み取り結果を整える ---------- */
  function normalizeToc(raw) {
    const fail = (error) => ({ book: '', items: [], error });
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.error) {
      return fail(raw.error === 'not_toc' ? 'not_toc' : 'unreadable');
    }
    let list = null;
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object') list = [raw.items, raw.toc, raw.contents, raw.chapters, raw.entries].find(Array.isArray) || null;
    if (!list) return fail('unreadable');

    // 入れ子（chapters → sections）でも平らな一覧でも受け付ける
    const flat = [];
    (function walk(arr, base, depth) {
      for (const it of arr) {
        if (flat.length >= MAX_ITEMS) return;
        if (typeof it === 'string') {
          flat.push({ level: base, no: '', title: it, page: null, kind: null, unsure: false, inRange: null });
          continue;
        }
        if (!it || typeof it !== 'object') continue;
        const lv = levelValue(it.level);
        const level = lv === null ? base : lv;
        flat.push({
          level,
          no: pick(it, ['no', 'number', 'num']),
          title: pick(it, ['title', 'name', 'heading', 'text']),
          page: pick(it, ['page', 'p', 'startPage', 'start']),
          kind: pick(it, ['kind', 'type']),
          unsure: it.unsure === true,
          inRange: it.inRange === true ? true : it.inRange === false ? false : null,
        });
        const kids = [it.children, it.sections, it.subsections, it.items].find(Array.isArray);
        if (kids && depth < 4) walk(kids, level + 1, depth + 1);
      }
    })(list, 1, 0);

    let items = [];
    for (const r of flat) {
      let title = clean(r.title, 60);
      let no = clean(r.no, 16);
      if (!title && no) {
        title = no;
        no = '';
      }
      if (!title) continue;
      if (!no) {
        const m = title.match(NO_RE);
        if (m) {
          no = m[1].replace(/\s+/g, ' ').trim();
          title = m[2].trim();
        }
      }
      let page = parsePage(r.page);
      if (page !== null && (page < 1 || page > MAX_PAGE)) page = null;
      let kind = r.kind === 'main' || r.kind === 'exercise' || r.kind === 'other' ? r.kind : 'main';
      if (kind === 'main') {
        if (OTHER_RE.test(title)) kind = 'other';
        else if (EXERCISE_RE.test(title)) kind = 'exercise';
      }
      // 重ねて撮った画像の境目で、同じ見出しが数行くり返されたら1つにする（A B C | B C D）
      let dup = null;
      for (let k = items.length - 1; k >= 0 && k >= items.length - 6; k--) {
        const p = items[k];
        if (p.no === no && p.title === title && (p.page === page || p.page === null || page === null)) {
          dup = p;
          break;
        }
      }
      if (dup) {
        if (dup.page === null && page !== null) dup.page = page;
        continue;
      }
      items.push({ level: r.level, no, title, page, kind, unsure: !!r.unsure, inRange: r.inRange });
    }
    if (!items.some((it) => it.kind === 'main')) return fail('unreadable');

    fixLevels(items);
    flagPageOutliers(items);
    items = items.map((it, i) => ({
      id: 't' + i,
      level: it.level,
      no: it.no,
      title: it.title,
      page: it.page,
      kind: it.kind,
      unsure: it.unsure,
      inRange: it.inRange,
      end: null,
      pages: null,
    }));
    return { book: clean(raw && !Array.isArray(raw) ? pick(raw, ['book', 'bookTitle']) : '', 60), items, error: null };
  }

  /* 階層をそろえる：番号から推定、最上位を章（1）に合わせる */
  function fixLevels(items) {
    const main = items.filter((it) => it.kind === 'main');
    const given = new Set(main.map((it) => it.level));
    // 階層がついていない（全部同じ）のに番号に階層がある場合は、番号から決める
    const inferred = main.map((it) => levelFromNo(it.no));
    if (given.size <= 1 && new Set(inferred.filter((v) => v !== null)).size >= 2) {
      let last = 1;
      for (const it of items) {
        if (it.kind !== 'main') continue;
        const v = levelFromNo(it.no);
        it.level = v === null ? last : v;
        last = it.level;
      }
    }
    // 0（部・編）は番号で部・編と分かるときだけ。最上位が2以上なら1に下げる
    let min = Math.min.apply(null, items.filter((it) => it.kind === 'main').map((it) => it.level));
    if (min === 0) {
      const zeros = items.filter((it) => it.kind === 'main' && it.level === 0);
      if (!zeros.some((it) => levelFromNo(it.no) === 0)) {
        for (const it of items) it.level += 1;
        min = 1;
      }
    }
    if (min > 1) for (const it of items) it.level -= min - 1;
    const top = Math.max(0, Math.min(1, min));
    for (const it of items) {
      it.level = Math.max(0, Math.min(3, it.level));
      if (it.kind === 'other') it.level = top; // 付録・索引などは本全体の区切り
    }
  }

  /* 前後と比べて明らかにおかしいページ番号は読み違いとして捨てる */
  function flagPageOutliers(items) {
    const idx = [];
    items.forEach((it, i) => {
      if (it.page !== null) idx.push(i);
    });
    const bad = [];
    for (let k = 0; k < idx.length; k++) {
      const p = items[idx[k]].page;
      let v = 0;
      for (let d = 1; d <= 2; d++) {
        if (k - d >= 0 && items[idx[k - d]].page > p) v++;
        if (k + d < idx.length && items[idx[k + d]].page < p) v++;
      }
      if (v >= 2) bad.push(idx[k]);
    }
    for (const i of bad) {
      items[i].page = null;
      items[i].unsure = true;
    }
  }

  /* ---------- 2) ページ範囲 ---------- */
  function computeSpans(items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.end = null;
      it.pages = null;
      if (it.kind === 'other' || it.page === null) continue;
      // 次の「同じか上の階層」の見出し（章末の問題は区切りにしない）
      let j = i + 1;
      while (j < items.length && !(items[j].level <= it.level && items[j].kind !== 'exercise')) j++;
      if (j >= items.length) continue;
      const nx = items[j].page;
      if (nx === null || nx < it.page) continue;
      const end = Math.max(it.page, nx - 1);
      if (end - it.page + 1 > MAX_SPAN) continue;
      it.end = end;
      it.pages = end - it.page + 1;
    }
    return items;
  }

  /* ---------- 3) 分け方 ---------- */
  function subtreeEnd(items, i) {
    let j = i + 1;
    while (j < items.length && items[j].level > items[i].level) j++;
    return j;
  }
  function parents(items) {
    const par = [];
    const stack = [];
    for (let i = 0; i < items.length; i++) {
      while (stack.length && items[stack[stack.length - 1]].level >= items[i].level) stack.pop();
      par.push(stack.length ? stack[stack.length - 1] : -1);
      stack.push(i);
    }
    return par;
  }
  /** 選べる分け方（本文の見出しにある階層。部（0）は章がないときだけ） */
  function granLevels(items) {
    const lv = Array.from(new Set(items.filter((it) => it.kind === 'main').map((it) => it.level))).sort((a, b) => a - b);
    return lv.length > 1 ? lv.filter((l) => l > 0) : lv;
  }
  /** 分け方 g で単元になる見出し（その階層の見出しと、それより上で下に見出しがないもの） */
  function unitNodes(items, g) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== 'main' || it.level > g) continue;
      if (it.level === g) {
        out.push(i);
        continue;
      }
      const e = subtreeEnd(items, i);
      let has = false;
      for (let j = i + 1; j < e; j++) {
        if (items[j].kind === 'main' && items[j].level <= g) {
          has = true;
          break;
        }
      }
      if (!has) out.push(i);
    }
    return out;
  }
  /** 画面に並べる行：単元（チェック）と見出し（中の単元をまとめてチェック） */
  function displayRows(items, g, sel) {
    const units = new Set(unitNodes(items, g));
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== 'main' || it.level > g) continue;
      if (units.has(i)) {
        rows.push({ i, id: it.id, type: 'unit', on: sel.has(it.id) });
        continue;
      }
      const e = subtreeEnd(items, i);
      let n = 0;
      let on = 0;
      for (let j = i + 1; j < e; j++) {
        if (!units.has(j)) continue;
        n++;
        if (sel.has(items[j].id)) on++;
      }
      rows.push({ i, id: it.id, type: 'head', state: on === 0 ? 'off' : on === n ? 'on' : 'mixed' });
    }
    return rows;
  }
  function toggleHeader(items, g, sel, id) {
    const i = items.findIndex((it) => it.id === id);
    const out = new Set(sel);
    if (i < 0) return out;
    const units = new Set(unitNodes(items, g));
    const e = subtreeEnd(items, i);
    const ids = [];
    for (let j = i + 1; j < e; j++) if (units.has(j)) ids.push(items[j].id);
    const allOn = ids.length && ids.every((x) => out.has(x));
    for (const x of ids) {
      if (allOn) out.delete(x);
      else out.add(x);
    }
    return out;
  }
  /** 分け方を変えたときにチェックを引き継ぐ（自分・上の見出し・中の見出しのどれかが選ばれていれば選ぶ） */
  function convertSelection(items, toG, sel) {
    const par = parents(items);
    const out = new Set();
    for (const i of unitNodes(items, toG)) {
      let on = sel.has(items[i].id);
      for (let p = par[i]; !on && p >= 0; p = par[p]) on = sel.has(items[p].id);
      if (!on) {
        const e = subtreeEnd(items, i);
        for (let j = i + 1; j < e && !on; j++) on = sel.has(items[j].id);
      }
      if (on) out.add(items[i].id);
    }
    return out;
  }

  /* ---------- 4) 試験範囲から最初のチェックを決める ---------- */
  function parseExamPages(memo) {
    if (!memo) return [];
    const s = String(memo).normalize('NFKC');
    const out = [];
    const dash = '(?:-|‐|−|–|—|―|〜|~|から)';
    const re1 = new RegExp('p\\.?\\s*(\\d{1,4})\\s*' + dash + '\\s*(?:p\\.?\\s*)?(\\d{1,4})', 'gi');
    const re2 = new RegExp('(\\d{1,4})\\s*' + dash + '\\s*(\\d{1,4})\\s*(?:ページ|頁)', 'g');
    for (const re of [re1, re2]) {
      let m;
      while ((m = re.exec(s))) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        out.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    return out;
  }
  function inPageRanges(it, ranges) {
    const s = it.page;
    const e = it.end !== null ? it.end : it.page;
    for (const [a, b] of ranges) {
      if (s >= a && s <= b) return true;
      const ov = Math.min(e, b) - Math.max(s, a) + 1;
      if (ov > 0 && ov >= (e - s + 1) / 2) return true;
    }
    return false;
  }
  /** 戻り値の by: pages（メモのページ範囲）/ ai（AIの判定）/ all（全部）/ fallback（範囲に合う見出しがなく全部） */
  function initialSelection(items, g, memo) {
    const ranges = parseExamPages(memo);
    const nodes = unitNodes(items, g);
    const par = parents(items);
    const hasFlags = !!memo && items.some((it) => it.inRange !== null);
    const sel = new Set();
    let usedPages = false;
    let usedAi = false;
    for (const i of nodes) {
      const it = items[i];
      let on = null;
      if (ranges.length) {
        // ページが分からない見出しは、ページが分かる上の見出しで判断する
        let ref = it.page !== null ? it : null;
        for (let p = par[i]; !ref && p >= 0; p = par[p]) if (items[p].page !== null) ref = items[p];
        if (ref) {
          on = inPageRanges(ref, ranges);
          usedPages = true;
        }
      }
      if (on === null && hasFlags) {
        if (it.inRange !== null) on = it.inRange;
        else {
          on = false;
          for (let p = par[i]; p >= 0; p = par[p]) {
            if (items[p].inRange !== null) {
              on = items[p].inRange;
              break;
            }
          }
        }
        if (!on) {
          const e = subtreeEnd(items, i);
          for (let j = i + 1; j < e && !on; j++) on = items[j].inRange === true;
        }
        usedAi = true;
      }
      if (on === null) on = true;
      if (on) sel.add(it.id);
    }
    let by = usedPages ? 'pages' : usedAi ? 'ai' : 'all';
    if (!sel.size && nodes.length) {
      nodes.forEach((i) => sel.add(items[i].id));
      by = 'fallback';
    }
    return { sel, by };
  }
  /** 最初の分け方：単元が12個以内で、1単元が6ページ以上になるいちばん細かい分け方 */
  function defaultGran(items, memo) {
    const lv = granLevels(items);
    const stats = lv.map((g) => {
      const { sel } = initialSelection(items, g, memo);
      const nodes = unitNodes(items, g).filter((i) => sel.has(items[i].id));
      const known = nodes.filter((i) => items[i].pages);
      const mean = known.length ? known.reduce((a, i) => a + items[i].pages, 0) / known.length : null;
      return { g, n: nodes.length, rate: nodes.length ? known.length / nodes.length : 0, mean };
    });
    const pagesUsable = stats.some((s) => s.rate >= 0.7);
    let best = lv[0];
    for (const s of stats) {
      if (s.n < 1 || s.n > 12) continue;
      if (pagesUsable && s.rate < 0.7) continue;
      if (s.mean !== null && s.mean < 6) continue;
      best = s.g;
    }
    return best;
  }

  /* ---------- 5) 単元にする ---------- */
  function unitLabel(it) {
    return ((it.no ? it.no + ' ' : '') + it.title).slice(0, 40);
  }
  function selectedUnits(items, g, sel) {
    return unitNodes(items, g)
      .filter((i) => sel.has(items[i].id))
      .map((i) => ({ name: unitLabel(items[i]), from: items[i].page, to: items[i].end }));
  }
  function summarize(units) {
    let pages = 0;
    let known = 0;
    for (const u of units) {
      if (u.from && u.to && u.to >= u.from) {
        pages += u.to - u.from + 1;
        known++;
      }
    }
    return { count: units.length, pages, known };
  }

  /** 目次を読み取った直後の状態をまとめて作る */
  function prepare(raw, memo) {
    const t = normalizeToc(raw);
    if (t.error) return t;
    computeSpans(t.items);
    const gran = defaultGran(t.items, memo);
    const init = initialSelection(t.items, gran, memo);
    return { book: t.book, items: t.items, levels: granLevels(t.items), gran, sel: init.sel, by: init.by, error: null };
  }

  /* ---------- 単元欄の1行 ---------- */
  const TAIL_P = /(^|[\s　（(、,，])[（(]?\s*[pPｐＰ][.．]?\s*([0-9０-９]{1,4})\s*(?:[-‐－−–—―〜～~]\s*(?:[pPｐＰ][.．]?\s*)?([0-9０-９]{1,4}))?\s*[)）]?\s*$/;
  const TAIL_J = /(^|[\s　（(、,，])[（(]?\s*([0-9０-９]{1,4})\s*[-‐－−–—―〜～~]\s*([0-9０-９]{1,4})\s*(?:ページ|頁)\s*[)）]?\s*$/;

  function formatPages(from, to, sep) {
    if (!from) return '';
    return 'p.' + from + (to && to !== from ? (sep || '-') + to : '');
  }
  function formatUnitLine(u) {
    const p = formatPages(u.from, u.to);
    return p ? u.name + ' ' + p : u.name;
  }
  /** 「名前 p.12-25」「名前（p.12〜25）」「名前 12-25ページ」「名前 p.12」を読む */
  function parseUnitLine(line) {
    const s = String(line == null ? '' : line).trim();
    const m = s.match(TAIL_P) || s.match(TAIL_J);
    if (m) {
      const name = s.slice(0, m.index).replace(/[\s　、,，]+$/, '').trim();
      if (name) {
        let a = Number(toAscii(m[2]));
        let b = m[3] ? Number(toAscii(m[3])) : null;
        if (b !== null && b < a) {
          const sa = String(a);
          const sb = String(b);
          // 「p.112-18」のような省略形は 112〜118 と読む
          const expanded = sb.length < sa.length ? Number(sa.slice(0, sa.length - sb.length) + sb) : NaN;
          if (expanded >= a) b = expanded;
          else [a, b] = [b, a];
        }
        if (a >= 1 && a <= MAX_PAGE) return { name: name.slice(0, 40), from: a, to: b !== null && b <= MAX_PAGE ? b : null };
      }
    }
    return { name: s.slice(0, 40), from: null, to: null };
  }
  /** 終わりのページがない単元は、次の単元の開始ページの前日までとみなす */
  function fillMissingEnds(units) {
    return units.map((u, i) => {
      if (!u.from || u.to) return u;
      for (let k = i + 1; k < units.length; k++) {
        if (!units[k].from) continue;
        if (units[k].from >= u.from) return Object.assign({}, u, { to: Math.max(u.from, units[k].from - 1) });
        break;
      }
      return u;
    });
  }

  const api = {
    GRAN_LABELS,
    normalizeToc,
    computeSpans,
    granLevels,
    unitNodes,
    displayRows,
    toggleHeader,
    convertSelection,
    parseExamPages,
    initialSelection,
    defaultGran,
    unitLabel,
    selectedUnits,
    summarize,
    prepare,
    formatPages,
    formatUnitLine,
    parseUnitLine,
    fillMissingEnds,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TocReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
