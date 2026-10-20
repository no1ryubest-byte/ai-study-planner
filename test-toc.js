/* TocReader のテスト。 node test-toc.js で実行 */
'use strict';
const T = require('./toc.js');
const E = require('./engine.js');

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
const byTitle = (items, t) => items.find((it) => it.title === t);
const ids = (items, titles) => new Set(titles.map((t) => byTitle(items, t).id));

/* 高専の応用数学の教科書を想定した目次（AIの返答の形） */
const RAW1 = {
  book: '新 応用数学',
  items: [
    { level: 1, no: '', title: 'まえがき', page: 'iii', kind: 'other' },
    { level: 1, no: '第1章', title: 'ベクトル解析', page: 1, kind: 'main' },
    { level: 2, no: '1.1', title: 'ベクトル関数', page: 2, kind: 'main' },
    { level: 2, no: '1.2', title: '勾配・発散・回転', page: 14, kind: 'main' },
    { level: 2, no: '1.3', title: '線積分と面積分', page: 27, kind: 'main' },
    { level: 2, no: '', title: '演習問題', page: 40, kind: 'exercise' },
    { level: 1, no: '第2章', title: 'ラプラス変換', page: 43, kind: 'main' },
    { level: 2, no: '2.1', title: 'ラプラス変換の定義', page: 44 },
    { level: 2, no: '2.2', title: '逆ラプラス変換', page: 58 },
    { level: 2, no: '2.3', title: '微分方程式への応用', page: 66 },
    { level: 2, no: '', title: '演習問題', page: 80 },
    { level: 1, no: '第3章', title: 'フーリエ解析', page: 83 },
    { level: 2, no: '3.1', title: 'フーリエ級数', page: 84 },
    { level: 2, no: '3.2', title: 'フーリエ変換', page: 101 },
    { level: 1, no: '第4章', title: '複素関数', page: 121 },
    { level: 2, no: '4.1', title: '複素数と複素平面', page: 122 },
    { level: 2, no: '4.2', title: '正則関数', page: 130 },
    { level: 2, no: '4.3', title: '複素積分', page: 141 },
    { level: 2, no: '4.4', title: '留数定理', page: 152 },
    { level: 1, no: '', title: '問題の解答', page: 165, kind: 'other' },
    { level: 1, no: '', title: '索引', page: 190, kind: 'other' },
  ],
};

console.log('\n■ 読み取り結果の整理');
{
  const t = T.normalizeToc(RAW1);
  check(!t.error, '正常な目次はエラーなし');
  eq(t.book, '新 応用数学', '教科書名');
  eq(t.items.length, 21, '見出しの数');
  eq(byTitle(t.items, 'まえがき').kind, 'other', 'まえがきは本文以外');
  eq(byTitle(t.items, 'まえがき').page, null, 'ローマ数字のページは使わない');
  eq(t.items.filter((it) => it.title === '演習問題').map((it) => it.kind), ['exercise', 'exercise'], '種類がなくても「演習問題」は章末の問題');
  eq(byTitle(t.items, '索引').kind, 'other', '索引は本文以外');
}

console.log('\n■ ページ範囲');
{
  const t = T.normalizeToc(RAW1);
  T.computeSpans(t.items);
  const span = (title) => [byTitle(t.items, title).page, byTitle(t.items, title).end, byTitle(t.items, title).pages];
  eq(span('ベクトル関数'), [2, 13, 12], '1.1 は次の節の前まで');
  eq(span('線積分と面積分'), [27, 42, 16], '章末の演習問題は直前の節に含める');
  eq(span('ベクトル解析'), [1, 42, 42], '章は次の章の前まで');
  eq(span('フーリエ変換'), [101, 120, 20], '章の最後の節は次の章の前まで');
  eq(span('留数定理'), [152, 164, 13], '本文最後の節は解答の前まで');
  eq(byTitle(t.items, '索引').pages, null, '索引は範囲を持たない');
}

