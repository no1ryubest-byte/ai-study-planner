/* PlannerEngine のテスト。 node test-engine.js で実行 */
'use strict';
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
const addDays = (s, k) => E.dayStr(E.dayNum(s) + k);
const U = (names) => names.map((n, i) => ({ id: 'u' + (i + 1), name: n }));

function baseSubjects(today) {
  return [
    { id: 'math', name: '応用数学', examDate: addDays(today, 37), level: 2, volume: 'normal', units: U(['フーリエ級数', 'フーリエ変換', 'ラプラス変換', 'ベクトル解析', '複素関数']) },
    { id: 'algo', name: 'アルゴリズムとデータ構造', examDate: addDays(today, 38), level: 4, volume: 'normal', units: U(['計算量', '整列', '探索木', 'グラフ探索']) },
    { id: 'elec', name: '電気回路', examDate: addDays(today, 39), level: 1, volume: 'normal', units: U(['キルヒホッフ則', '交流と複素数', 'インピーダンス', '共振回路']) },
    { id: 'eng', name: '英語', examDate: addDays(today, 37), level: 3, volume: 'normal', units: U(['Lesson 5', 'Lesson 6', 'Lesson 7']) },
    { id: 'phys', name: '物理', examDate: addDays(today, 40), level: 3, volume: 'normal', units: U(['剛体', '振動', '波動', '熱力学']) },
  ];
}

/* 計画の制約チェック */
function validatePlan(label, input, plan) {
  const st = E.normSettings(input.settings);
  const subj = {};
  input.subjects.forEach((s) => (subj[s.id] = s));
  const allDays = [];
  if (!plan.today.locked) allDays.push({ date: input.today, sessions: plan.today.sessions });
  allDays.push(...plan.days);
  // 実績（記録）から演習の完了日を拾う
  const practiceDoneDay = {};
  for (const date of Object.keys(input.days || {}).sort()) {
    for (const x of input.days[date].sessions) if (x.done && x.ph === 'practice') practiceDoneDay[x.sid + '/' + x.uid] = practiceDoneDay[x.sid + '/' + x.uid] || date;
  }
  for (const d of allDays) {
    const n = E.dayNum(d.date);
    const cap = E.capacityOf(n, st);
    const used = d.sessions.reduce((a, x) => a + x.min, 0);
    check(used <= cap, `${label}: ${d.date} の合計 ${used}分 が上限 ${cap}分 を超えている`);
    for (const x of d.sessions) {
      const ex = E.dayNum(subj[x.sid].examDate);
      check(n < ex, `${label}: ${d.date} に試験日以降の科目 ${x.sid} が入っている`);
      if (x.ph === 'final') check(x.crunch || n >= ex - E.FINAL_WINDOW, `${label}: ${d.date} ${x.sid} の総復習が早すぎる`);
      if (x.ph === 'practice') practiceDoneDay[x.sid + '/' + x.uid] = practiceDoneDay[x.sid + '/' + x.uid] || d.date;
      if (x.ph === 'review') {
        const pd = practiceDoneDay[x.sid + '/' + x.uid];
        check(pd && pd < d.date, `${label}: ${d.date} ${x.sid}/${x.uid} の復習が演習より前（演習 ${pd}）`);
      }
      check(x.min >= 5, `${label}: ${d.date} に5分未満のコマ`);
    }
  }
}

function printPlan(plan, subjects, maxDays) {
  const name = {};
  subjects.forEach((s) => (name[s.id] = s.name.slice(0, 4)));
  const line = (d) => {
    const used = d.sessions.reduce((a, x) => a + x.min, 0);
    const items = d.sessions.map((x) => `${name[x.sid]}:${E.PHASES[x.ph]}${x.uid ? '(' + x.uid + ')' : ''}${x.min}`).join(' ');
    return `${d.date} ${['日', '月', '火', '水', '木', '金', '土'][E.weekday(E.dayNum(d.date))]} ${String(used).padStart(3)}/${String(d.cap ?? '').padStart(3)} ${items}`;
  };
  if (!plan.today.locked) console.log('  [今日] ' + line({ date: plan.today.date, cap: plan.today.cap, sessions: plan.today.sessions }));
  plan.days.slice(0, maxDays).forEach((d) => console.log('         ' + line(d)));
}

