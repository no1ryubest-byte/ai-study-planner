/* ============================================================
 * StudyKit — 単元の学習（解説・練習問題・採点・質問）の純粋関数
 *
 *  ・AIアドバイザー（Claude）に渡すタスクの指示を作る（人格とルールは AdvisorKit.studyPrompt で付ける）
 *  ・Claude の返事（見出しで区切った文章）を読み取る
 *    数式（TeX）のバックスラッシュが壊れないよう、JSONではなく文章で受け取る
 *  ・単元ごとの学習記録（解説・問題・結果）を更新し、集計する
 *  ・返事を安全なHTMLにする（数式は KaTeX で描くための印をつける）
 * ============================================================ */
(function (global) {
  'use strict';

  const LEVEL_NAMES = { 1: 'ほぼゼロ', 2: '苦手', 3: 'ふつう', 4: '得意', 5: 'ほぼ完璧' };
  const DIFF_LABELS = { basic: '基本', standard: '標準', advanced: '応用' };
  const DIFF_DESC = {
    basic: '基本（教科書の例題と同じくらい）',
    standard: '標準（定期試験と同じくらい）',
    advanced: '応用（定期試験の後半の問題くらい）',
  };
  const RESULT_LABELS = { good: 'できた', meh: 'あやしい', miss: 'できなかった' };
  const GRADE_TO_RESULT = { correct: 'good', partial: 'meh', wrong: 'miss' };
  const MAX_PROBLEMS = 40;
  const MAX_RESULTS = 10;
  const NOTE_MAX = 6000;

  /* ---------- 小道具 ---------- */
  function clip(s, n) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
  }
  function toAscii(s) {
    return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  }
  function docKey(sid, uid) {
    return 'l_' + sid + '_' + (uid || 'all');
  }
  function pagesText(u) {
    if (!u || !u.from) return '';
    return 'p.' + u.from + (u.to && u.to !== u.from ? '〜' + u.to : '');
  }
  function unitLine(u) {
    const p = pagesText(u);
    return u.name + (p ? '（教科書 ' + p + '）' : '');
  }

  /** 理解度と、今日のコマの種類から既定の難しさを決める */
  function defaultDifficulty(level, phase) {
    level = Number(level) || 3;
    if (phase === 'learn') return level >= 4 ? 'standard' : 'basic';
    if (phase === 'review') return level <= 2 ? 'basic' : 'standard';
    if (phase === 'final') return level >= 4 ? 'advanced' : 'standard';
    return level <= 2 ? 'basic' : level >= 4 ? 'advanced' : 'standard';
  }

  /* ---------- 指示（プロンプト） ---------- */
  function header(ctx) {
    const L = ['- 科目: ' + ctx.subject + (ctx.daysLeft != null && ctx.daysLeft >= 0 ? '（試験まであと' + ctx.daysLeft + '日）' : '')];
    if (ctx.examNote) L.push('- 試験範囲: ' + ctx.examNote);
    if (ctx.unit) L.push('- 単元: ' + unitLine(ctx.unit));
    else if (ctx.units && ctx.units.length) L.push('- 範囲: ' + ctx.units.map(unitLine).join('、'));
    L.push('- 学生の理解度: ' + (LEVEL_NAMES[ctx.level] || 'ふつう') + '（5段階の' + (ctx.level || 3) + '）');
    return L;
  }
  const MATH_RULE = '数式は TeX で書く。文中の式は $...$、1行に分ける式は $$...$$ で囲む';

  function explainPrompt(ctx) {
    const lv = Number(ctx.level) || 3;
    const tone =
      lv <= 2 ? '用語の意味から、途中式を省かずにやさしく説明してください。'
        : lv >= 4 ? '基本は短くまとめ、まちがえやすい所と応用の考え方を中心に説明してください。'
          : '要点をおさえ、試験で使う形で説明してください。';
    const L = ['タスク: 単元の解説を書く。学生がこれから次の内容を勉強します。'].concat(header(ctx), ['', tone, '']);
    if (ctx.unit) {
      L.push('次の見出しで書いてください。',
        '## 要点', '（3〜5個の箇条書き）',
        '## 大事な式・用語', '（式や用語と、記号の意味）',
        '## 例題', '（1問。解き方を途中式つきで。最後に答え）',
        '## よくある間違い',
        '## 試験に出やすいところ');
    } else {
      L.push('試験前の総復習用に、次の見出しで書いてください。',
        '## 全体のつながり', '（単元どうしの関係を短く）',
        '## 単元ごとの要点', '（単元ごとに2〜3個の箇条書き）',
        '## 大事な式のまとめ',
        '## 試験直前のチェックリスト', '（「〜を説明できる」「〜を計算できる」の形の箇条書き）');
    }
    L.push('', 'ルール:', '- ' + MATH_RULE, '- 強調は **太字** だけを使う。表は使わない',
      '- 全体で' + (ctx.compact ? '600' : '1200') + '字くらいまで', '- 教科書のページは、ここに書かれているものだけを使う');
    return L.join('\n');
  }

  function problemsPrompt(ctx, opt) {
    opt = opt || {};
    const n = Math.max(1, Math.min(5, opt.count || 3));
    const diff = DIFF_DESC[opt.diff] ? opt.diff : 'standard';
    const L = ['タスク: 定期試験に向けた練習問題を作る。'].concat(header(ctx), ['- 難しさ: ' + DIFF_DESC[diff], '']);
    L.push((ctx.unit ? 'この単元の' : '範囲の単元からまんべんなく、') + '練習問題を' + n + '問作ってください。', '', '条件:',
      '- 定期試験に出そうな問題にする。計算問題を中心に、考え方や用語を問う問題を入れてもよい',
      '- 1問は5〜10分で解ける大きさにし、答えが1つに決まるようにする',
      '- 答えと途中式は、必ず自分で検算してから書く',
      '- 解き方は途中式を省略せず、番号付きの3〜6ステップで書く',
      '- ヒントは答えを言わずに、最初の一歩だけを書く',
      '- ねらいは、この問題で確かめたいことを20字以内で書く',
      '- ' + MATH_RULE);
    if (opt.similar && opt.similar.length) {
      L.push('- 学生は次の問題でつまずいた。同じ考え方を使い、数値や形を変えた問題にする:');
      opt.similar.slice(0, 5).forEach((q) => L.push('  ・' + clip(q, 160).replace(/\n/g, ' ')));
    }
    if (opt.avoid && opt.avoid.length) {
      L.push('- 次の問題とは違う問題にする:');
      opt.avoid.slice(-10).forEach((q) => L.push('  ・' + clip(q, 80).replace(/\n/g, ' ')));
    }
    L.push('- 次の形式だけで書き、ほかの文は書かない', '',
      '### 問題 1', '（問題文）', '### ヒント', '（ヒント）', '### 答え', '（最終的な答え。短く）',
      '### 解き方', '1. （手順）', '2. （手順）', '### ねらい', '（確かめたいこと）',
      '', '（問題 2 からも同じ形式で続ける）');
    return L.join('\n');
  }

  function gradePrompt(p, desc) {
    const L = ['タスク: 答案を採点する。添付の画像は、次の問題に対する学生の手書きの答案です' + (desc ? '（' + desc + '）' : '') + '。', '',
      '### 問題', p.q, '### 正しい答え', p.answer];
    if (p.steps && p.steps.length) {
      L.push('### 模範解答');
      p.steps.forEach((s, i) => L.push(i + 1 + '. ' + s));
    }
    L.push('', '答案を読み、最終的な答えと途中の考え方を確かめて、次の形式だけで返してください。', '',
      '### 判定', '次のどれか1つ: 正解 / 部分点 / 不正解 / 読めない',
      '（正解: 答えも考え方も正しい。部分点: 考え方はおおむね正しいが、計算ミスや書き落としがある。不正解: 考え方が違う。読めない: 答案が読めない、または別の問題の答案）',
      '### ひとこと', '（学生へのひとこと。60字以内）',
      '### まちがえた所', '（まちがえた所と直し方。正解なら「なし」）', '',
      MATH_RULE + '。');
    return L.join('\n');
  }

  /** 質問のやりとり：先頭に決まりと教材を置き、続けて会話を並べる */
  function chatTurns(ctx, note, problem, history) {
    const L = ['タスク: 学生の質問に、短く分かりやすく答える（300字くらいまで）。',
      '答えを丸写しさせるのではなく、考え方が分かるように説明してください。', MATH_RULE + '。', ''].concat(header(ctx));
    if (note) L.push('', '学生が読んだ解説（抜粋）:', clip(note, 1800));
    if (problem) {
      L.push('', '学生が取り組んでいる問題:', problem.q, '正しい答え: ' + problem.answer);
      if (problem.steps && problem.steps.length) L.push('解き方: ' + problem.steps.map((s, i) => i + 1 + '. ' + s).join(' '));
    }
    L.push('', 'このあとの質問に答えてください。');
    const turns = [{ role: 'user', content: L.join('\n') }];
    // 会話は新しい10往復まで
    const h = (history || []).filter((t) => t && (t.role === 'user' || t.role === 'assistant') && String(t.content || '').trim());
    const recent = h.slice(-20);
    while (recent.length && recent[0].role !== 'user') recent.shift();
    // 先頭の決まり（user）と最初の質問（user）が続く。続いても1つの発言として読まれる
    return turns.concat(recent.map((t) => ({ role: t.role, content: clip(t.content, 4000) })));
  }

  /* ---------- 返事を読む ---------- */
  function sections(text) {
    // 「### 見出し」で区切る
    const out = [];
    let cur = null;
    for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      const m = raw.match(/^\s*#{2,4}\s*(.+?)\s*$/);
      if (m) {
        cur = { head: toAscii(m[1]).replace(/[：:]$/, '').trim(), body: [] };
        out.push(cur);
      } else if (cur) cur.body.push(raw);
    }
    return out.map((s) => ({ head: s.head, body: s.body.join('\n').trim() }));
  }
  function splitSteps(body) {
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const steps = [];
    // 「1. 」「1）」「・」で始まる行を手順の区切りにする（「1.5倍」のような数は区切りにしない）
    const MARK = /^\s*(?:[0-9０-９]{1,2}(?:\.\s+|[)．）]\s*)|[-*]\s+|[・•]\s*)/;
    for (const l of lines) {
      if (MARK.test(l)) steps.push(l.replace(MARK, ''));
      else if (steps.length) steps[steps.length - 1] += '\n' + l;
      else steps.push(l);
    }
    return steps.map((s) => clip(s, 800)).filter(Boolean).slice(0, 10);
  }
  /**
   * 練習問題の返事を読む。complete=false のときは、書きかけの最後の問題を除く（読み取り中の表示用）
   */
  function parseProblems(text, opt) {
    opt = opt || {};
    const max = opt.max || 5;
    const out = [];
    let cur = null;
    const push = () => {
      if (cur && cur.q && cur.answer) out.push(cur);
      cur = null;
    };
    for (const s of sections(text)) {
      if (/^(?:問題|問|problem|q)\s*\d*/i.test(s.head) && !/問題文/.test(s.head)) {
        push();
        cur = { q: clip(s.body, 1500), hint: '', answer: '', steps: [], point: '' };
      } else if (!cur) continue;
      else if (/ヒント|hint/i.test(s.head)) cur.hint = clip(s.body, 400);
      else if (/^(?:答え|解答|正解|answer)/i.test(s.head)) cur.answer = clip(s.body, 500);
      else if (/解き方|解説|手順|solution|steps?/i.test(s.head)) cur.steps = splitSteps(s.body);
      else if (/ねらい|ポイント|point|aim/i.test(s.head)) cur.point = clip(s.body.split('\n')[0], 40);
    }
    if (opt.complete === false) cur = null; // 書きかけ
    push();
    return out.slice(0, max);
  }
  function countStarted(text) {
    return (String(text || '').match(/^\s*#{2,4}\s*(?:問題|問)\s*[0-9０-９]+/gm) || []).length;
  }
  /** 判定のことばを読む（「不正解」を「正解」と取り違えない） */
  function judge(text) {
    const v = String(text || '').replace(/\s+/g, '');
    if (/部分|partial/i.test(v)) return 'partial';
    if (/解答なし|未解答|無解答|空欄|見当たら|blank|noanswer/i.test(v)) return 'blank';
    if (/読め|unreadable/i.test(v)) return 'unreadable';
    if (/不正解|誤り|wrong|incorrect/i.test(v)) return 'wrong';
    if (/正解|correct/i.test(v)) return 'correct';
    return 'unreadable';
  }
  function parseGrade(text) {
    let result = 'unreadable';
    let comment = '';
    let mistake = '';
    for (const s of sections(text)) {
      if (/判定|結果|result/i.test(s.head)) {
        result = judge(s.body);
        if (result === 'blank') result = 'unreadable';
      } else if (/ひとこと|コメント|comment/i.test(s.head)) comment = clip(s.body, 200);
      else if (/まちが|間違|mistake/i.test(s.head)) mistake = /^(?:なし|無し|特になし|-|ー)?$/.test(s.body.trim()) ? '' : clip(s.body, 800);
    }
    return { result, comment, mistake };
  }

  /* ---------- 答案をまとめて採点 ---------- */
  function batchGradePrompt(ps, desc) {
    const n = ps.length;
    const L = ['タスク: 答案をまとめて採点する。添付の画像は、次の練習問題（' + (n > 1 ? '問1〜問' + n : '問1') + '）に対する学生の手書きの答案です' + (desc ? '（' + desc + '）' : '') + '。', ''];
    ps.forEach((p, i) => {
      L.push('### 問' + (i + 1), '問題: ' + p.q, '正しい答え: ' + p.answer);
      if (p.steps && p.steps.length) L.push('模範解答: ' + p.steps.map((s, k) => k + 1 + '. ' + s).join(' '));
    });
    L.push('', '答案を読み、問題ごとに最終的な答えと途中の考え方を確かめて、次の形式だけで返してください。答案に問題番号がなければ、内容から対応する問題を判断してください。', '',
      '### 問1', '判定: 正解 / 部分点 / 不正解 / 解答なし / 読めない のどれか1つ', 'ひとこと: 学生へのひとこと（40字以内）', 'まちがえた所: まちがえた所と直し方（正解なら「なし」）');
    if (n > 1) L.push('（問2 から問' + n + ' まで同じ形式で続ける）');
    L.push('### 全体', '学生へのひとこと（60字以内。よくできた所を1つ入れる）', '',
      '判定の基準: 正解＝答えも考え方も正しい。部分点＝考え方はおおむね正しいが、計算ミスや書き落としがある。不正解＝考え方が違う。解答なし＝その問題の答案が見当たらない。読めない＝字が読めない。',
      MATH_RULE + '。');
    return L.join('\n');
  }
  /** まとめて採点の返事を読む。items[i] が問(i+1)の結果（見つからない問題は空） */
  function parseBatchGrade(text, n) {
    const items = [];
    let overall = '';
    for (const s of sections(text)) {
      const m = s.head.match(/^(?:問題|問|q)\s*(\d+)/i);
      if (m) {
        const no = Number(m[1]);
        if (no < 1 || no > n) continue;
        const f = { result: 'unreadable', comment: '', mistake: '' };
        let cur = null;
        for (const raw of s.body.split('\n')) {
          const mm = raw.match(/^\s*(判定|結果|ひとこと|コメント|まちがえた所|間違えた所|まちがい)\s*[:：]\s*(.*)$/);
          if (mm) {
            cur = /判定|結果/.test(mm[1]) ? 'result' : /ひとこと|コメント/.test(mm[1]) ? 'comment' : 'mistake';
            if (cur === 'result') f.result = judge(mm[2]);
            else f[cur] = mm[2].trim();
          } else if (cur && cur !== 'result' && raw.trim()) f[cur] += (f[cur] ? '\n' : '') + raw.trim();
        }
        f.comment = clip(f.comment, 200);
        f.mistake = /^(?:なし|無し|特になし|-|ー)?$/.test(f.mistake.trim()) ? '' : clip(f.mistake, 800);
        items[no - 1] = Object.assign({ no }, f);
      } else if (/全体|まとめ|総評|overall/i.test(s.head)) overall = clip(s.body, 300);
    }
    return { items, overall };
  }
  function countGraded(text) {
    return (String(text || '').match(/^\s*#{2,4}\s*(?:問題|問)\s*[0-9０-９]+/gm) || []).length;
  }

  /* ---------- 時間を計る・早く終わった ---------- */
  const EARLY_MIN = 3; // 3分以上早ければ「早く終わった」
  function timerElapsed(t, now) {
    if (!t) return 0;
    return Math.max(0, (Number(t.acc) || 0) + (t.since != null ? now - t.since : 0));
  }
  function timerStart(t, now) {
    return { acc: t ? Number(t.acc) || 0 : 0, since: now };
  }
  function timerPause(t, now) {
    return { acc: timerElapsed(t, now), since: null };
  }
  function actualMinutes(t, now) {
    return Math.max(1, Math.round(timerElapsed(t, now) / 60000));
  }
  function fmtClock(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }
  /** 終わったコマの予定と実際（計った場合だけ） */
  function earlyInfo(x) {
    if (!x || !x.done || !x.actual || !x.min) return null;
    const early = x.min - x.actual;
    return { planned: x.min, actual: x.actual, early, isEarly: early >= EARLY_MIN, ratio: x.actual / x.min };
  }
  function dnum(s) {
    const p = String(s).split('-').map(Number);
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }
  /**
   * ふだんのペース（過去14日の計ったコマの「実際÷予定」の中央値。3コマ以上あるとき）と、
   * この7日間で予定より早く終わって浮いた時間の合計
   */
  function paceSummary(days, today, excludeId) {
    const tn = dnum(today);
    const ratios = [];
    let saved7 = 0;
    for (const date of Object.keys(days || {})) {
      const age = tn - dnum(date);
      if (age < 0 || age > 13) continue;
      for (const x of (days[date] && days[date].sessions) || []) {
        if (!x || !x.done || !x.actual || !x.min) continue;
        if (age <= 6) saved7 += Math.max(0, x.min - x.actual);
        if (x.id !== excludeId) ratios.push(x.actual / x.min);
      }
    }
    ratios.sort((a, b) => a - b);
    const k = ratios.length;
    const usual = k >= 3 ? (k % 2 ? ratios[(k - 1) / 2] : (ratios[k / 2 - 1] + ratios[k / 2]) / 2) : null;
    return { usual, n: k, saved7 };
  }
  /** 今日のコマのうち、計ったものの予定と実際の合計 */
  function daySummary(sessions) {
    let planned = 0;
    let actual = 0;
    let timed = 0;
    for (const x of sessions || []) {
      if (!x || !x.done || !x.actual) continue;
      timed++;
      planned += x.min;
      actual += x.actual;
    }
    return { timed, planned, actual, early: planned - actual };
  }

  /* ---------- 学習記録 ---------- */
  function emptyDoc(sid, uid) {
    return { sid, uid: uid || null, note: null, problems: [], updatedAt: 0 };
  }
  function cloneDoc(doc, sid, uid) {
    return doc ? JSON.parse(JSON.stringify(doc)) : emptyDoc(sid, uid);
  }
  function lastResult(p) {
    return p && p.results && p.results.length ? p.results[p.results.length - 1].r : null;
  }
  function setNote(doc, text, level, now) {
    const d = cloneDoc(doc);
    d.note = { text: clip(text, NOTE_MAX), level: level || 3, at: now };
    d.updatedAt = now;
    return d;
  }
  function addProblems(doc, problems, diff, now, makeId) {
    const d = cloneDoc(doc);
    const set = 's' + now;
    for (const p of problems) {
      d.problems.push({ id: makeId(), set, diff, at: now, q: p.q, hint: p.hint || '', answer: p.answer, steps: p.steps || [], point: p.point || '', results: [] });
    }
    // 多すぎたら、できた問題の古いものから消す（できなかった問題は残す）
    while (d.problems.length > MAX_PROBLEMS) {
      let idx = d.problems.findIndex((p) => lastResult(p) === 'good');
      if (idx < 0) idx = d.problems.findIndex((p) => !lastResult(p));
      if (idx < 0) idx = 0;
      d.problems.splice(idx, 1);
    }
    d.updatedAt = now;
    return { doc: d, set };
  }
  function recordResult(doc, pid, r, by, date, now) {
    const d = cloneDoc(doc);
    const p = d.problems.find((x) => x.id === pid);
    if (!p || !RESULT_LABELS[r]) return d;
    const last = p.results[p.results.length - 1];
    // 同じ日に同じ問題を付け直したら上書き
    if (last && last.d === date) {
      last.r = r;
      last.by = by;
    } else p.results.push({ d: date, r, by });
    if (p.results.length > MAX_RESULTS) p.results = p.results.slice(-MAX_RESULTS);
    d.updatedAt = now;
    return d;
  }
  function setFeedback(doc, pid, grade, now) {
    const d = cloneDoc(doc);
    const p = d.problems.find((x) => x.id === pid);
    if (p) {
      p.fb = { result: grade.result, comment: grade.comment || '', mistake: grade.mistake || '', at: now };
      d.updatedAt = now;
    }
    return d;
  }
  function stats(doc) {
    const ps = doc && doc.problems ? doc.problems : [];
    let tried = 0;
    let good = 0;
    let meh = 0;
    let miss = 0;
    for (const p of ps) {
      const r = lastResult(p);
      if (!r) continue;
      tried++;
      if (r === 'good') good++;
      else if (r === 'meh') meh++;
      else miss++;
    }
    return { count: ps.length, tried, good, meh, miss, due: meh + miss, rate: tried ? good / tried : null, hasNote: !!(doc && doc.note) };
  }
  function dueProblems(doc) {
    return (doc && doc.problems ? doc.problems : []).filter((p) => {
      const r = lastResult(p);
      return r === 'meh' || r === 'miss';
    });
  }
  function latestSet(doc) {
    const ps = doc && doc.problems ? doc.problems : [];
    if (!ps.length) return [];
    const set = ps[ps.length - 1].set;
    return ps.filter((p) => p.set === set);
  }
  /** 今回の結果から、コマの手応えを決める（できた1・あやしい0.5で8割以上→かんたん、5割以上→ふつう） */
  function ratingFromResults(rs) {
    const list = rs.filter((r) => RESULT_LABELS[r]);
    if (!list.length) return null;
    const score = list.reduce((a, r) => a + (r === 'good' ? 1 : r === 'meh' ? 0.5 : 0), 0) / list.length;
    return score >= 0.8 ? 'easy' : score >= 0.5 ? 'ok' : 'hard';
  }

  /* ---------- 安全なHTMLにする ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function inline(s) {
    return s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  }
  /**
   * 見出し（##）・箇条書き・番号付きの一覧・太字だけの簡単な書式をHTMLにする。
   * 数式は <span class="math" data-display="0|1">TeX</span> にして、あとで KaTeX が描く。
   * 文字はすべてエスケープするので、返事にHTMLが入っていても実行されない。
   */
  function renderRich(src) {
    const maths = [];
    const keep = (tex, display) => {
      maths.push({ tex, display });
      return '\u0000' + (maths.length - 1) + '\u0000';
    };
    let s = String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (m, a, b) => keep(a != null ? a : b, true));
    s = s.replace(/\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g, (m, a, b) => keep(a != null ? a : b, false));
    s = esc(s);
    let html = '';
    let list = null;
    let para = [];
    const flush = () => {
      if (para.length) html += '<p>' + inline(para.join('<br>')) + '</p>';
      para = [];
    };
    const close = () => {
      if (list) html += '</' + list + '>';
      list = null;
    };
    for (const raw of s.split('\n')) {
      const line = raw.trim();
      let m;
      if (!line) {
        flush();
        close();
      } else if ((m = line.match(/^#{1,4}\s*(.+)$/))) {
        flush();
        close();
        html += '<h4>' + inline(m[1]) + '</h4>';
      } else if ((m = line.match(/^(?:[-*]\s+|[・•]\s*)(.+)$/))) {
        flush();
        if (list !== 'ul') {
          close();
          html += '<ul>';
          list = 'ul';
        }
        html += '<li>' + inline(m[1]) + '</li>';
      } else if ((m = line.match(/^[0-9０-９]{1,2}(?:\.\s+|[)．）]\s*)(.+)$/))) {
        flush();
        if (list !== 'ol') {
          close();
          html += '<ol>';
          list = 'ol';
        }
        html += '<li>' + inline(m[1]) + '</li>';
      } else {
        close();
        para.push(line);
      }
    }
    flush();
    close();
    return html.replace(/\u0000(\d+)\u0000/g, (m, i) => {
      const x = maths[Number(i)];
      return '<span class="math" data-display="' + (x.display ? 1 : 0) + '">' + esc(x.tex.trim()) + '</span>';
    });
  }

  const api = {
    LEVEL_NAMES,
    DIFF_LABELS,
    RESULT_LABELS,
    GRADE_TO_RESULT,
    MAX_PROBLEMS,
    docKey,
    pagesText,
    defaultDifficulty,
    explainPrompt,
    problemsPrompt,
    gradePrompt,
    chatTurns,
    parseProblems,
    countStarted,
    parseGrade,
    judge,
    batchGradePrompt,
    parseBatchGrade,
    countGraded,
    EARLY_MIN,
    timerElapsed,
    timerStart,
    timerPause,
    actualMinutes,
    fmtClock,
    earlyInfo,
    paceSummary,
    daySummary,
    emptyDoc,
    lastResult,
    setNote,
    addProblems,
    recordResult,
    setFeedback,
    stats,
    dueProblems,
    latestSet,
    ratingFromResults,
    renderRich,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.StudyKit = api;
})(typeof window !== 'undefined' ? window : globalThis);