console.log('\n■ 分け方と単元');
{
  const t = T.normalizeToc(RAW1);
  T.computeSpans(t.items);
  eq(T.granLevels(t.items), [1, 2], '章と節の2段階');
  eq(T.unitNodes(t.items, 1).length, 4, '章ごとなら4単元');
  eq(T.unitNodes(t.items, 2).length, 12, '節ごとなら12単元');
  eq(T.defaultGran(t.items, ''), 2, '12単元以内・平均13ページなので節ごと');

  const all = T.initialSelection(t.items, 2, '');
  eq(all.by, 'all', 'メモなしは全部チェック');
  eq(all.sel.size, 12, '全部で12');

  const r = T.initialSelection(t.items, 2, '教科書 p.43〜120');
  eq(r.by, 'pages', 'メモのページ範囲で決める');
  eq(T.selectedUnits(t.items, 2, r.sel).map((u) => u.name), ['2.1 ラプラス変換の定義', '2.2 逆ラプラス変換', '2.3 微分方程式への応用', '3.1 フーリエ級数', '3.2 フーリエ変換'], 'p.43〜120 は2章と3章の節');
  eq(T.selectedUnits(t.items, 2, r.sel)[2], { name: '2.3 微分方程式への応用', from: 66, to: 82 }, '単元にページ範囲がつく');
  const c = T.initialSelection(t.items, 1, 'p.43-120');
  eq(T.selectedUnits(t.items, 1, c.sel).map((u) => u.name), ['第2章 ラプラス変換', '第3章 フーリエ解析'], '章ごとでも同じ範囲');

  // 分け方を変えたときにチェックを引き継ぐ
  const toCh = T.convertSelection(t.items, 1, r.sel);
  eq(Array.from(toCh).sort(), Array.from(ids(t.items, ['ラプラス変換', 'フーリエ解析'])).sort(), '節→章：選んだ節を含む章');
  const toSec = T.convertSelection(t.items, 2, ids(t.items, ['複素関数']));
  eq(toSec.size, 4, '章→節：章の中の節すべて');

  // 見出しのチェックで中の単元をまとめて切り替え
  const ch1 = byTitle(t.items, 'ベクトル解析').id;
  const on = T.toggleHeader(t.items, 2, r.sel, ch1);
  eq(on.size, 8, '1章をまとめてチェック');
  const off = T.toggleHeader(t.items, 2, on, ch1);
  eq(off.size, 5, 'もう一度押すと外れる');
  const rows = T.displayRows(t.items, 2, r.sel);
  eq(rows.filter((x) => x.type === 'head').map((x) => x.state), ['off', 'on', 'on', 'off'], '章の行の状態');
  const partial = new Set(r.sel);
  partial.delete(byTitle(t.items, '逆ラプラス変換').id);
  eq(T.displayRows(t.items, 2, partial).filter((x) => x.type === 'head')[1].state, 'mixed', '一部だけなら途中の状態');

  // 範囲に合う見出しがないときは全部
  const none = T.initialSelection(t.items, 2, 'p.500-600');
  eq(none.by, 'fallback', '範囲外なら全部チェックに戻す');
  eq(none.sel.size, 12, '全部で12');
}

console.log('\n■ 章ごと・節ごとで学習時間がほぼ同じ');
{
  const t = T.normalizeToc(RAW1);
  T.computeSpans(t.items);
  for (const level of [1, 2, 3, 4, 5]) {
    const mk = (g) => {
      const { sel } = T.initialSelection(t.items, g, '');
      const units = T.selectedUnits(t.items, g, sel).map((u, i) => Object.assign({ id: 'u' + i }, u));
      return E.subjectRequirement({ level, volume: 'normal', units }, []).total;
    };
    const ch = mk(1);
    const sec = mk(2);
    const diff = Math.abs(ch - sec) / Math.max(ch, sec);
    console.log(`  理解度${level}: 章ごと ${E.fmtMin(ch)} / 節ごと ${E.fmtMin(sec)}（差 ${(diff * 100).toFixed(1)}%）`);
    check(diff < 0.12, `理解度${level}：分け方による差が12%未満`);
  }
}