/* ---------------- シナリオ1：後期中間（約5週間前） ---------------- */
console.log('\n■ シナリオ1：試験5週間前、平日90分・休日180分');
{
  const today = '2026-10-18';
  const input = { today, settings: { weekdayMin: 90, weekendMin: 180, sessionMin: 30 }, subjects: baseSubjects(today), days: {} };
  const plan = E.computePlan(input);
  validatePlan('S1', input, plan);
  printPlan(plan, input.subjects, 45);
  console.log('  科目別 必要/予定/不足:');
  for (const s of input.subjects) {
    const st = plan.stats[s.id];
    console.log(`   ${s.name.padEnd(12, '　')} Lv${s.level} 必要 ${E.fmtMin(st.required).padStart(8)} 予定 ${E.fmtMin(st.planned).padStart(8)} 不足 ${st.shortage} 負荷 ${st.load.toFixed(2)} 状態 ${st.status} 単元完了 ${st.queueDoneDay}`);
    check(st.shortage === 0, `S1: ${s.name} に不足がある`);
    check(st.planned >= st.required - 5, `S1: ${s.name} の予定量が必要量に届かない`);
  }
  // 苦手科目ほど時間が多い（単元数あたり）
  const per = (id) => plan.stats[id].required / plan.stats[id].units;
  check(per('elec') > per('math') && per('math') > per('phys') && per('phys') > per('algo'), 'S1: 理解度が低い科目ほど1単元あたりの時間が多い');
  // 前倒ししすぎない：最初の1週間の合計が使える時間の100%未満
  const firstWeek = [plan.today].concat(plan.days.slice(0, 6));
  const usedW = firstWeek.reduce((a, d) => a + d.sessions.reduce((b, x) => b + x.min, 0), 0);
  const capW = firstWeek.reduce((a, d) => a + (d.cap || 0), 0);
  console.log(`  最初の1週間：${usedW}/${capW}分 を使用`);
  check(usedW < capW, 'S1: 余裕があるときは使える時間をすべて埋めない');
  check(usedW > 0, 'S1: 最初の週にも学習が入る');
  // 1日に入る科目の数
  const mix = plan.days.filter((d) => d.sessions.length).map((d) => new Set(d.sessions.map((x) => x.sid)).size);
  console.log(`  1日の科目数：平均 ${(mix.reduce((a, b) => a + b, 0) / mix.length).toFixed(2)}`);
  // 同じ単元の「理解」の終わりから「演習」の始まりまでの日数
  const all = [{ date: today, sessions: plan.today.sessions }].concat(plan.days);
  const learnEnd = {};
  const practiceStart = {};
  for (const d of all) for (const x of d.sessions) {
    const k = x.sid + '/' + x.uid;
    if (x.ph === 'learn') learnEnd[k] = d.date;
    if (x.ph === 'practice' && !practiceStart[k]) practiceStart[k] = d.date;
  }
  const gaps = Object.keys(learnEnd).map((k) => E.dayNum(practiceStart[k]) - E.dayNum(learnEnd[k]));
  const maxGap = Math.max(...gaps);
  console.log(`  理解→演習の間隔：最大 ${maxGap}日、平均 ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)}日`);
  check(maxGap <= 4, 'S1: 理解と演習が4日以上離れない');
}

