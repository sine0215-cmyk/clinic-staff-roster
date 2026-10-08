/**
 * 排班引擎：A–E 班、AB/BC 優先、AC 備援、四週變形工時
 * 瀏覽器：window.RosterEngine；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RosterEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const DOW_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

  // ---------- 日期 ----------
  function parseYMD(ymd) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fmtYMD(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(ymd, n) { return fmtYMD(parseYMD(ymd) + n * DAY_MS); }
  function diffDays(a, b) { return Math.round((parseYMD(b) - parseYMD(a)) / DAY_MS); }
  function dow(ymd) { return new Date(parseYMD(ymd)).getUTCDay(); }
  function periodDates(start) { return Array.from({ length: 28 }, (_, i) => addDays(start, i)); }
  function alignPeriod(anchor, ymd) { return addDays(anchor, Math.floor(diffDays(anchor, ymd) / 28) * 28); }
  function periodIndex(anchor, start) { return Math.floor(diffDays(anchor, start) / 28); }
  function todayYMD() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  function mod(a, n) { return ((a % n) + n) % n; }

  // ---------- 時段 ----------
  function toMin(hhmm) {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function shiftHours(s) { return Math.max(0, toMin(s.end) - toMin(s.start)) / 60; }
  /** 班別可依組別另訂時間：shift.groupTimes = { counter: { start, end } }；未設定者用 shift.start/end */
  function shiftTime(s, group) {
    const o = group && s.groupTimes && s.groupTimes[group];
    return o && o.start && o.end ? o : s;
  }
  function effShift(s, group) {
    const t = shiftTime(s, group);
    return t === s ? s : Object.assign({}, s, { start: t.start, end: t.end });
  }
  function shiftMap(state, group) {
    const m = {};
    state.shifts.forEach((s) => { m[s.code] = effShift(s, group); });
    return m;
  }
  function dayShifts(state, ymd, group) {
    const d = dow(ymd);
    if (d === state.settings.restDow) return [];
    return state.shifts
      .filter((s) => (s.days || []).includes(d))
      .map((s) => effShift(s, group))
      .sort((a, b) => toMin(a.start) - toMin(b.start));
  }
  function stationGroup(state, sid) {
    const st = state.stations.find((x) => x.id === sid);
    return st ? st.group : null;
  }
  /** 正職依本身組別計時；兼職依當節所支援崗位的組別計時 */
  function timeGroup(state, personGroup, post) {
    if (personGroup !== 'part') return personGroup;
    return (post && stationGroup(state, post.station)) || null;
  }
  function entryShiftMap(state, entry, personGroup) {
    const sm = {};
    workCodes(entry).forEach((c) => {
      const s = state.shifts.find((x) => x.code === c);
      if (s) sm[c] = effShift(s, timeGroup(state, personGroup, entry.posts && entry.posts[c]));
    });
    return sm;
  }
  function entrySpan(state, entry, personGroup) {
    const codes = workCodes(entry);
    return codes.length ? spanOf(entryShiftMap(state, entry, personGroup), codes) : null;
  }
  function gapBetween(a, b) { return a && b ? 1440 - a.end + b.start : Infinity; }
  function workCodes(entry) {
    return entry && entry.kind === 'work' && Array.isArray(entry.shifts) ? entry.shifts : [];
  }
  function spanOf(sm, codes) {
    let start = Infinity, end = -Infinity, hours = 0, n = 0;
    (codes || []).forEach((c) => {
      const s = sm[c];
      if (!s) return;
      n++;
      start = Math.min(start, toMin(s.start));
      end = Math.max(end, toMin(s.end));
      hours += shiftHours(s);
    });
    return n ? { start, end, hours } : null;
  }
  function restGapMin(sm, prevCodes, curCodes) {
    const a = spanOf(sm, prevCodes), b = spanOf(sm, curCodes);
    if (!a || !b) return Infinity;
    return 1440 - a.end + b.start;
  }
  function overlaps(sm, codes) {
    const list = codes.map((c) => sm[c]).filter(Boolean).sort((a, b) => toMin(a.start) - toMin(b.start));
    for (let i = 1; i < list.length; i++) if (toMin(list[i].start) < toMin(list[i - 1].end)) return true;
    return false;
  }
  function makeCombo(list, adjacent) {
    return {
      codes: list.map((s) => s.code),
      size: list.length,
      adjacent,
      hours: list.reduce((h, s) => h + shiftHours(s), 0),
      start: toMin(list[0].start),
      end: toMin(list[list.length - 1].end),
    };
  }
  /** 當日可用組合：單節，以及不重疊且日工時 ≤ 上限的兩節（相鄰＝AB/BC，跨節＝AC） */
  function combosFor(state, shifts) {
    const set = state.settings, out = [];
    shifts.forEach((s) => out.push(makeCombo([s], true)));
    if ((set.maxSessionsPerDay || 2) >= 2) {
      for (let i = 0; i < shifts.length; i++) {
        for (let j = i + 1; j < shifts.length; j++) {
          const a = shifts[i], b = shifts[j];
          if (toMin(b.start) < toMin(a.end)) continue;
          const c = makeCombo([a, b], j === i + 1);
          if (c.hours <= set.maxDailyHours + 1e-9) out.push(c);
        }
      }
    }
    return out;
  }
  function earliestStart(state) {
    const mins = [];
    state.shifts.forEach((s) => {
      mins.push(toMin(s.start));
      Object.values(s.groupTimes || {}).forEach((t) => { if (t && t.start) mins.push(toMin(t.start)); });
    });
    return mins.length ? Math.min.apply(null, mins) : 480;
  }
  /** 下班時間晚於此值者，隔日最早班別無法滿 11 小時（例：C 班 21:30 → 隔日 08:00 僅 10.5 小時） */
  function lateThreshold(state) {
    return 1440 + earliestStart(state) - state.settings.minRestHours * 60;
  }
  function isLateCodes(state, codes, sm) {
    const sp = spanOf(sm || shiftMap(state), codes);
    return !!sp && sp.end > lateThreshold(state);
  }
  function isLateEntry(state, entry, personGroup) {
    const sp = entrySpan(state, entry, personGroup);
    return !!sp && sp.end > lateThreshold(state);
  }
  function comboKind(state, ymd, codes) {
    if (!codes || codes.length < 2) return 'single';
    const list = dayShifts(state, ymd).map((s) => s.code);
    const i = list.indexOf(codes[0]), j = list.indexOf(codes[codes.length - 1]);
    return i >= 0 && j >= 0 && Math.abs(j - i) === 1 ? 'adj' : 'gap';
  }
  function weekendDow(state) { return mod(state.settings.restDow - 1, 7); }

  // ---------- 需求 ----------
  function stationById(state, id) { return state.stations.find((x) => x.id === id); }
  /** 有匯入逐日需求（state.dateDemand[ymd]）的日子以逐日為準，未列出的崗位視為 0；其餘日子用各班別預設需求 */
  function demandOf(state, code, stationId, ymd) {
    const day = ymd && state.dateDemand && state.dateDemand[ymd];
    if (day) {
      const q = day[code] && day[code][stationId];
      const min = q ? Number(q.min) || 0 : 0;
      return { min, max: Math.max(min, q ? Number(q.max) || 0 : 0) };
    }
    const st = stationById(state, stationId) || { min: 0, max: 0 };
    const d = state.demand && state.demand[code] && state.demand[code][stationId];
    const min = d ? Number(d.min) || 0 : st.min;
    const max = Math.max(min, d ? Number(d.max) || 0 : st.max);
    return { min, max };
  }
  function groupDemand(state, group, code, ymd) {
    let min = 0, max = 0;
    state.stations.filter((x) => x.group === group).forEach((x) => {
      const q = demandOf(state, code, x.id, ymd);
      min += q.min;
      max += q.max;
    });
    return { min, max };
  }
  /** 指定班（state.locks[ymd][pid]）：排班時直接採用，不再調整 */
  function lockOf(state, ymd, pid) {
    const day = state.locks && state.locks[ymd];
    return (day && day[pid]) || null;
  }
  /** 預假（state.requests[ymd][pid]）：{ off: true } 全日休；{ block: ['B'] } 該節不排 */
  function requestOf(state, ymd, pid) {
    const day = state.requests && state.requests[ymd];
    return (day && day[pid]) || null;
  }
  function blockedCodes(state, ymd, pid) {
    const r = requestOf(state, ymd, pid);
    return r && Array.isArray(r.block) ? r.block : [];
  }
  function activeStaff(state, group) {
    return state.staff.filter((p) => p.active !== false && (!group || p.group === group));
  }
  function availOk(p, code) { return !Array.isArray(p.avail) || p.avail.includes(code); }
  function skillsOf(state, p) {
    if (Array.isArray(p.skills) && p.skills.length) return p.skills;
    const g = p.group === 'part' ? null : p.group;
    return state.stations.filter((x) => !g || x.group === g).map((x) => x.id);
  }

  // ---------- 主流程 ----------
  function generate(state, start) {
    const ctx = buildCtx(state, start);
    initPartTime(ctx);
    scheduleFullTime(ctx, 'counter');
    scheduleFullTime(ctx, 'nurse');
    allocateStations(ctx, 'counter');
    allocateStations(ctx, 'nurse');
    schedulePartTime(ctx);
    assignSeats(ctx);
    return ctx.sched;
  }

  function buildCtx(state, start) {
    const dates = periodDates(start);
    const sm = { counter: shiftMap(state, 'counter'), nurse: shiftMap(state, 'nurse'), part: shiftMap(state) };
    const shiftsByDate = {}, combosByDate = { counter: {}, nurse: {} };
    dates.forEach((d) => {
      shiftsByDate[d] = dayShifts(state, d);
      ['counter', 'nurse'].forEach((g) => { combosByDate[g][d] = combosFor(state, dayShifts(state, d, g)); });
    });
    const anchor = state.settings.periodAnchor || start;
    return {
      state,
      set: state.settings,
      start,
      dates,
      sm,
      shiftsByDate,
      combosByDate,
      allowGap: state.settings.allowGapPair !== false,
      late: lateThreshold(state),
      seed: mod(periodIndex(anchor, start), 1000),
      sched: {},
      stats: {},
      trap: {},
      singleAllow: {},
      maxLate: {},
    };
  }

  function newStats(idx) {
    return { idx, hours: 0, late: 0, gapPair: 0, satOff: 0, offDow: {}, stations: {}, sessions: 0, singles: 0 };
  }
  function isWorkday(ctx, d) { return dow(d) !== ctx.set.restDow && ctx.shiftsByDate[d].length > 0; }
  function maxPerDay(ctx) { return Math.max(1, Math.min(2, ctx.set.maxSessionsPerDay || 2)); }

  // ---------- 正職：例假／休息日 ----------
  function scheduleFullTime(ctx, group) {
    const { set, dates, state } = ctx;
    const all = activeStaff(state, group);
    if (!all.length) return;
    all.forEach((p, idx) => { ctx.sched[p.id] = {}; ctx.stats[p.id] = newStats(idx); });

    let autoOff = 0;
    dates.forEach((d) => {
      if (dow(d) === set.restDow) all.forEach((p) => { ctx.sched[p.id][d] = { kind: '例' }; });
      else if (!ctx.shiftsByDate[d].length) {
        autoOff++;
        all.forEach((p) => { ctx.sched[p.id][d] = { kind: '休' }; });
      }
    });
    all.forEach((p) => dates.forEach((d) => {
      const lk = lockOf(state, d, p.id);
      if (lk && !ctx.sched[p.id][d]) applyLock(ctx, p, d, lk, group);
    }));
    all.filter((p) => p.fixed).forEach((p) => dates.forEach((d) => {
      if (!ctx.sched[p.id][d]) ctx.sched[p.id][d] = { kind: '休' };
    }));
    const staff = all.filter((p) => !p.fixed);
    staff.forEach((p, idx) => { ctx.stats[p.id].idx = idx; });
    staff.forEach((p) => dates.forEach((d) => {
      const r = requestOf(state, d, p.id);
      if (r && r.off && !ctx.sched[p.id][d] && isWorkday(ctx, d)) ctx.sched[p.id][d] = { kind: '休', req: true, note: r.note || '' };
    }));
    if (!staff.length) return;

    const need = Math.max(0, (set.restDaysPer4w == null ? 4 : set.restDaysPer4w) - autoOff);
    const base = Math.floor(need / 4), extra = need % 4;
    markTraps(ctx, group);
    ctx.singleAllow[group] = singleAllowance(ctx, group, staff.length, dates.filter((d) => isWorkday(ctx, d)).length - need);
    for (let w = 0; w < 4; w++) {
      const quota = base + (mod(w + ctx.seed, 4) < extra ? 1 : 0);
      const days = dates.slice(w * 7, w * 7 + 7).filter((d) => isWorkday(ctx, d));
      if (quota > 0 && days.length) placeWeeklyOffs(ctx, group, staff, days, quota, w + ctx.seed * 3);
    }
    dates.forEach((d, i) => { if (isWorkday(ctx, d)) assignDay(ctx, group, staff, d, i); });
  }

  function applyLock(ctx, p, d, lk, group) {
    if (lk.kind !== 'work') {
      ctx.sched[p.id][d] = { kind: lk.kind === '例' ? '例' : '休', locked: true, note: lk.note || '' };
      return;
    }
    const valid = ctx.shiftsByDate[d].map((s) => s.code);
    const codes = sortCodes(ctx, (lk.shifts || []).filter((c) => valid.includes(c)));
    if (!codes.length) return;
    const posts = {};
    codes.forEach((c) => { posts[c] = Object.assign({}, lk.posts && lk.posts[c]); });
    const e = { kind: 'work', shifts: codes, posts, group, locked: true };
    ctx.sched[p.id][d] = e;
    const s = ctx.stats[p.id], sp = entrySpan(ctx.state, e, p.group);
    if (sp) {
      s.hours += sp.hours;
      if (sp.end > ctx.late) s.late++;
    }
    s.sessions += codes.length;
    if (codes.length === 2 && comboKind(ctx.state, d, codes) === 'gap') s.gapPair++;
    codes.forEach((c) => {
      const sid = posts[c].station;
      if (sid) s.stations[sid] = (s.stations[sid] || 0) + 1;
    });
  }
  /** 已指定（locked）且崗位屬於該組的節數 */
  function lockedOn(ctx, group, d, code) {
    let n = 0;
    Object.keys(ctx.sched).forEach((pid) => {
      const e = ctx.sched[pid][d];
      if (!e || !e.locked) return;
      workCodes(e).forEach((c) => {
        if (code && c !== code) return;
        const post = e.posts && e.posts[c];
        if (post && stationGroup(ctx.state, post.station) === group) n++;
      });
    });
    return n;
  }
  function groupMinSessions(ctx, group, d) {
    return ctx.shiftsByDate[d].reduce((sum, s) => sum + Math.max(0, groupDemand(ctx.state, group, s.code, d).min - lockedOn(ctx, group, d, s.code)), 0);
  }

  // ---------- 單節陷阱：前一日晚班後，當日無法排兩節（例：週五 C → 週六只能 E） ----------
  function latestEnd(ctx, group) {
    let end = -Infinity;
    Object.values(ctx.sm[group]).forEach((s) => { end = Math.max(end, toMin(s.end)); });
    return end;
  }
  function markTraps(ctx, group) {
    const earliest = latestEnd(ctx, group) + ctx.set.minRestHours * 60 - 1440;
    ctx.trap[group] = {};
    ctx.dates.forEach((d) => {
      if (!isWorkday(ctx, d)) return;
      const pairs = ctx.combosByDate[group][d].filter((c) => c.size === 2 && (ctx.allowGap || c.adjacent));
      ctx.trap[group][d] = pairs.length > 0 && !pairs.some((c) => c.start >= earliest);
    });
  }
  function lateMinOn(ctx, group, d) {
    return ctx.shiftsByDate[d]
      .filter((s) => toMin(ctx.sm[group][s.code].end) > ctx.late)
      .reduce((sum, s) => sum + Math.max(0, groupDemand(ctx.state, group, s.code, d).min - lockedOn(ctx, group, d, s.code)), 0);
  }
  /**
   * 每人四週可承受幾次「單節日」而工時仍達目標：
   * 預估 = 上班日 × 最長兩節時數 − 平均晚班日 × 晚班組合少掉的時數；每次單節再少（兩節 − 單節）時數
   */
  function singleAllowance(ctx, group, n, ftDays) {
    const set = ctx.set;
    if (set.protectHours === false || !set.hoursTarget || !n) return Infinity;
    let pairH = 0, latePairH = 0, singleH = Infinity, lateTotal = 0;
    ctx.dates.forEach((d) => {
      if (!isWorkday(ctx, d)) return;
      ctx.combosByDate[group][d].forEach((c) => {
        if (c.size === 2) {
          pairH = Math.max(pairH, c.hours);
          if (c.end > ctx.late) latePairH = Math.max(latePairH, c.hours);
        } else if (ctx.trap[group][d]) singleH = Math.min(singleH, c.hours);
      });
      lateTotal += lateMinOn(ctx, group, d);
    });
    const lateLoss = pairH - (latePairH || pairH);
    ctx.maxLate[group] = lateLoss > 0 ? Math.floor((ftDays * pairH - set.hoursTarget) / lateLoss) : Infinity;
    if (!pairH || singleH === Infinity) return Infinity;
    const est = ftDays * pairH - (lateTotal / n) * lateLoss;
    const loss = pairH - singleH;
    return loss > 0 ? Math.max(0, Math.floor((est - set.hoursTarget) / loss)) : Infinity;
  }
  /** 第 i 天起排晚班，到下一個休假日前（晚班需連續）共幾天 */
  function chainLength(ctx, p, i) {
    let n = 0;
    for (let j = i; j < ctx.dates.length; j++) {
      const d = ctx.dates[j];
      if ((j > i && ctx.sched[p.id][d]) || !isWorkday(ctx, d)) break;
      n++;
    }
    return n;
  }
  /** 從第 i 天開始晚班，在遇到單節陷阱日之前是否會先遇到休假（晚班鏈中斷） */
  function lateChainSafe(ctx, group, p, i) {
    for (let j = i + 1; j < ctx.dates.length; j++) {
      const d = ctx.dates[j];
      if (ctx.sched[p.id][d] || !isWorkday(ctx, d)) return true;
      if (ctx.trap[group][d]) return false;
    }
    return true;
  }

  /** 每週休息日：先排在人力有餘裕的日子（如週六），其餘平均分散並輪替 */
  function placeWeeklyOffs(ctx, group, staff, days, quota, seed) {
    const n = staff.length, per = maxPerDay(ctx);
    const offCount = {}, ideal = {};
    days.forEach((d) => {
      offCount[d] = 0;
      ideal[d] = Math.min(n, Math.ceil(groupMinSessions(ctx, group, d) / per));
      const di = ctx.dates.indexOf(d);
      const allow = ctx.singleAllow[group];
      if (ctx.trap[group][d] && di > 0 && allow !== Infinity && isWorkday(ctx, ctx.dates[di - 1])) {
        const offTarget = Math.min(n - 1, lateMinOn(ctx, group, ctx.dates[di - 1]) - Math.floor((allow * n) / 4));
        if (offTarget > n - ideal[d]) ideal[d] = n - offTarget;
      }
    });
    const isOff = (p, d) => { const e = ctx.sched[p.id][d]; return !!e && e.kind !== 'work'; };
    const weekOffs = {}, planned = {};
    staff.forEach((p) => { weekOffs[p.id] = days.filter((d) => isOff(p, d)).length; });
    days.forEach((d) => { offCount[d] = staff.filter((p) => isOff(p, d)).length; planned[d] = 0; });
    const total = staff.reduce((sum, p) => sum + Math.max(0, Math.min(quota, days.length) - weekOffs[p.id]), 0);
    for (let k = 0; k < total; k++) {
      let best = null, bestKey = null;
      days.forEach((d, j) => {
        if (offCount[d] >= n) return;
        const key = [n - ideal[d] - offCount[d], -offCount[d], -mod(j - seed, days.length)];
        if (!best || cmpKey(key, bestKey) > 0) { best = d; bestKey = key; }
      });
      if (!best) break;
      offCount[best]++;
      planned[best]++;
    }

    const wd = weekendDow(ctx.state);
    const order = days.slice().sort((a, b) => (dow(b) === wd) - (dow(a) === wd));
    const rot = (p) => mod(ctx.stats[p.id].idx - seed, n);
    order.forEach((d) => {
      for (let c = 0; c < planned[d]; c++) {
        const cand = staff.filter((p) => weekOffs[p.id] < quota && !ctx.sched[p.id][d]);
        if (!cand.length) break;
        const dw = dow(d);
        const used = (p) => (dw === wd ? ctx.stats[p.id].satOff : ctx.stats[p.id].offDow[dw] || 0);
        cand.sort((a, b) => used(a) - used(b) || rot(a) - rot(b));
        markOff(ctx, cand[0], d, wd);
        weekOffs[cand[0].id]++;
      }
    });
    staff.forEach((p) => {
      while (weekOffs[p.id] < quota) {
        const free = days.filter((d) => !ctx.sched[p.id][d]);
        if (!free.length) break;
        free.sort((a, b) => offCount[a] - offCount[b]);
        markOff(ctx, p, free[0], wd);
        offCount[free[0]]++;
        weekOffs[p.id]++;
      }
    });
  }

  function markOff(ctx, p, d, wd) {
    ctx.sched[p.id][d] = { kind: '休' };
    const s = ctx.stats[p.id], dw = dow(d);
    if (dw === wd) s.satOff++;
    s.offDow[dw] = (s.offDow[dw] || 0) + 1;
  }

  function cmpKey(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
  }

  // ---------- 正職：每日班別組合 ----------
  function comboScore(c, cnt, minG, maxG) {
    let gain = 0, over = 0, deficit = 0;
    c.codes.forEach((code) => {
      if (cnt[code] < minG[code]) gain++;
      if (cnt[code] >= maxG[code]) over++;
      deficit += minG[code] - cnt[code];
    });
    return gain * 1000 - over * 300 + (c.adjacent ? 60 : 0) + deficit * 3 + c.size * 5;
  }
  function pickCombo(list, cnt, minG, maxG) {
    let best = null, bestScore = -Infinity;
    list.forEach((c) => {
      const v = comboScore(c, cnt, minG, maxG);
      if (v > bestScore) { bestScore = v; best = c; }
    });
    return best;
  }
  function addCnt(cnt, c) { c.codes.forEach((code) => { cnt[code] = (cnt[code] || 0) + 1; }); }

  function assignDay(ctx, group, staff, d, i) {
    const set = ctx.set;
    const shifts = ctx.shiftsByDate[d];
    const combos = ctx.combosByDate[group][d];
    const sm = ctx.sm[group];
    const pairs = combos.filter((c) => c.size === 2 && (ctx.allowGap || c.adjacent));
    const base = pairs.length ? pairs : combos.filter((c) => c.size === 1);
    const minG = {}, maxG = {}, cnt = {};
    shifts.forEach((s) => {
      const q = groupDemand(ctx.state, group, s.code, d);
      minG[s.code] = q.min;
      maxG[s.code] = q.max;
      cnt[s.code] = lockedOn(ctx, group, d, s.code);
    });
    const prevD = i > 0 ? ctx.dates[i - 1] : null;
    const nextD = i < ctx.dates.length - 1 ? ctx.dates[i + 1] : null;
    const restMin = set.minRestHours * 60;

    const restricted = [], free = [];
    staff.forEach((p) => {
      if (ctx.sched[p.id][d]) return;
      const prevCodes = prevD ? workCodes(ctx.sched[p.id][prevD]) : [];
      const st = ctx.stats[p.id];
      const blocked = blockedCodes(ctx.state, d, p.id);
      const ok = (c) => restGapMin(sm, prevCodes, c.codes) >= restMin && st.hours + c.hours <= set.hoursCap + 1e-9
        && !c.codes.some((code) => blocked.includes(code));
      let allowed = base.filter(ok);
      if (!allowed.length) allowed = combos.filter((c) => c.size === 1 && ok(c));
      if (!allowed.length) { ctx.sched[p.id][d] = { kind: '休', auto: true }; return; }
      const isRestricted = allowed.length < base.length || allowed[0].size !== base[0].size;
      (isRestricted ? restricted : free).push({ p, allowed });
    });

    restricted.sort((a, b) => a.allowed.length - b.allowed.length);
    restricted.forEach((r) => {
      const c = pickCombo(r.allowed, cnt, minG, maxG);
      addCnt(cnt, c);
      place(ctx, r.p, d, c, group);
    });

    const lateCap = free.filter((f) => ctx.stats[f.p.id].singles < ctx.singleAllow[group] || lateChainSafe(ctx, group, f.p, i)).length;
    const early = base.filter((c) => c.end <= ctx.late);
    let lateChosen = 0;
    const chosen = [];
    free.forEach(() => {
      const c = pickCombo(lateChosen >= lateCap && early.length ? early : base, cnt, minG, maxG);
      if (c.end > ctx.late) lateChosen++;
      chosen.push(c);
      addCnt(cnt, c);
    });
    const persons = free.map((f) => f.p);
    while (chosen.length) {
      let pick = null;
      chosen.forEach((c, ci) => {
        let b1 = Infinity, b2 = Infinity, bj = 0;
        persons.forEach((p, pj) => {
          const v = assignCost(ctx, p, c, nextD, i, sm, group);
          if (v < b1) { b2 = b1; b1 = v; bj = pj; } else if (v < b2) b2 = v;
        });
        const regret = (b2 === Infinity ? b1 : b2 - b1) + (c.end > ctx.late ? 0.5 : 0);
        if (!pick || regret > pick.regret) pick = { regret, ci, bj };
      });
      place(ctx, persons[pick.bj], d, chosen[pick.ci], group);
      chosen.splice(pick.ci, 1);
      persons.splice(pick.bj, 1);
    }
  }

  /** 晚班盡量給隔日休假者，並讓 C 班、AC 班次數平均 */
  function assignCost(ctx, p, c, nextD, dayIdx, sm, group) {
    const s = ctx.stats[p.id];
    let v = 0;
    if (c.end > ctx.late) {
      const nextWorks = nextD && !ctx.sched[p.id][nextD] && isWorkday(ctx, nextD);
      const limit = c.end + ctx.set.minRestHours * 60 - 1440;
      if (nextWorks && ctx.shiftsByDate[nextD].some((sh) => toMin(sm[sh.code].start) < limit)) v += 6;
      if (s.singles >= ctx.singleAllow[group] && !lateChainSafe(ctx, group, p, dayIdx)) v += 60;
      const projected = s.late + chainLength(ctx, p, dayIdx);
      if (projected > ctx.maxLate[group]) v += 40;
      v += projected * 3;
    } else {
      v += Math.max(0, 8 - s.late) * 0.2;
    }
    if (c.size === 2 && !c.adjacent) v += 2 + s.gapPair * 4;
    v += mod(s.idx + dayIdx, 97) * 0.001;
    return v;
  }

  function place(ctx, p, d, c, group) {
    ctx.sched[p.id][d] = { kind: 'work', shifts: c.codes.slice(), posts: {}, group };
    const s = ctx.stats[p.id];
    s.hours += c.hours;
    s.sessions += c.size;
    if (c.end > ctx.late) s.late++;
    if (c.size === 2 && !c.adjacent) s.gapPair++;
    if (c.size === 1 && ctx.combosByDate[group][d].some((x) => x.size === 2)) s.singles++;
  }

  // ---------- 崗位分配（輪調平衡） ----------
  function allocateStations(ctx, group) {
    const state = ctx.state;
    const stations = state.stations.filter((x) => x.group === group);
    const staff = activeStaff(state, group).filter((p) => !p.fixed);
    if (!stations.length || !staff.length) return;
    const pts = activeStaff(state, 'part').filter((p) => !p.fixed);
    staff.forEach((p) => { stations.forEach((x) => { ctx.stats[p.id].stations[x.id] = ctx.stats[p.id].stations[x.id] || 0; }); });

    ctx.dates.forEach((d, di) => {
      ctx.shiftsByDate[d].forEach((s) => {
        const present = staff.filter((p) => {
          const e = ctx.sched[p.id][d];
          return workCodes(e).includes(s.code) && !e.locked;
        });
        if (!present.length) return;
        const lockedAt = {};
        Object.keys(ctx.sched).forEach((pid) => {
          const e = ctx.sched[pid][d];
          if (!e || !e.locked || !workCodes(e).includes(s.code)) return;
          const sid = e.posts[s.code] && e.posts[s.code].station;
          if (sid) lockedAt[sid] = (lockedAt[sid] || 0) + 1;
        });
        const dem = stations.map((x, k) => {
          const q = demandOf(state, s.code, x.id, d);
          const have = lockedAt[x.id] || 0;
          const cover = pts.filter((pt) => skillsOf(state, pt).includes(x.id) && availOk(pt, s.code)).length;
          return { id: x.id, min: Math.max(0, q.min - have), max: Math.max(0, q.max - have), n: 0, cover, k };
        });
        const order = dem.slice().sort((a, b) => a.cover - b.cover || a.k - b.k);
        let left = present.length;
        order.forEach((x) => { const k = Math.min(x.min, left); x.n = k; left -= k; });
        while (left > 0) {
          const cand = order.filter((x) => x.n < x.max);
          if (!cand.length) break;
          cand.sort((a, b) => (b.max - b.n) - (a.max - a.n) || a.cover - b.cover || a.k - b.k);
          cand[0].n++;
          left--;
        }
        const slots = [];
        order.forEach((x) => { for (let k = 0; k < x.n; k++) slots.push(x.id); });
        const mean = {};
        stations.forEach((x) => {
          mean[x.id] = staff.reduce((sum, p) => sum + ctx.stats[p.id].stations[x.id], 0) / staff.length;
        });

        const pool = present.slice(), result = {};
        while (slots.length && pool.length) {
          let best = null;
          slots.forEach((sid, si) => pool.forEach((p, pi) => {
            if (!skillsOf(state, p).includes(sid)) return;
            const v = ctx.stats[p.id].stations[sid] - mean[sid] + mod(ctx.stats[p.id].idx + di + si, 13) * 0.0001;
            if (!best || v < best.v) best = { v, si, pi };
          }));
          if (!best) break;
          const p = pool[best.pi], sid = slots[best.si];
          result[p.id] = sid;
          ctx.stats[p.id].stations[sid]++;
          slots.splice(best.si, 1);
          pool.splice(best.pi, 1);
        }
        pool.forEach((p) => {
          const used = (id) => Object.values(result).filter((v) => v === id).length;
          const opt = dem.find((x) => skillsOf(state, p).includes(x.id) && used(x.id) < x.max);
          result[p.id] = opt ? opt.id : 'float';
          if (opt) ctx.stats[p.id].stations[opt.id]++;
        });
        present.forEach((p) => { ctx.sched[p.id][d].posts[s.code] = { station: result[p.id] }; });
      });
    });
  }

  function countAt(ctx, d, code, stationId) {
    let n = 0;
    Object.keys(ctx.sched).forEach((pid) => {
      const e = ctx.sched[pid][d];
      if (!workCodes(e).includes(code)) return;
      const post = e.posts && e.posts[code];
      if (post && post.station === stationId) n++;
    });
    return n;
  }

  // ---------- 兼職：補足缺額（檢驗、跟診優先） ----------
  const PT_PRIORITY = { lab: 6, clinic: 5, counter: 4, endo: 2 };

  /** 兼職先建表並放入指定班，讓正職排班時已知這些崗位有人 */
  function initPartTime(ctx) {
    activeStaff(ctx.state, 'part').forEach((p, idx) => {
      ctx.sched[p.id] = {};
      ctx.stats[p.id] = newStats(idx);
      ctx.dates.forEach((d) => {
        const lk = lockOf(ctx.state, d, p.id);
        if (lk && isWorkday(ctx, d)) applyLock(ctx, p, d, lk, 'part');
      });
    });
  }

  function schedulePartTime(ctx) {
    const state = ctx.state;
    const pts = activeStaff(state, 'part').filter((p) => !p.fixed);
    if (!pts.length) return;

    for (let w = 0; w < 4; w++) {
      const days = ctx.dates.slice(w * 7, w * 7 + 7).filter((d) => isWorkday(ctx, d));
      const used = {};
      pts.forEach((p) => { used[p.id] = days.reduce((n, d) => n + workCodes(ctx.sched[p.id][d]).length, 0); });
      for (;;) {
        let best = null;
        days.forEach((d) => {
          const di = ctx.dates.indexOf(d);
          ctx.shiftsByDate[d].forEach((s) => {
            state.stations.forEach((x) => {
              const q = demandOf(state, s.code, x.id, d);
              const have = countAt(ctx, d, s.code, x.id);
              const gapMin = q.min - have, gapMax = q.max - have;
              if (gapMax <= 0) return;
              const prio = PT_PRIORITY[x.id] || 3;
              const val = gapMin > 0 ? 1000 + gapMin * 30 + prio : 100 + prio - have;
              pts.forEach((p) => {
                const quota = Number(p.weeklySlots) || 0;
                if (used[p.id] >= quota) return;
                if (!skillsOf(state, p).includes(x.id) || !availOk(p, s.code)) return;
                if (!canAdd(ctx, p, d, di, s.code, x.id)) return;
                const existing = workCodes(ctx.sched[p.id][d]);
                let bonus = 0;
                if (existing.length) bonus = comboKind(state, d, sortCodes(ctx, existing.concat([s.code]))) === 'adj' ? 4 : -2;
                const score = val + (quota - used[p.id]) * 3 - ctx.stats[p.id].sessions * 0.5 + bonus + mod(ctx.stats[p.id].idx + di, 7) * 0.01;
                if (!best || score > best.score) best = { score, p, d, code: s.code, station: x.id };
              });
            });
          });
        });
        if (!best) break;
        addPart(ctx, best.p, best.d, best.code, best.station);
        used[best.p.id]++;
      }
    }
  }

  function sortCodes(ctx, codes) {
    return codes.slice().sort((a, b) => toMin(ctx.sm.part[a].start) - toMin(ctx.sm.part[b].start));
  }
  function ptHours(ctx, code, station) {
    return shiftHours(effShift(ctx.sm.part[code], stationGroup(ctx.state, station)));
  }

  function canAdd(ctx, p, d, di, code, station) {
    const set = ctx.set, state = ctx.state;
    const cur = ctx.sched[p.id][d];
    const codes = workCodes(cur);
    if (codes.includes(code) || codes.length >= maxPerDay(ctx)) return false;
    if (cur && cur.locked) return false;
    const req = requestOf(state, d, p.id);
    if (req && (req.off || (req.block || []).includes(code))) return false;
    const posts = Object.assign({}, cur && cur.posts, { [code]: { station } });
    const next = { kind: 'work', shifts: sortCodes(ctx, codes.concat([code])), posts };
    if (overlaps(entryShiftMap(state, next, 'part'), next.shifts)) return false;
    const span = entrySpan(state, next, 'part');
    if (span.hours > set.maxDailyHours + 1e-9) return false;
    const restMin = set.minRestHours * 60;
    const prev = di > 0 ? entrySpan(state, ctx.sched[p.id][ctx.dates[di - 1]], 'part') : null;
    const after = di < ctx.dates.length - 1 ? entrySpan(state, ctx.sched[p.id][ctx.dates[di + 1]], 'part') : null;
    if (gapBetween(prev, span) < restMin || gapBetween(span, after) < restMin) return false;
    if (!codes.length) {
      let run = 1;
      for (let k = di - 1; k >= 0 && workCodes(ctx.sched[p.id][ctx.dates[k]]).length; k--) run++;
      for (let k = di + 1; k < ctx.dates.length && workCodes(ctx.sched[p.id][ctx.dates[k]]).length; k++) run++;
      if (run > set.maxConsecutive) return false;
    }
    if (ctx.stats[p.id].hours + ptHours(ctx, code, station) > set.hoursCap + 1e-9) return false;
    return true;
  }

  function addPart(ctx, p, d, code, station) {
    const e = ctx.sched[p.id][d] || { kind: 'work', shifts: [], posts: {}, group: 'part' };
    e.shifts = sortCodes(ctx, e.shifts.concat([code]));
    e.posts[code] = { station };
    ctx.sched[p.id][d] = e;
    const s = ctx.stats[p.id];
    s.hours += ptHours(ctx, code, station);
    s.sessions++;
    s.stations[station] = (s.stations[station] || 0) + 1;
  }

  // ---------- 櫃檯座位編號 ----------
  function assignSeats(ctx) {
    const state = ctx.state;
    const seatStations = state.stations.filter((x) => x.seats);
    ctx.dates.forEach((d, di) => {
      ctx.shiftsByDate[d].forEach((s) => {
        seatStations.forEach((x) => {
          const q = demandOf(state, s.code, x.id, d);
          const people = activeStaff(state).filter((p) => {
            const e = ctx.sched[p.id] && ctx.sched[p.id][d];
            return workCodes(e).includes(s.code) && e.posts[s.code] && e.posts[s.code].station === x.id;
          });
          const locked = people.filter((p) => ctx.sched[p.id][d].locked).length;
          const free = people.filter((p) => !ctx.sched[p.id][d].locked);
          const ft = free.filter((p) => p.group !== 'part');
          const pt = free.filter((p) => p.group === 'part');
          const shift = ft.length ? mod(di, ft.length) : 0;
          const ordered = ft.slice(shift).concat(ft.slice(0, shift), pt);
          ordered.forEach((p, k) => { ctx.sched[p.id][d].posts[s.code].seat = k < q.max - locked ? k + 1 : 0; });
        });
      });
    });
  }

  return {
    DOW_NAMES,
    parseYMD, addDays, diffDays, dow, periodDates, alignPeriod, periodIndex, todayYMD,
    toMin, shiftHours, shiftTime, effShift, shiftMap, dayShifts, workCodes, spanOf, restGapMin, overlaps,
    stationGroup, timeGroup, entryShiftMap, entrySpan, gapBetween,
    combosFor, comboKind, isLateCodes, isLateEntry, lateThreshold, weekendDow,
    stationById, demandOf, groupDemand, lockOf, requestOf, blockedCodes, activeStaff, availOk, skillsOf,
    generate,
  };
});
