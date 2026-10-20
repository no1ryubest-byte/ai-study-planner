/* StudyKit のテスト。 node test-study.js で実行 */
'use strict';
const S = require('./study.js');

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else {
    failures++;
    console.log('  ✗ ' + msg);
  }
}
function eq(a, b, msg) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(ok, msg + '（期待 ' + JSON.stringify(b) + '、実際 ' + JSON.stringify(a) + '）');
}

/* Claude の返事の例（TeX のバックスラッシュを含む） */
const REPLY = `はい、3問作りました。
### 問題 1
関数 $f(t) = e^{2t}$ のラプラス変換 $F(s)$ を、定義にしたがって求めよ。
### ヒント
$\\int_0^\\infty e^{-st} f(t)\\,dt$ に代入する。
### 答え
$F(s) = \\dfrac{1}{s-2}$（$s > 2$）
### 解き方
1. 定義より $$F(s) = \\int_0^\\infty e^{2t} e^{-st}\\,dt = \\int_0^\\infty e^{-(s-2)t}\\,dt$$
2. $s > 2$ のとき積分は収束し、
   $\\left[ -\\dfrac{e^{-(s-2)t}}{s-2} \\right]_0^\\infty$ となる
3. よって $F(s) = \\dfrac{1}{s-2}$
### ねらい
定義から計算できる

### 問題２
$\\mathcal{L}[\\sin \\omega t]$ を答えよ。
### ヒント
表を思い出す
### 答え
$\\dfrac{\\omega}{s^2+\\omega^2}$
### 解き方
1) オイラーの公式を使う
2) 1.5倍にはしない（そのまま）
### ねらい
基本の変換

### 問題 3
答えのない書きかけの問題`;

console.log('\n■ 練習問題の返事を読む');
{
  const ps = S.parseProblems(REPLY);
  eq(ps.length, 2, '答えのない問題は除く');
  check(ps[0].q.includes('$f(t) = e^{2t}$'), '問題文の数式を残す');
  check(ps[0].hint.includes('\\int_0^\\infty'), 'ヒントのバックスラッシュが壊れない');
  eq(ps[0].answer, '$F(s) = \\dfrac{1}{s-2}$（$s > 2$）', '答え');
  eq(ps[0].steps.length, 3, '番号付きの手順が3つ');
  check(ps[0].steps[1].includes('\n') && ps[0].steps[1].includes('\\left['), '番号のない行は前の手順の続き');
  eq(ps[0].point, '定義から計算できる', 'ねらい');
  eq(ps[1].steps, ['オイラーの公式を使う', '1.5倍にはしない（そのまま）'], '「1)」形式と、文中の「1.5倍」');
  check(ps[1].q.includes('\\mathcal{L}'), '全角数字の見出し「問題２」');
  eq(S.parseProblems(REPLY, { complete: false }).length, 2, '読み取り中は書きかけを除く');
  eq(S.parseProblems(REPLY.split('### 問題２')[0] + '### 問題２\n途中', { complete: false }).length, 1, '書きかけの2問目は出さない');
  eq(S.countStarted(REPLY), 3, '書き始めた問題の数');
  eq(S.parseProblems('関係ない文章'), [], '形式が違う返事は0問');
  eq(S.parseProblems(REPLY, { max: 1 }).length, 1, '最大数');
}

console.log('\n■ 採点の返事を読む');
{
  const g = (txt) => S.parseGrade(txt);
  eq(g('### 判定\n正解\n### ひとこと\nよくできています\n### まちがえた所\nなし'), { result: 'correct', comment: 'よくできています', mistake: '' }, '正解');
  eq(g('### 判定\n部分点\n### ひとこと\n惜しい\n### まちがえた所\n2行目で $s-2$ の符号をまちがえた').result, 'partial', '部分点');
  eq(g('### 判定\n不正解\n### ひとこと\nもう一度').result, 'wrong', '不正解（「正解」を含んでも不正解）');
  eq(g('### 判定\n読めない').result, 'unreadable', '読めない');
  eq(g('ちがう形式').result, 'unreadable', '形式が違えば読めない扱い');
  check(g('### 判定\n部分点\n### まちがえた所\n符号 $-$ のミス').mistake.includes('$-$'), 'まちがえた所');
}

