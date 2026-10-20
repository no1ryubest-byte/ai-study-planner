/* ============================================================
 * PlannerEngine — 学習計画エンジン（副作用なしの純粋関数）
 *
 *  入力 : 科目（試験日・理解度・単元）、設定（1日に使える時間）、
 *         日ごとの記録（各コマの完了・手応え）
 *  出力 : 今日のメニュー、明日以降の日別計画、科目ごとの進み具合
 *
 *  ・試験日から逆算し、試験日までに必要な時間が収まるように配分する
 *  ・理解度が低い科目ほど 1 単元あたりの時間を多く見積もり、優先度も上げる
 *  ・記録（終わったコマ）から残りを毎回計算し直すので、
 *    できなかった分は自動で翌日以降に組み直される
 * ============================================================ */
(function (global) {
  'use strict';

  const DAY_MS = 86400000;

  /* 理解度ごとの 1 単元あたりの見積もり（分）と優先度の重み */
  const LEVELS = {
    1: { label: 'ほぼゼロ', learn: 60, practice: 60, reviews: [25, 20], fin: 1.4, w: 1.6 },
    2: { label: '苦手', learn: 45, practice: 50, reviews: [20, 15], fin: 1.2, w: 1.3 },
    3: { label: 'ふつう', learn: 30, practice: 45, reviews: [15, 15], fin: 1.0, w: 1.0 },
    4: { label: '得意', learn: 15, practice: 35, reviews: [15], fin: 0.85, w: 0.8 },
    5: { label: 'ほぼ完璧', learn: 0, practice: 25, reviews: [10], fin: 0.7, w: 0.6 },
  };
  const VOLUMES = { small: 0.75, normal: 1, large: 1.35 };
  const VOLUME_LABELS = { small: '少なめ', normal: 'ふつう', large: '多め' };
  const PHASES = { learn: '理解', practice: '演習', review: '復習', final: '総復習' };

  const REVIEW_GAPS = [1, 3, 2]; // 演習が終わった翌日 → 3日後 → 以降2日おき
  const EXTRA_REVIEW_MIN = 20; // 「むずかしい」と答えた単元に足す復習
  const PAGES_PER_UNIT = 15; // ページ数が分かる単元は、15ページを1単元分として見積もる
  const MIN_WEIGHT = 0.3;
  const MAX_WEIGHT = 5;
  const FINAL_WINDOW = 3; // 試験の3日前から総復習を解禁
  const MIN_SESSION = 10;

  /* ---------- 小さなユーティリティ ---------- */
  const r5 = (x) => Math.max(0, Math.round(x / 5) * 5);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function dayNum(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }
  function dayStr(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }
  function weekday(n) {
    return new Date(n * DAY_MS).getUTCDay();
  }
  function clampInt(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }
  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return m + '分';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h + '時間' + (mm ? mm + '分' : '');
  }

  function normSettings(st) {
    st = st || {};
    return {
      weekdayMin: clampInt(st.weekdayMin, 0, 720, 90),
      weekendMin: clampInt(st.weekendMin, 0, 720, 180),
      sessionMin: clampInt(st.sessionMin, 15, 120, 30),
      overrides: st.overrides && typeof st.overrides === 'object' ? st.overrides : {},
    };
  }

  /* その日に勉強に使える時間（分）。日別の上書きが最優先 */
  function capacityOf(n, st) {
    const key = dayStr(n);
    if (Object.prototype.hasOwnProperty.call(st.overrides, key)) {
      return clampInt(st.overrides[key], 0, 720, 0);
    }
    const w = weekday(n);
    return w === 0 || w === 6 ? st.weekendMin : st.weekdayMin;
  }

  function validSubject(s) {
    return s && s.id && /^\d{4}-\d{2}-\d{2}$/.test(String(s.examDate || '')) && Array.isArray(s.units);
  }

  /* ---------- 必要な学習量 ---------- */
  /** 単元のページ数（教科書の p.from〜to が分かるとき。分からなければ null） */
  function unitPages(u) {
    if (!u || u.from == null || u.to == null) return null;
    const a = Number(u.from);
    const b = Number(u.to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) return null;
    return b - a + 1;
  }
  /** 単元の重み：ページ数が分かれば 15ページ＝1（0.3〜5）、分からなければ 1 */
  function unitWeight(u) {
    const p = unitPages(u);
    if (p === null) return 1;
    return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, p / PAGES_PER_UNIT));
  }

  function subjectRequirement(subject, logs) {
    logs = logs || [];
    const L = LEVELS[subject.level] || LEVELS[3];
    const v = VOLUMES[subject.volume] || 1;
    const units = subject.units || [];
    const out = { units: [], final: 0, total: 0, weight: 0 };
    for (const u of units) {
      let hard = 0;
      let easy = 0;
      for (const l of logs) {
        if (l.uid !== u.id || l.ph === 'final') continue;
        if (l.rating === 'hard') hard++;
        else if (l.rating === 'easy') easy++;
      }
      const w = unitWeight(u);
      const reviews = L.reviews.map((m) => Math.max(10, r5(m * v * w)));
      for (let i = 0; i < Math.min(3, hard); i++) reviews.push(Math.max(10, r5(EXTRA_REVIEW_MIN * w)));
      for (let i = 0; i < easy && reviews.length; i++) reviews.pop();
      const learn = L.learn ? Math.max(10, r5(L.learn * v * w)) : 0;
      const practice = Math.max(15, r5(L.practice * v * w));
      out.units.push({ id: u.id, name: u.name, learn, practice, reviews, w, pages: unitPages(u) });
      out.total += learn + practice + sum(reviews);
      out.weight += w;
    }
    let finHard = 0;
    for (const l of logs) if (l.ph === 'final' && l.rating === 'hard') finHard++;
    // 総復習は単元の量（重みの合計）に比例。単元の分け方（章ごと・節ごと）で変わらない
    out.final = units.length
      ? Math.max(20, r5((15 + 8 * out.weight) * L.fin * v)) + Math.min(2, finHard) * EXTRA_REVIEW_MIN
      : 0;
    out.total += out.final;
    return out;
  }

  /* ---------- 記録から「残り」を組み立てる ---------- */
  function buildState(subject, logs) {
    const req = subjectRequirement(subject, logs);
    const exam = dayNum(subject.examDate);
    const L = LEVELS[subject.level] || LEVELS[3];
    const s = {
      sid: subject.id,
      exam,
      w: L.w,
      queue: [],
      revs: {},
      order: [],
      fin: null,
      req,
      done: 0,
      queueDoneDay: null,
      learnDay: {},
    };
    const byUnit = {};
    for (const l of logs) {
      const key = l.uid == null ? '_final' : l.uid;
      (byUnit[key] = byUnit[key] || []).push(l);
    }
    for (const u of req.units) {
      s.order.push(u.id);
      const ul = (byUnit[u.id] || []).slice().sort((a, b) => a.date - b.date);
      let learnDone = 0;
      let practiceDone = 0;
      let pDate = null;
      let lDate = null;
      const rlogs = [];
      for (const l of ul) {
        if (l.ph === 'learn') {
          learnDone += l.min;
          if (lDate === null && learnDone >= u.learn) lDate = l.date;
        } else if (l.ph === 'practice') {
          practiceDone += l.min;
          if (pDate === null && practiceDone >= u.practice) pDate = l.date;
        } else if (l.ph === 'review') rlogs.push(l);
      }
      const learnRem = Math.max(0, u.learn - learnDone);
      const practiceRem = Math.max(0, u.practice - practiceDone);
      s.learnDay[u.id] = u.learn > 0 && learnRem === 0 ? lDate : null;
      if (learnRem > 0) s.queue.push({ uid: u.id, ph: 'learn', rem: learnRem, full: u.learn });
      if (practiceRem > 0) s.queue.push({ uid: u.id, ph: 'practice', rem: practiceRem, full: u.practice });

      const list = u.reviews.slice();
      let k = 0;
      let last = null;
      let revDone = 0;
      for (const l of rlogs) {
        revDone += l.min;
        let m = l.min;
        while (m > 0 && list.length) {
          const take = Math.min(m, list[0]);
          list[0] -= take;
          m -= take;
          if (list[0] < 5) {
            list.shift();
            k++;
            last = l.date;
          }
        }
      }
      let rel = Infinity;
      if (practiceRem === 0 && list.length) {
        const base = k === 0 ? pDate : last;
        rel = (base === null ? -Infinity : base) + REVIEW_GAPS[Math.min(k, REVIEW_GAPS.length - 1)];
      }
      if (rel !== Infinity && rel >= exam) list.length = 0; // 試験までに間に合わない復習は総復習でまとめる
      s.revs[u.id] = { list, k, rel };
      s.done += Math.min(u.learn, learnDone) + Math.min(u.practice, practiceDone) + Math.min(sum(u.reviews), revDone);
    }
    let finDone = 0;
    for (const l of byUnit._final || []) if (l.ph === 'final') finDone += l.min;
    s.done += Math.min(req.final, finDone);
    let finRem = Math.max(0, req.final - finDone);
    if (finRem < 5) finRem = 0;
    s.fin = { rem: finRem, rel: exam - FINAL_WINDOW };
    if (!s.queue.length) s.queueDoneDay = -Infinity;
    return s;
  }

  function workOf(s) {
    let w = s.fin.rem;
    for (const q of s.queue) w += q.rem;
    for (const uid of s.order) w += sum(s.revs[uid].list);
    return w;
  }

  function dueReviewMin(s, n) {
    let m = 0;
    for (const uid of s.order) {
      const r = s.revs[uid];
      if (r.list.length && r.rel <= n) m += r.list[0];
    }
    return m;
  }

  /* その日の総復習の枠：解禁日から試験前日まで分けて取り組む（直前・追い込み時はまとめて） */
  function setFinalQuota(s, n) {
    s.finUsed = 0;
    s.finQuota = 0;
    const rel = s.crunchFinal ? n : s.fin.rel;
    if (s.fin.rem <= 0 || n < rel || n >= s.exam) return;
    const daysLeft = s.exam - n;
    let q = daysLeft <= 1 || s.crunchFinal ? s.fin.rem : Math.min(s.fin.rem, Math.max(20, Math.ceil(s.fin.rem / daysLeft / 5) * 5));
    if (s.fin.rem - q < 15) q = s.fin.rem; // 翌日に半端を残さない
    s.finQuota = q;
  }

  /* その日に取り組める次のタスク
   *  期限の来た復習 → 総復習（前日・単元が終わった後・追い込み時） → 新しい単元 */
  function pickTask(s, n) {
    if (n >= s.exam) return null;
    let bu = null;
    let br = Infinity;
    for (const uid of s.order) {
      const r = s.revs[uid];
      if (r.list.length && r.rel <= n && r.rel < br) {
        br = r.rel;
        bu = uid;
      }
    }
    if (bu !== null) {
      const r = s.revs[bu];
      return { kind: 'review', uid: bu, ph: 'review', rem: r.list[0], nth: r.k + 1 };
    }
    const finLeft = Math.min(s.fin.rem, Math.max(0, (s.finQuota || 0) - (s.finUsed || 0)));
    if (finLeft >= 5 && (s.crunchFinal || n === s.exam - 1 || !s.queue.length)) {
      return { kind: 'final', uid: null, ph: 'final', rem: finLeft };
    }
    if (s.queue.length) {
      const q = s.queue[0];
      const ld = s.learnDay[q.uid];
      const since = q.ph === 'practice' && ld != null ? Math.max(0, n - ld) : null; // 理解を終えてからの日数
      return { kind: 'queue', uid: q.uid, ph: q.ph, rem: q.rem, cont: q.rem < q.full, since };
    }
    return null;
  }

  function applyTask(s, t, amt, n) {
    if (t.kind === 'review') {
      const r = s.revs[t.uid];
      r.list[0] -= amt;
      if (r.list[0] < 5) {
        r.list.shift();
        r.k++;
        r.rel = r.list.length ? n + REVIEW_GAPS[Math.min(r.k, REVIEW_GAPS.length - 1)] : Infinity;
        if (r.rel !== Infinity && r.rel >= s.exam) r.list.length = 0;
      }
    } else if (t.kind === 'final') {
      s.fin.rem -= amt;
      s.finUsed = (s.finUsed || 0) + amt;
      if (s.fin.rem < 5) s.fin.rem = 0;
    } else {
      const q = s.queue[0];
      q.rem -= amt;
      if (q.rem <= 0) {
        s.queue.shift();
        if (q.ph === 'learn') s.learnDay[q.uid] = n;
        if (q.ph === 'practice') {
          const r = s.revs[q.uid];
          if (r.list.length) {
            r.rel = n + REVIEW_GAPS[Math.min(r.k, REVIEW_GAPS.length - 1)];
            if (r.rel >= s.exam) r.list.length = 0;
          }
        }
        if (!s.queue.length) s.queueDoneDay = n;
      }
    }
  }

  function addSession(day, s, t, amt) {
    const last = day.sessions.find((x) => x.sid === s.sid && x.uid === t.uid && x.ph === t.ph);
    if (last) {
      last.min += amt;
      return;
    }
    const sess = { sid: s.sid, uid: t.uid, ph: t.ph, min: amt };
    if (t.nth) sess.nth = t.nth;
    if (t.cont) sess.cont = true;
    if (t.kind === 'final' && s.crunchFinal) sess.crunch = true;
    day.sessions.push(sess);
  }

  /* ---------- 日ごとのシミュレーション ----------
   *  1) その日の目標時間
   *     各試験日の「余裕日」（残り日数の2割・最大7日）より前に、単元の学習と復習が
   *     終わるペースを求め、それに少し余裕を足す。総復習と期限の来た復習は必ず入れる。
   *  2) コマ（既定30分）ごとに科目を選ぶ
   *     ・どこかの試験日で余裕が1コマ未満なら、その試験日までの科目に限定（締切に間に合わせる）
   *     ・どうやっても間に合わない「追い込み」状態の科目（試験まで7日以内）は、
   *       まず総復習で全範囲を一通り押さえる
   *     ・それ以外は「残り ÷ 試験までに使える時間 × 苦手の重み」が大きい科目
   *       （やりかけの単元は少し上げ、同じ日に同じ科目が続くほど少し下げる）
   */
  function simulate(states, st, startN, opts) {
    opts = opts || {};
    const endN = Math.max.apply(null, states.map((s) => s.exam).concat([startN]));
    const caps = [];
    for (let n = startN; n <= endN; n++) caps.push(capacityOf(n, st));
    if (opts.forceCap != null) caps[0] = opts.forceCap;
    else if (opts.todayUsed) caps[0] = Math.max(0, caps[0] - opts.todayUsed);
    const pre = [0];
    for (let i = 0; i < caps.length; i++) pre.push(pre[i] + caps[i]);
    const unit = st.sessionMin;
    const days = [];
    const lastDay = opts.onlyFirstDay ? startN : endN;

    for (let i = 0; startN + i <= lastDay; i++) {
      const n = startN + i;
      const capFull = caps[i];
      const day = { date: dayStr(n), n, cap: capFull, target: 0, used: 0, sessions: [] };
      days.push(day);
      if (capFull <= 0) continue;
      const act = states.filter((s) => s.exam > n && workOf(s) > 0);
      if (!act.length) continue;

      // n日目の残り（今日の使用分を除く）から、試験日Eの前日までに使える時間
      const capUntil = (E, used) => capFull - used + (pre[Math.max(i + 1, E - startN)] - pre[i + 1]);
      const exams = Array.from(new Set(act.map((s) => s.exam))).sort((a, b) => a - b);
      const cumW = () => {
        const out = [];
        let c = 0;
        for (const E of exams) {
          for (const s of act) if (s.exam === E) c += workOf(s);
          out.push(c);
        }
        return out;
      };

      // 追い込み判定と総復習の枠
      const cw0 = cumW();
      exams.forEach((E, k) => {
        const crunch = cw0[k] > capUntil(E, 0);
        for (const s of act) if (s.exam === E) s.crunchFinal = crunch && E - n <= 7;
      });
      for (const s of act) setFinalQuota(s, n);

      // ペース（余裕日を残して終えるための負荷率）
      let lam = 0;
      let lamFull = 0;
      let main = 0;
      exams.forEach((E, k) => {
        for (const s of act) if (s.exam === E) main += workOf(s) - s.fin.rem;
        // 単元は「試験1週間前」までに終える（近いときは総復習の解禁日まで）
        const buffer = Math.max(0, Math.min(7, E - n - FINAL_WINDOW));
        const capB = capUntil(E - buffer, 0);
        lam = Math.max(lam, capB > 0 ? main / capB : main > 0 ? Infinity : 0);
        const capE = capUntil(E, 0);
        lamFull = Math.max(lamFull, capE > 0 ? cw0[k] / capE : Infinity);
      });
      let floor = 0;
      for (const s of act) floor += dueReviewMin(s, n) + s.finQuota;
      let target;
      if (opts.forceCap != null && i === 0) target = capFull;
      else if (lam >= 0.85 || lamFull >= 0.85) target = capFull;
      else target = r5(capFull * (1.15 * lam + 0.05));
      target = Math.min(capFull, Math.max(target, floor, unit));
      day.target = target;
      day.load = Math.max(lam, lamFull);

      let used = 0;
      const cnt = {};
      let guard = 0;
      while (target - used >= Math.min(15, unit / 2) && guard++ < 300) {
        const left = target - used;
        const cw = cumW();
        let cands = act.filter((s) => pickTask(s, n));
        if (!cands.length) break;
        // 締切に余裕がない試験日があれば、その日までの科目に絞る（間に合う見込みがある場合）
        for (let k = 0; k < exams.length; k++) {
          const slack = capUntil(exams[k], used) - cw[k];
          if (slack < unit) {
            if (slack >= 0) {
              const tight = cands.filter((s) => s.exam <= exams[k]);
              if (tight.length) cands = tight;
            }
            break;
          }
        }
        // 追い込み中の科目は総復習を最優先（試験が近い順）
        const crunchFin = cands.filter((s) => s.crunchFinal && pickTask(s, n).kind === 'final');
        if (crunchFin.length) {
          const first = Math.min.apply(null, crunchFin.map((s) => s.exam));
          cands = crunchFin.filter((s) => s.exam === first);
        }
        // 目標の残りが1コマに満たないときは短いタスクを優先。
        // 使える時間を使い切る日（追い込み・締切が近い日）は、残り時間ぶんだけ進める
        if (left < unit) {
          // すき間時間で新しい単元を始めない（理解と演習が何日も離れるのを防ぐ）
          const short = cands.filter((s) => {
            const t = pickTask(s, n);
            return t.rem <= left + 10 && !(t.kind === 'queue' && t.ph === 'learn' && !t.cont);
          });
          if (short.length) cands = short;
          else if (target < capFull || left < 15) break;
        }
        let best = null;
        let bestScore = -1;
        for (const s of cands) {
          const capS = Math.max(1, capUntil(s.exam, used));
          const t = pickTask(s, n);
          // やりかけの単元、理解を終えて演習待ちの単元（待つほど強く）を優先して、単元を途中で放置しない
          const follow = t.cont ? 1.5 : t.since != null ? Math.min(3, 1.5 + 0.5 * t.since) : 1;
          const sc = ((workOf(s) / capS) * s.w * follow) / (1 + 0.7 * (cnt[s.sid] || 0));
          if (sc > bestScore) {
            bestScore = sc;
            best = s;
          }
        }
        const t = pickTask(best, n);
        const room = capFull - used;
        let amt = Math.min(unit, t.rem, room);
        // 1.5コマ以内に収まる単元や、半端な残りは1回で済ませる
        if (amt < t.rem && t.rem <= room && (t.rem <= unit + 15 || t.rem - amt < 15) && t.rem <= left + 15) amt = t.rem;
        if (amt < MIN_SESSION && t.rem >= MIN_SESSION) break;
        if (amt <= 0) break;
        applyTask(best, t, amt, n);
        addSession(day, best, t, amt);
        used += amt;
        cnt[best.sid] = (cnt[best.sid] || 0) + 1;
      }
      // 仕上げ：使える時間に収まる小さな残り（総復習の端数や期限の来た復習）を片付ける
      for (let g = 0; g < 10 && capFull - used >= 5; g++) {
        let pick = null;
        for (const s of act) {
          const t = pickTask(s, n);
          if (!t || t.rem >= 15 || t.rem > capFull - used) continue;
          if (t.kind === 'queue' && t.ph === 'learn' && !t.cont) continue;
          if (!pick || s.exam < pick.s.exam) pick = { s, t };
        }
        if (!pick) break;
        applyTask(pick.s, pick.t, pick.t.rem, n);
        addSession(day, pick.s, pick.t, pick.t.rem);
        used += pick.t.rem;
      }
      day.used = used;
    }
    const leftover = {};
    for (const s of states) {
      const w = workOf(s);
      if (w >= 10) leftover[s.sid] = w; // 10分未満の端数は不足として扱わない
    }
    return { days, leftover };
  }

  /* ---------- 記録の取り出し ---------- */
  function collectLogs(subjects, days, todayStr, assumeTodayDone) {
    const ids = new Set(subjects.map((s) => s.id));
    const actual = [];
    const assumed = [];
    for (const date of Object.keys(days || {})) {
      const doc = days[date];
      if (!doc || !Array.isArray(doc.sessions)) continue;
      const n = dayNum(date);
      for (const x of doc.sessions) {
        if (!x || !ids.has(x.sid)) continue;
        const log = { date: n, sid: x.sid, uid: x.uid == null ? null : x.uid, ph: x.ph, min: Number(x.min) || 0, rating: x.rating || null };
        if (x.done) actual.push(log);
        else if (assumeTodayDone && date === todayStr) assumed.push(log);
      }
    }
    return { actual, assumed };
  }

  function groupBySubject(logs) {
    const m = {};
    for (const l of logs) (m[l.sid] = m[l.sid] || []).push(l);
    return m;
  }

  function prepare(input) {
    const st = normSettings(input.settings);
    const todayN = dayNum(input.today);
    const subjects = (input.subjects || []).filter(validSubject);
    const days = input.days || {};
    return { st, todayN, subjects, days };
  }

  /* ---------- 公開API ---------- */

  /** 計画全体を計算する */
  function computePlan(input) {
    const { st, todayN, subjects, days } = prepare(input);
    const today = input.today;
    const todayDoc = days[today] && Array.isArray(days[today].sessions) ? days[today] : null;
    const locked = !!todayDoc;
    const ids = new Set(subjects.map((s) => s.id));

    const { actual, assumed } = collectLogs(subjects, days, today, locked);
    const actualBy = groupBySubject(actual);
    const futureBy = groupBySubject(actual.concat(assumed));

    const live = subjects.filter((s) => dayNum(s.examDate) > todayN);
    const startN = locked ? todayN + 1 : todayN;
    const states = live.map((s) => buildState(s, futureBy[s.id] || []));
    const stateBy = {};
    states.forEach((s) => (stateBy[s.sid] = s));

    // 計画開始時点での各試験日の負荷率
    const loadBy = {};
    {
      const caps = (from, to) => {
        let c = 0;
        for (let n = from; n < to; n++) c += capacityOf(n, st);
        return c;
      };
      const sorted = states.slice().sort((a, b) => a.exam - b.exam);
      let cum = 0;
      for (const s of sorted) {
        cum += workOf(s);
        const c = caps(startN, s.exam);
        loadBy[s.sid] = c > 0 ? cum / c : workOf(s) > 0 ? Infinity : 0;
      }
    }

    const sim = states.length ? simulate(states, st, startN, {}) : { days: [], leftover: {} };
    let todaySessions;
    let futureDays = sim.days;
    if (locked) {
      todaySessions = todayDoc.sessions.filter((x) => x && ids.has(x.sid));
    } else {
      todaySessions = sim.days.length ? sim.days[0].sessions : [];
      futureDays = sim.days.slice(1);
    }

    // 試験日の目印
    const examsByDay = {};
    for (const s of subjects) (examsByDay[s.examDate] = examsByDay[s.examDate] || []).push(s.id);
    for (const d of futureDays) d.exams = examsByDay[d.date] || [];

    const planned = {};
    for (const d of (locked ? [] : [{ sessions: todaySessions }]).concat(futureDays)) {
      for (const x of d.sessions) planned[x.sid] = (planned[x.sid] || 0) + x.min;
    }
    if (locked) for (const x of todaySessions) if (!x.done) planned[x.sid] = (planned[x.sid] || 0) + x.min;

    const stats = {};
    let totalShortage = 0;
    for (const subj of subjects) {
      const examN = dayNum(subj.examDate);
      const prog = buildState(subj, actualBy[subj.id] || []);
      const required = prog.req.total;
      const done = Math.min(required, prog.done);
      const passed = examN < todayN;
      const isToday = examN === todayN;
      const shortage = passed || isToday ? 0 : sim.leftover[subj.id] || 0;
      totalShortage += shortage;
      const load = loadBy[subj.id] || 0;
      let status = 'ok';
      if (passed) status = 'passed';
      else if (isToday) status = 'exam';
      else if (required - done <= 0) status = 'done';
      else if (shortage > 0) status = 'short';
      else if (load >= 0.85) status = 'tight';
      const fs = stateBy[subj.id];
      stats[subj.id] = {
        required,
        done,
        remaining: Math.max(0, required - done),
        planned: planned[subj.id] || 0,
        shortage,
        load,
        status,
        examN,
        daysLeft: examN - todayN,
        units: prog.req.units.length,
        queueDoneDay: fs && fs.queueDoneDay != null && fs.queueDoneDay !== -Infinity ? dayStr(fs.queueDoneDay) : null,
      };
    }

    return {
      today: { date: today, locked, cap: capacityOf(todayN, st), sessions: todaySessions },
      days: futureDays,
      stats,
      totalShortage,
    };
  }

  /** 今日の未完了分だけを作り直す（完了したコマは残す） */
  function replanToday(input) {
    const { st, todayN, subjects, days } = prepare(input);
    const today = input.today;
    const ids = new Set(subjects.map((s) => s.id));
    const todayDoc = days[today];
    const kept = todayDoc && Array.isArray(todayDoc.sessions) ? todayDoc.sessions.filter((x) => x && x.done && ids.has(x.sid)) : [];
    const { actual } = collectLogs(subjects, days, today, false);
    const by = groupBySubject(actual);
    const live = subjects.filter((s) => dayNum(s.examDate) > todayN);
    if (!live.length) return { kept, fresh: [] };
    const states = live.map((s) => buildState(s, by[s.id] || []));
    const used = sum(kept.map((x) => Number(x.min) || 0));
    const sim = simulate(states, st, todayN, { todayUsed: used, onlyFirstDay: true });
    return { kept, fresh: sim.days[0] ? sim.days[0].sessions : [] };
  }

  /** 「もう1コマ」：今日の予定をすべて終えた前提で、次にやるべきコマを1つ返す */
  function nextExtraSession(input) {
    const { st, todayN, subjects, days } = prepare(input);
    const today = input.today;
    const { actual, assumed } = collectLogs(subjects, days, today, true);
    const by = groupBySubject(actual.concat(assumed));
    const live = subjects.filter((s) => dayNum(s.examDate) > todayN);
    if (!live.length) return null;
    const states = live.map((s) => buildState(s, by[s.id] || []));
    const sim = simulate(states, st, todayN, { forceCap: st.sessionMin, onlyFirstDay: true });
    return sim.days[0] && sim.days[0].sessions[0] ? sim.days[0].sessions[0] : null;
  }

  /** 足りないとき、毎日あと何分増やせば間に合うかを探す */
  function suggestBoost(input) {
    const st = normSettings(input.settings);
    for (const add of [15, 30, 45, 60, 90, 120]) {
      const p = computePlan(
        Object.assign({}, input, {
          settings: Object.assign({}, st, { weekdayMin: st.weekdayMin + add, weekendMin: st.weekendMin + add }),
        })
      );
      if (!p.totalShortage) return { add };
    }
    return { add: null };
  }

  const api = {
    LEVELS,
    VOLUMES,
    VOLUME_LABELS,
    PHASES,
    FINAL_WINDOW,
    PAGES_PER_UNIT,
    unitPages,
    unitWeight,
    dayNum,
    dayStr,
    weekday,
    fmtMin,
    normSettings,
    capacityOf,
    subjectRequirement,
    computePlan,
    replanToday,
    nextExtraSession,
    suggestBoost,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PlannerEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