console.log('\n■ いろいろな返答の形');
{
  // 入れ子・番号が見出しに入っている
  const nested = {
    chapters: [
      { title: '第1章 力学', page: 1, sections: [{ title: '1.1 運動の法則', page: 2 }, { title: '1.2 運動量と力積', page: 15 }] },
      { title: '第2章 波動', page: 30, sections: [{ title: '2.1 波の性質', page: 31 }] },
      { title: '索引', page: 50 },
    ],
  };
  const a = T.prepare(nested, '');
  check(!a.error, '入れ子の形を受け付ける');
  eq(a.items.map((it) => [it.level, it.no, it.title]), [[1, '第1章', '力学'], [2, '1.1', '運動の法則'], [2, '1.2', '運動量と力積'], [1, '第2章', '波動'], [2, '2.1', '波の性質'], [1, '', '索引']], '番号と見出しを分ける');
  eq(byTitle(a.items, '波の性質').end, 49, '最後の節は索引の前まで');

  // 階層がついていない（番号から推定）
  const flat = {
    items: [
      { level: 1, no: '1', title: '集合と論理', page: 1 },
      { level: 1, no: '1.1', title: '集合', page: 2 },
      { level: 1, no: '1.2', title: '命題', page: 9 },
      { level: 1, no: '2', title: '写像', page: 20 },
      { level: 1, no: '2.1', title: '写像の定義', page: 21 },
      { level: 1, no: '', title: 'コラム', page: 28 },
    ],
  };
  const b = T.normalizeToc(flat);
  eq(b.items.map((it) => it.level), [1, 2, 2, 1, 2, 2], '番号の点の数から階層を推定（番号なしは直前と同じ）');

  // 最上位が2から始まる
  const deep = T.normalizeToc({ items: [{ level: 2, title: 'A', page: 1 }, { level: 3, title: 'B', page: 2 }] });
  eq(deep.items.map((it) => it.level), [1, 2], '最上位を章にそろえる');

  // 部・編がある
  const parts = T.normalizeToc({ items: [{ level: 0, no: '第1部', title: '基礎', page: 1 }, { level: 1, no: '第1章', title: 'A', page: 2 }, { level: 2, no: '1.1', title: 'B', page: 3 }] });
  eq(parts.items.map((it) => it.level), [0, 1, 2], '部は0のまま');
  eq(T.granLevels(parts.items), [1, 2], '部ごとは選択肢に出さない');

  // 0始まりの階層（部ではない）
  const zero = T.normalizeToc({ items: [{ level: 0, no: '第1章', title: 'A', page: 1 }, { level: 1, no: '1.1', title: 'B', page: 2 }] });
  eq(zero.items.map((it) => it.level), [1, 2], '0始まりは1始まりに直す');

  // 文字列だけの配列
  const strs = T.normalizeToc(['Lesson 1 My Town', 'Lesson 2 Robots']);
  eq(strs.items.map((it) => [it.no, it.title]), [['Lesson 1', 'My Town'], ['Lesson 2', 'Robots']], '文字列の一覧');

  // おかしな値
  const junk = T.normalizeToc({
    items: [
      null,
      42,
      { title: '  空白が  多い   見出し  ', page: 'p.12', level: '1' },
      { title: '', no: '' },
      { title: 'ページが大きすぎる', page: 99999, level: 7 },
      { title: '章ごとのページ', page: '2-1' },
      { title: '空白が 多い 見出し', page: 12, level: 1 },
    ],
  });
  eq(junk.items.map((it) => it.title), ['空白が 多い 見出し', 'ページが大きすぎる', '章ごとのページ'], '空の見出しと、近くでくり返された見出しを除く');
  eq(junk.items.map((it) => it.page), [12, null, null], '「p.12」は12、範囲外と「2-1」は不明');

  // 画像の境目で数行くり返された（A B C | B C D）
  const seam = T.normalizeToc({
    items: [
      { level: 1, no: '第1章', title: 'A', page: 1 },
      { level: 2, no: '1.1', title: 'B', page: 2 },
      { level: 2, no: '1.2', title: 'C', page: 9 },
      { level: 2, no: '1.1', title: 'B', page: 2 },
      { level: 2, no: '1.2', title: 'C', page: null },
      { level: 2, no: '1.3', title: 'D', page: 15 },
    ],
  });
  eq(seam.items.map((it) => it.no), ['第1章', '1.1', '1.2', '1.3'], '境目のくり返しを除く');
  // 離れた場所の同じ名前の見出しは残す
  const far = T.normalizeToc({
    items: [
      { level: 1, no: '第1章', title: 'A', page: 1 },
      { level: 2, no: '', title: '例題', page: 3 },
      { level: 1, no: '第2章', title: 'B', page: 10 },
      { level: 2, no: '', title: '例題', page: 12 },
    ],
  });
  eq(far.items.length, 4, 'ページが違う同名の見出しは残す');

  // 目次ではない・読めない
  eq(T.normalizeToc({ error: 'not_toc' }).error, 'not_toc', '目次ではない');
  eq(T.normalizeToc(null).error, 'unreadable', '空の返答');
  eq(T.normalizeToc({ items: [] }).error, 'unreadable', '見出しなし');
  eq(T.normalizeToc({ items: [{ title: '索引', page: 3 }] }).error, 'unreadable', '本文の見出しがない');
}