console.log('\n■ 書式をHTMLにする');
{
  const h = S.renderRich('## 要点\n- **ラプラス変換**は $F(s)=\\int_0^\\infty f(t)e^{-st}dt$\n- 線形性\n\n1. 定義に代入\n2. 積分する\n\n$$\\mathcal{L}[1] = \\frac{1}{s}$$\n倍率は1.5倍です。');
  check(h.startsWith('<h4>要点</h4><ul><li><b>ラプラス変換</b>は <span class="math" data-display="0">'), '見出し・箇条書き・太字・文中の式');
  check(h.includes('<ol><li>定義に代入</li><li>積分する</li></ol>'), '番号付きの一覧');
  check(h.includes('<span class="math" data-display="1">\\mathcal{L}[1] = \\frac{1}{s}</span>'), '1行の式');
  check(h.includes('<br>倍率は1.5倍です。</p>') && !h.includes('<li>5倍'), '「1.5倍」は一覧にしない');
  const x = S.renderRich('<img src=x onerror=alert(1)> **<script>alert(1)</script>** $a<b$ "q" \'s\'');
  check(!/<img|<script/i.test(x), 'HTMLのタグは実行されない');
  check(x.includes('&lt;img src=x onerror=alert(1)&gt;') && x.includes('<b>&lt;script&gt;'), 'タグはエスケープして表示');
  check(x.includes('<span class="math" data-display="0">a&lt;b</span>'), '式の中の < もエスケープ');
  check(x.includes('&quot;q&quot;') && x.includes('&#39;s&#39;'), '引用符もエスケープ');
  check(S.renderRich('$a*b*c$ と **太字**').startsWith('<p><span class="math" data-display="0">a*b*c</span> と <b>太字</b>'), '式の中の * は太字にしない');
  check(S.renderRich('・要点その1\n・要点その2').startsWith('<ul><li>要点その1</li>'), '「・」の箇条書き');
  eq(S.renderRich('値段は $5 です'), '<p>値段は $5 です</p>', '閉じていない $ はそのまま');
  eq(S.renderRich('\\(x^2\\) と \\[y\\]'), '<p><span class="math" data-display="0">x^2</span> と <span class="math" data-display="1">y</span></p>', '\\( \\) と \\[ \\] も式');
  eq(S.renderRich(''), '', '空');
  check(!S.renderRich('a\u0000b').includes('\u0000'), '制御文字の印を残さない');
}

console.log('\n■ 学習記録');
{
  let n = 0;
  const id = () => 'p' + ++n;
  const base = S.emptyDoc('m1', 'u1');
  const r1 = S.addProblems(base, S.parseProblems(REPLY), 'standard', 1000, id);
  eq(r1.doc.problems.map((p) => [p.id, p.set, p.diff]), [['p1', 's1000', 'standard'], ['p2', 's1000', 'standard']], '問題を追加（同じ組）');
  eq(base.problems.length, 0, '元の記録は変えない');
  let d = S.recordResult(r1.doc, 'p1', 'miss', 'self', '2026-10-18', 1100);
  d = S.recordResult(d, 'p1', 'meh', 'ai', '2026-10-18', 1200);
  eq(d.problems[0].results, [{ d: '2026-10-18', r: 'meh', by: 'ai' }], '同じ日の付け直しは上書き');
  d = S.recordResult(d, 'p1', 'good', 'self', '2026-10-20', 1300);
  eq(d.problems[0].results.length, 2, '別の日は追加');
  d = S.recordResult(d, 'p2', 'miss', 'self', '2026-10-20', 1400);
  d = S.recordResult(d, 'p2', 'bad-value', 'self', '2026-10-21', 1500);
  eq(S.stats(d), { count: 2, tried: 2, good: 1, meh: 0, miss: 1, due: 1, rate: 0.5, hasNote: false }, '集計');
  eq(S.dueProblems(d).map((p) => p.id), ['p2'], '解き直しが必要な問題');
  const r2 = S.addProblems(d, [{ q: 'Q', answer: 'A', steps: [] }], 'basic', 2000, id);
  eq(S.latestSet(r2.doc).map((p) => p.id), ['p3'], '最新の組');
  const noted = S.setNote(r2.doc, '## 要点\n' + 'あ'.repeat(9000), 2, 3000);
  eq([noted.note.level, noted.note.at, noted.note.text.length], [2, 3000, 6000], '解説を保存（長さの上限）');
  const fb = S.setFeedback(noted, 'p2', { result: 'partial', comment: 'c', mistake: 'm' }, 3100);
  eq(fb.problems[1].fb, { result: 'partial', comment: 'c', mistake: 'm', at: 3100 }, '採点のコメントを保存');

  // 上限：できた問題の古いものから消す
  let big = S.emptyDoc('m1', 'u1');
  for (let i = 0; i < 40; i++) big = S.addProblems(big, [{ q: 'Q' + i, answer: 'A', steps: [] }], 'basic', 10 + i, id).doc;
  big = S.recordResult(big, big.problems[5].id, 'good', 'self', '2026-10-18', 99);
  big = S.recordResult(big, big.problems[0].id, 'miss', 'self', '2026-10-18', 99);
  const keepMiss = big.problems[0].id;
  const dropGood = big.problems[5].id;
  big = S.addProblems(big, [{ q: 'new', answer: 'A', steps: [] }], 'basic', 500, id).doc;
  eq(big.problems.length, 40, '40問まで');
  check(!big.problems.some((p) => p.id === dropGood), 'できた問題から消す');
  check(big.problems.some((p) => p.id === keepMiss), 'できなかった問題は残す');
  for (let i = 0; i < 12; i++) big = S.recordResult(big, keepMiss, 'miss', 'self', '2026-11-' + String(i + 1).padStart(2, '0'), 600 + i);
  eq(big.problems[0].results.length, 10, '結果は10回分まで');
}