/* ---------------- シナリオ2：仮想ユーザー（できない日がある） ---------------- */
function runVirtualUser(label, opts) {
  const today0 = '2026-10-18';
  const subjects = baseSubjects(today0);
  const settings = { weekdayMin: opts.weekday, weekendMin: opts.weekend, sessionMin: 30 };
  const days = {};
  let seed = opts.seed || 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const lastExam = Math.max(...subjects.map((s) => E.dayNum(s.examDate)));
  let missed = 0;
  let firstShortageDay = null;
  for (let n = E.dayNum(today0); n < lastExam; n++) {
    const today = E.dayStr(n);
    const input = { today, settings, subjects, days };
    const plan = E.computePlan(input);
    validatePlan(label + ' ' + today, input, plan);
    if (plan.totalShortage && !firstShortageDay) firstShortageDay = today;
    // 今日の計画を確定
    days[today] = { sessions: plan.today.sessions.map((x, i) => Object.assign({ id: today + '-' + i, done: false }, x)) };
    const skipDay = opts.skipDays.includes(n - E.dayNum(today0));
    for (const x of days[today].sessions) {
      if (!skipDay && rnd() < opts.p) {
        x.done = true;
        const r = rnd();
        x.rating = r < 0.15 ? 'hard' : r > 0.85 ? 'easy' : 'ok';
      } else missed++;
    }
    // ときどき「もう1コマ」
    if (!skipDay && opts.extra && rnd() < opts.extra) {
      const ex = E.nextExtraSession({ today, settings, subjects, days });
      if (ex) days[today].sessions.push(Object.assign({ id: today + '-x', done: true, rating: 'ok' }, ex));
    }
  }
  // 試験日までの達成度
  const finalPlan = E.computePlan({ today: E.dayStr(lastExam + 1), settings, subjects, days });
  console.log(`  未完了コマ ${missed} 件、最初に不足が出た日 ${firstShortageDay || 'なし'}`);
  for (const s of subjects) {
    const st = finalPlan.stats[s.id];
    console.log(`   ${s.name.padEnd(12, '　')} 必要 ${E.fmtMin(st.required).padStart(8)} 実施 ${E.fmtMin(st.done).padStart(8)} 達成 ${Math.round((st.done / st.required) * 100)}%`);
  }
  return finalPlan;
}

console.log('\n■ シナリオ2a：コマの75%だけ実施、3日まるごと休んだ日あり');
{
  const p = runVirtualUser('S2a', { weekday: 90, weekend: 180, p: 0.75, skipDays: [3, 4, 12], seed: 11 });
  for (const id of Object.keys(p.stats)) check(p.stats[id].done >= p.stats[id].required * 0.9, `S2a: ${id} が試験までに終わっていない (${p.stats[id].done}/${p.stats[id].required})`);
}
console.log('\n■ シナリオ2b：コマの55%だけ実施（かなりサボる）');
{
  const p = runVirtualUser('S2b', { weekday: 90, weekend: 180, p: 0.55, skipDays: [1, 2, 8, 9, 15], seed: 5 });
  const avg = Object.values(p.stats).reduce((a, s) => a + s.done / s.required, 0) / 5;
  check(avg > 0.7, 'S2b: 半分近くサボっても再調整で7割以上こなせる（実施率55%より高い）');
}
console.log('\n■ シナリオ2c：全部こなす＋ときどきもう1コマ');
{
  const p = runVirtualUser('S2c', { weekday: 60, weekend: 120, p: 1, skipDays: [], extra: 0.3, seed: 3 });
  for (const id of Object.keys(p.stats)) check(p.stats[id].done >= p.stats[id].required, `S2c: ${id} が終わっていない`);
}