console.log('\n■ 読み違いのページ番号');
{
  const t = T.normalizeToc({
    items: [
      { level: 1, title: 'A', page: 1 },
      { level: 2, title: 'A1', page: 2 },
      { level: 2, title: 'A2', page: 140 }, // 本当は14
      { level: 2, title: 'A3', page: 27 },
      { level: 1, title: 'B', page: 43 },
      { level: 2, title: 'B1', page: 44 },
    ],
  });
  T.computeSpans(t.items);
  eq(byTitle(t.items, 'A2').page, null, '前後と合わないページは捨てる');
  check(byTitle(t.items, 'A2').unsure, '読み違いの見出しは「自信なし」にする');
  eq(byTitle(t.items, 'A3').pages, 16, '正しいページはそのまま使う');
  eq(byTitle(t.items, 'A1').pages, null, '次の見出しのページが不明なら範囲も不明');
}

console.log('\n■ AIの試験範囲の判定');
{
  const raw = JSON.parse(JSON.stringify(RAW1));
  raw.items.forEach((it) => {
    it.inRange = /^[23]/.test(it.no) || it.no === '第2章' || it.no === '第3章';
  });
  const t = T.normalizeToc(raw);
  T.computeSpans(t.items);
  const r = T.initialSelection(t.items, 2, '2〜3章');
  eq(r.by, 'ai', 'ページ範囲がないメモはAIの判定を使う');
  eq(r.sel.size, 5, '2章と3章の節');
  const noMemo = T.initialSelection(t.items, 2, '');
  eq(noMemo.by, 'all', 'メモがなければAIの判定は使わない');
}

console.log('\n■ 試験範囲メモのページ');
{
  eq(T.parseExamPages('教科書 p.40〜120、2〜4章'), [[40, 120]], '「p.40〜120」');
  eq(T.parseExamPages('p.10-30, p.45-60'), [[10, 30], [45, 60]], '2つの範囲');
  eq(T.parseExamPages('40〜120ページ'), [[40, 120]], '「40〜120ページ」');
  eq(T.parseExamPages('ｐ．４０～１２０'), [[40, 120]], '全角');
  eq(T.parseExamPages('P120-40'), [[40, 120]], '逆順');
  eq(T.parseExamPages('２〜４章'), [], '章の範囲はページではない');
  eq(T.parseExamPages(''), [], '空');
}

console.log('\n■ 単元欄の1行');
{
  const P = (s) => {
    const u = T.parseUnitLine(s);
    return [u.name, u.from, u.to];
  };
  eq(P('フーリエ級数 p.12-25'), ['フーリエ級数', 12, 25], '基本の形');
  eq(P('1.2 フーリエ係数（p.9〜16）'), ['1.2 フーリエ係数', 9, 16], 'かっこと〜');
  eq(P('名前 P12～P25'), ['名前', 12, 25], '大文字のP');
  eq(P('名前 ｐ．１２－２５'), ['名前', 12, 25], '全角');
  eq(P('名前 p.12'), ['名前', 12, null], '開始ページだけ');
  eq(P('名前 12-25ページ'), ['名前', 12, 25], '「ページ」');
  eq(P('名前 p.112-18'), ['名前', 112, 118], '省略形');
  eq(P('名前 p.25-12'), ['名前', 12, 25], '逆順');
  eq(P('Lesson 5 (p.40-52)'), ['Lesson 5', 40, 52], '英語の単元');
  eq(P('Step 1-2'), ['Step 1-2', null, null], '名前の中の数字はページではない');
  eq(P('p.12-25'), ['p.12-25', null, null], '名前がなければページとして読まない');
  eq(P('フーリエ級数'), ['フーリエ級数', null, null], 'ページなし');
  eq(T.formatUnitLine({ name: 'フーリエ級数', from: 12, to: 25 }), 'フーリエ級数 p.12-25', '書き出し');
  eq(T.formatUnitLine({ name: '名前', from: 12, to: 12 }), '名前 p.12', '1ページ');
  eq(T.formatUnitLine({ name: '名前', from: null, to: null }), '名前', 'ページなし');
  for (const s of ['フーリエ級数 p.12-25', '名前 p.12', '名前']) eq(T.formatUnitLine(T.parseUnitLine(s)), s, '往復：' + s);
  const filled = T.fillMissingEnds([{ name: 'a', from: 12, to: null }, { name: 'b', from: 20, to: 25 }, { name: 'c', from: null, to: null }, { name: 'd', from: 30, to: null }]);
  eq(filled.map((u) => u.to), [19, 25, null, null], '終わりのページを次の単元から補う');
  eq(T.fillMissingEnds([{ name: 'a', from: 12 }, { name: 'b', from: 12 }])[0].to, 12, '同じページで始まる単元');
}

console.log(`\n結果：${passes} 件成功、${failures} 件失敗`);
process.exit(failures ? 1 : 0);