console.log('\n■ 手応えと難しさ');
{
  eq(S.ratingFromResults(['good', 'good', 'good']), 'easy', '全部できた → かんたん');
  eq(S.ratingFromResults(['good', 'good', 'meh']), 'easy', '8割以上 → かんたん');
  eq(S.ratingFromResults(['good', 'meh', 'miss']), 'ok', '5割 → ふつう');
  eq(S.ratingFromResults(['meh', 'miss', 'miss']), 'hard', '5割未満 → むずかしい');
  eq(S.ratingFromResults([]), null, '結果なし');
  const table = [1, 3, 5].map((lv) => ['learn', 'practice', 'review', 'final', null].map((ph) => S.defaultDifficulty(lv, ph)).join(','));
  eq(table, ['basic,basic,basic,standard,basic', 'basic,standard,standard,standard,standard', 'standard,advanced,standard,advanced,advanced'], '理解度×コマの種類');
}

console.log('\n■ 指示（プロンプト）');
{
  const ctx = { subject: '応用数学', level: 2, daysLeft: 33, examNote: 'p.43〜120', unit: { name: '2.1 ラプラス変換の定義', from: 44, to: 57 } };
  const ex = S.explainPrompt(ctx);
  check(ex.includes('2.1 ラプラス変換の定義（教科書 p.44〜57）') && ex.includes('苦手（5段階の2）') && ex.includes('あと33日'), '解説：単元・ページ・理解度・日数');
  check(ex.includes('用語の意味から') && ex.includes('## 例題'), '解説：苦手向けの説明と見出し');
  const all = S.explainPrompt({ subject: '応用数学', level: 4, units: [{ name: 'A', from: 1, to: 10 }, { name: 'B' }] });
  check(all.includes('A（教科書 p.1〜10）、B') && all.includes('チェックリスト') && all.includes('まちがえやすい所'), '総復習の解説');
  const pp = S.problemsPrompt(ctx, { count: 9, diff: 'basic', avoid: Array.from({ length: 15 }, (_, i) => '過去の問題' + i), similar: ['$\\int$ の計算'] });
  check(pp.includes('練習問題を5問') && pp.includes('基本（教科書の例題と同じくらい）'), '問題：数は5まで・難しさ');
  check(pp.includes('過去の問題14') && !pp.includes('過去の問題4\n'), '問題：避ける問題は新しい10問');
  check(pp.includes('つまずいた') && pp.includes('$\\int$ の計算'), '問題：類題');
  check(pp.includes('### 問題 1') && pp.includes('### 解き方'), '問題：返事の形式');
  const gp = S.gradePrompt({ q: 'Q', answer: 'A', steps: ['s1', 's2'] }, '1枚目の写真');
  check(gp.includes('1枚目の写真') && gp.includes('1. s1') && gp.includes('正解 / 部分点 / 不正解 / 読めない'), '採点の指示');
  const t = S.chatTurns(ctx, '## 要点\nラプラス', { q: 'Q', answer: 'A', steps: ['s'] }, [
    { role: 'assistant', content: '古い答え' },
    { role: 'user', content: '質問1' },
    { role: 'assistant', content: '答え1' },
    { role: 'user', content: '質問2' },
  ]);
  eq(t.map((x) => x.role), ['user', 'user', 'assistant', 'user'], '質問：最初と最後は学生の発言');
  check(t[0].content.includes('学生が読んだ解説') && t[0].content.includes('取り組んでいる問題'), '質問：解説と問題を渡す');
}