/* ---------------- シナリオ3：時間が足りない ---------------- */
console.log('\n■ シナリオ3：試験まで5日、平日60分しかない');
{
  const today = '2026-10-18';
  const subjects = baseSubjects(today).map((s, i) => Object.assign({}, s, { examDate: addDays(today, 4 + (i % 3)) }));
  const input = { today, settings: { weekdayMin: 60, weekendMin: 60, sessionMin: 30 }, subjects, days: {} };
  const plan = E.computePlan(input);
  validatePlan('S3', input, plan);
  printPlan(plan, subjects, 7);
  console.log('  不足：' + subjects.map((s) => `${s.name.slice(0, 4)} ${E.fmtMin(plan.stats[s.id].shortage)}`).join(' / '));
  check(plan.totalShortage > 0, 'S3: 不足が検出される');
  const used = [plan.today].concat(plan.days).reduce((a, d) => a + d.sessions.reduce((b, x) => b + x.min, 0), 0);
  check(used === 60 * 6, `S3: 足りないときは使える時間をすべて使う (${used}/360)`);
  const boost = E.suggestBoost(input);
  console.log('  提案：毎日 +' + boost.add + '分');
  // 苦手科目（電気回路 Lv1）と得意科目（アルゴ Lv4）の配分
  const planned = (id) => plan.stats[id].planned;
  console.log(`  予定：電気回路 ${planned('elec')}分 / アルゴ ${planned('algo')}分`);
}
console.log('\n■ シナリオ3b：あと少しで足りる → 提案で解消するか');
{
  const today = '2026-10-18';
  const subjects = baseSubjects(today).slice(0, 3).map((s) => Object.assign({}, s, { examDate: addDays(today, 12) }));
  const input = { today, settings: { weekdayMin: 60, weekendMin: 60, sessionMin: 30 }, subjects, days: {} };
  const plan = E.computePlan(input);
  const boost = E.suggestBoost(input);
  console.log(`  不足 ${E.fmtMin(plan.totalShortage)} → 提案 毎日+${boost.add}分`);
  check(plan.totalShortage > 0 && boost.add, 'S3b: 不足があり、解消できる増分が見つかる');
  const after = E.computePlan(Object.assign({}, input, { settings: { weekdayMin: 60 + boost.add, weekendMin: 60 + boost.add, sessionMin: 30 } }));
  check(after.totalShortage === 0, 'S3b: 提案どおり増やすと不足が0になる');
}

/* ---------------- シナリオ4：境界ケース ---------------- */
console.log('\n■ シナリオ4：境界ケース');
{
  const today = '2026-10-18';
  const subjects = [
    { id: 'a', name: '明日試験', examDate: addDays(today, 1), level: 3, volume: 'normal', units: U(['A', 'B']) },
    { id: 'b', name: '今日試験', examDate: today, level: 3, volume: 'normal', units: U(['A']) },
    { id: 'c', name: '終わった', examDate: addDays(today, -3), level: 3, volume: 'normal', units: U(['A']) },
    { id: 'd', name: '単元なし', examDate: addDays(today, 10), level: 3, volume: 'normal', units: [] },
  ];
  const input = { today, settings: {}, subjects, days: {} };
  const plan = E.computePlan(input);
  validatePlan('S4', input, plan);
  printPlan(plan, subjects, 3);
  check(plan.today.sessions.every((x) => x.sid === 'a'), 'S4: 今日の計画は明日試験の科目だけ');
  check(plan.today.sessions.some((x) => x.ph === 'final'), 'S4: 試験前日は総復習が入る');
  check(plan.stats.b.status === 'exam' && plan.stats.c.status === 'passed', 'S4: 今日試験・終了の状態');
  check(plan.stats.d.required === 0, 'S4: 単元なしは必要量0');
  // 休みの日（上書き0）
  const input2 = { today, settings: { overrides: { [today]: 0 } }, subjects: baseSubjects(today), days: {} };
  const p2 = E.computePlan(input2);
  check(p2.today.sessions.length === 0, 'S4: 使える時間0の日は予定なし');
  // 設定がおかしな値でも落ちない
  const p3 = E.computePlan({ today, settings: { weekdayMin: 'abc', weekendMin: -5, sessionMin: 999 }, subjects: baseSubjects(today), days: {} });
  check(Array.isArray(p3.days), 'S4: 不正な設定値でも計算できる');
  // 空
  const p4 = E.computePlan({ today, settings: {}, subjects: [], days: {} });
  check(p4.today.sessions.length === 0 && p4.days.length === 0, 'S4: 科目なし');
}