console.log('\n■ 答案をまとめて採点');
{
  const ps = S.parseProblems(REPLY);
  const pr = S.batchGradePrompt(ps, '1枚目の写真の上半分、1枚目の写真の下半分');
  check(pr.includes('問1〜問2') && pr.includes('### 問2') && pr.includes('正しい答え: $\\dfrac{\\omega}{s^2+\\omega^2}$'), '指示：全部の問題と正しい答え');
  check(pr.includes('（問2 から問2 まで同じ形式で続ける）') && pr.includes('解答なし') && pr.includes('### 全体'), '指示：返事の形式');
  check(!S.batchGradePrompt([ps[0]], '').includes('問2 から'), '1問だけのときは「続ける」を書かない');
  const reply = `### 問1
判定: 正解
ひとこと: 定義から正しく計算できています
まちがえた所: なし
### 問２
判定：部分点
ひとこと：考え方はOK
まちがえた所：分母の $s^2-\\omega^2$ は
$s^2+\\omega^2$ が正しい
### 問3
判定: 正解
### 全体
よくできました。定義の計算が正確です。`;
  const g = S.parseBatchGrade(reply, 2);
  eq(g.items.map((x) => x.result), ['correct', 'partial'], '問ごとの判定（全角の番号・コロンも）');
  eq(g.items[0].mistake, '', '「なし」は空');
  eq(g.items[1].mistake, '分母の $s^2-\\omega^2$ は\n$s^2+\\omega^2$ が正しい', '複数行のまちがえた所');
  eq(g.items.length, 2, '範囲外の問3は無視');
  eq(g.overall, 'よくできました。定義の計算が正確です。', '全体のひとこと');
  const g2 = S.parseBatchGrade('### 問2\n判定: 解答なし', 3);
  eq([g2.items[0], g2.items[1].result, g2.items[2]], [undefined, 'blank', undefined], '見つからない問題は空・解答なし');
  eq(['正解', '不正解', '部分点', '解答なし', '空欄', '読めない', '？'].map(S.judge), ['correct', 'wrong', 'partial', 'blank', 'blank', 'unreadable', 'unreadable'], '判定のことば');
  eq(S.countGraded(reply), 3, '採点した問題の数（進み具合）');
}

console.log('\n■ 時間を計る・早く終わった');
{
  const m = 60000;
  let t = S.timerStart(null, 0);
  eq(S.timerElapsed(t, 10 * m), 10 * m, '計測中の経過');
  t = S.timerPause(t, 10 * m);
  eq([t.acc, t.since, S.timerElapsed(t, 99 * m)], [10 * m, null, 10 * m], '一時停止中は進まない');
  t = S.timerStart(t, 20 * m);
  eq(S.timerElapsed(t, 32 * m), 22 * m, '再開すると続きから');
  eq(S.actualMinutes(t, 32 * m + 29000), 22, '分に丸める');
  eq(S.actualMinutes(S.timerStart(null, 0), 5000), 1, '最低1分');
  eq([S.fmtClock(0), S.fmtClock(65000), S.fmtClock(3723000)], ['0:00', '1:05', '1:02:03'], '時計の表示');
  eq(S.earlyInfo({ done: true, min: 30, actual: 22 }), { planned: 30, actual: 22, early: 8, isEarly: true, ratio: 22 / 30 }, '8分早い');
  eq(S.earlyInfo({ done: true, min: 30, actual: 28 }).isEarly, false, '2分早いだけでは「早い」にしない');
  eq(S.earlyInfo({ done: true, min: 30 }), null, '計っていないコマ');
  const days = {
    '2026-10-20': { sessions: [{ id: 'now', done: true, min: 30, actual: 20 }, { id: 'a', done: true, min: 60, actual: 60 }] },
    '2026-10-18': { sessions: [{ id: 'b', done: true, min: 30, actual: 27 }, { id: 'c', done: true, min: 45 }] },
    '2026-10-12': { sessions: [{ id: 'd', done: true, min: 30, actual: 33 }] },
    '2026-10-01': { sessions: [{ id: 'old', done: true, min: 30, actual: 5 }] },
  };
  const ps = S.paceSummary(days, '2026-10-20', 'now');
  eq([ps.n, Math.round(ps.usual * 100), ps.saved7], [3, 100, 13], 'ふだんのペース（中央値）と7日間の浮いた時間');
  eq(S.paceSummary({ '2026-10-20': { sessions: [{ id: 'x', done: true, min: 30, actual: 20 }] } }, '2026-10-20').usual, null, '3コマ未満はふだんのペースなし');
  eq(S.daySummary(days['2026-10-20'].sessions), { timed: 2, planned: 90, actual: 80, early: 10 }, '今日の合計');
}

console.log(`\n結果：${passes} 件成功、${failures} 件失敗`);
process.exit(failures ? 1 : 0);