/* ---------------- シナリオ5：手応え・作り直し・もう1コマ ---------------- */
console.log('\n■ シナリオ5：手応え・今日の作り直し・もう1コマ');
{
  const today = '2026-10-18';
  const subjects = baseSubjects(today);
  const settings = { weekdayMin: 90, weekendMin: 180, sessionMin: 30 };
  const lv = E.LEVELS[2];
  const reqBefore = E.subjectRequirement(subjects[0], []).total;
  const reqHard = E.subjectRequirement(subjects[0], [{ uid: 'u1', ph: 'practice', rating: 'hard' }]).total;
  const reqEasy = E.subjectRequirement(subjects[0], [{ uid: 'u1', ph: 'practice', rating: 'easy' }]).total;
  console.log(`  応用数学の必要量 ふつう ${reqBefore} / むずかしい ${reqHard} / かんたん ${reqEasy}`);
  check(reqHard === reqBefore + 20, 'S5: むずかしいで復習+20分');
  check(reqEasy === reqBefore - Math.max(10, Math.round((lv.reviews[1]) / 5) * 5), 'S5: かんたんで復習が1回減る');

  // 今日を確定 → 1つ完了 → 作り直し
  const p = E.computePlan({ today, settings, subjects, days: {} });
  const days = { [today]: { sessions: p.today.sessions.map((x, i) => Object.assign({ id: 's' + i, done: i === 0 }, x)) } };
  const re = E.replanToday({ today, settings, subjects, days });
  check(re.kept.length === 1, 'S5: 作り直しで完了したコマは残る');
  const total = re.kept.concat(re.fresh).reduce((a, x) => a + x.min, 0);
  check(total <= 180, 'S5: 作り直し後も今日の上限以内');
  // 科目を追加して作り直すと、その科目も今日に入りうる
  const subjects2 = subjects.concat([{ id: 'new', name: '情報理論', examDate: addDays(today, 6), level: 1, volume: 'normal', units: U(['エントロピー', '符号化', '通信路']) }]);
  const re2 = E.replanToday({ today, settings, subjects: subjects2, days });
  check(re2.fresh.some((x) => x.sid === 'new'), 'S5: 追加した直近の苦手科目が今日の計画に入る');
  // もう1コマ
  const ex = E.nextExtraSession({ today, settings, subjects, days });
  console.log('  もう1コマ → ' + (ex ? `${ex.sid} ${E.PHASES[ex.ph]} ${ex.min}分` : 'なし'));
  check(ex && ex.min > 0 && ex.min <= 45, 'S5: もう1コマが返る');
  // 確定済みの今日は計画が変わらない（今日の分はそのまま返す）
  const p2 = E.computePlan({ today, settings, subjects, days });
  check(p2.today.locked && p2.today.sessions.length === days[today].sessions.length, 'S5: 確定済みの今日はそのまま');
  // 昨日の未完了は今日以降に組み込まれる
  const y = addDays(today, -1);
  const pY = E.computePlan({ today: y, settings, subjects, days: {} });
  const daysY = { [y]: { sessions: pY.today.sessions.map((x, i) => Object.assign({ id: 'y' + i, done: false }, x)) } };
  const pT = E.computePlan({ today, settings, subjects, days: daysY });
  const firstY = pY.today.sessions[0];
  const found = [{ sessions: pT.today.sessions }].concat(pT.days).some((d) => d.sessions.some((x) => x.sid === firstY.sid && x.uid === firstY.uid && x.ph === firstY.ph));
  check(found, 'S5: 昨日できなかったコマが今日以降の計画に戻ってくる');
}

/* ---------------- シナリオ6：理解度の変更 ---------------- */
console.log('\n■ シナリオ6：途中で理解度を上げる');
{
  const today = '2026-10-18';
  const s = baseSubjects(today)[2]; // 電気回路 Lv1
  const r1 = E.subjectRequirement(s, []).total;
  const r3 = E.subjectRequirement(Object.assign({}, s, { level: 3 }), []).total;
  console.log(`  電気回路 Lv1 ${E.fmtMin(r1)} → Lv3 ${E.fmtMin(r3)}`);
  check(r3 < r1, 'S6: 理解度を上げると必要量が減る');
}

/* ---------------- シナリオ7：ページ数による配分 ---------------- */
console.log('\n■ シナリオ7：ページ数で単元の時間を配分');
{
  check(E.unitWeight({ from: 1, to: 15 }) === 1, 'S7: 15ページで重み1');
  check(E.unitWeight({ from: 1, to: 30 }) === 2, 'S7: 30ページで重み2');
  check(E.unitWeight({ from: 5, to: 5 }) === 0.3, 'S7: 1ページは下限0.3');
  check(E.unitWeight({ from: 1, to: 300 }) === 5, 'S7: 上限5');
  check(E.unitWeight({ name: 'x' }) === 1, 'S7: ページなしは1');
  check(E.unitWeight({ from: 20, to: 10 }) === 1, 'S7: 逆順のページは使わない');
  check(E.unitPages({ from: 12, to: 25 }) === 14, 'S7: p.12〜25 は14ページ');

  // ページなしは以前と同じ（応用数学 Lv2・5単元 = 715分）
  const today = '2026-10-18';
  const math = baseSubjects(today)[0];
  check(E.subjectRequirement(math, []).total === 715, 'S7: ページなしの単元は以前と同じ必要量');

  // ページの多い単元ほど時間が多い
  const subj = { id: 'p', name: '物理', examDate: addDays(today, 30), level: 3, volume: 'normal', units: [
    { id: 'a', name: '短い節', from: 1, to: 6 },
    { id: 'b', name: 'ふつうの節', from: 7, to: 21 },
    { id: 'c', name: '長い節', from: 22, to: 51 },
  ] };
  const req = E.subjectRequirement(subj, []);
  const per = req.units.map((u) => u.learn + u.practice + u.reviews.reduce((a, b) => a + b, 0));
  console.log('  6ページ / 15ページ / 30ページ → ' + per.map((m) => m + '分').join(' / '));
  check(per[0] < per[1] && per[1] < per[2], 'S7: ページが多い単元ほど時間が多い');
  check(per[1] === 105, 'S7: 15ページの単元は理解度3の標準（105分）');

  // 目次から作った単元で、計画全体が制約を満たす
  const T = require('./toc.js');
  const toc = T.prepare({ items: [
    { level: 1, no: '第1章', title: '力学', page: 1 },
    { level: 2, no: '1.1', title: '運動の法則', page: 2 },
    { level: 2, no: '1.2', title: '運動量', page: 14 },
    { level: 2, no: '1.3', title: '円運動', page: 30 },
    { level: 1, no: '第2章', title: '波動', page: 52 },
    { level: 2, no: '2.1', title: '波の性質', page: 53 },
    { level: 2, no: '2.2', title: '音波', page: 66 },
    { level: 1, title: '索引', page: 90 },
  ] }, 'p.1-89');
  const units = T.selectedUnits(toc.items, toc.gran, toc.sel).map((u, i) => Object.assign({ id: 'k' + i }, u));
  const subjects = baseSubjects(today).slice(0, 2).concat([{ id: 'toc', name: '物理（目次）', examDate: addDays(today, 21), level: 2, volume: 'normal', units }]);
  const input = { today, settings: { weekdayMin: 90, weekendMin: 180, sessionMin: 30 }, subjects, days: {} };
  const plan = E.computePlan(input);
  validatePlan('S7', input, plan);
  console.log(`  目次の単元：${units.map((u) => u.name + '(' + E.unitPages(u) + 'p)').join('、')}`);
  console.log(`  物理（目次）必要 ${E.fmtMin(plan.stats.toc.required)} / 予定 ${E.fmtMin(plan.stats.toc.planned)} / 不足 ${plan.stats.toc.shortage}`);
  check(plan.stats.toc.shortage === 0 && plan.stats.toc.planned >= plan.stats.toc.required - 5, 'S7: 目次から作った科目も試験までに入る');
}

console.log(`\n結果：${passes} 件成功、${failures} 件失敗`);
process.exit(failures ? 1 : 0);
