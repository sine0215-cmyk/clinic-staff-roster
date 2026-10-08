/**
 * 法規檢核、人力覆蓋、產能分析、公平度
 * 瀏覽器：window.RosterAudit；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.RosterAudit = factory(root.RosterEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function entryOf(sched, pid, d) { return (sched[pid] && sched[pid][d]) || null; }

  // ---------- 個人統計 ----------
  function personMetrics(state, sched, start, p) {
    const dates = E.periodDates(start), late = E.lateThreshold(state);
    const m = {
      id: p.id, name: p.name, group: p.group, fixed: !!p.fixed,
      hours: 0, workdays: 0, regular: 0, rest: 0, sessions: 0,
      adj: 0, gap: 0, single: 0, late: 0,
      byShift: {}, stations: {}, weekHours: [0, 0, 0, 0], weekSessions: [0, 0, 0, 0],
      quota: p.group === 'part' ? Number(p.weeklySlots) || 0 : 0,
    };
    state.shifts.forEach((s) => { m.byShift[s.code] = 0; });
    dates.forEach((d, i) => {
      const e = entryOf(sched, p.id, d);
      if (!e) return;
      if (e.kind === '例') { m.regular++; return; }
      if (e.kind === '休') { m.rest++; return; }
      const codes = E.workCodes(e);
      if (!codes.length) return;
      const sp = E.entrySpan(state, e, p.group);
      const h = sp ? sp.hours : 0;
      m.workdays++;
      m.hours += h;
      m.sessions += codes.length;
      m.weekHours[Math.floor(i / 7)] += h;
      m.weekSessions[Math.floor(i / 7)] += codes.length;
      m[E.comboKind(state, d, codes)]++;
      if (sp && sp.end > late) m.late++;
      codes.forEach((c) => {
        m.byShift[c] = (m.byShift[c] || 0) + 1;
        const post = e.posts && e.posts[c];
        const sid = post && post.station ? post.station : 'float';
        m.stations[sid] = (m.stations[sid] || 0) + 1;
      });
    });
    m.hours = Math.round(m.hours * 100) / 100;
    return m;
  }

  // ---------- 法規檢核 ----------
  function issue(level, rule, pid, date, msg) { return { level, rule, pid, date, msg }; }

  function legalChecks(state, sched, start) {
    const set = state.settings, dates = E.periodDates(start);
    const out = [];
    const restMin = set.minRestHours * 60;
    E.activeStaff(state).forEach((p) => {
      const isFT = p.group !== 'part';
      const m = personMetrics(state, sched, start, p);
      if (m.hours > set.hoursCap + 1e-9) {
        out.push(issue('error', 'hours', p.id, null, `四週正常工時 ${m.hours}h，超過上限 ${set.hoursCap}h（§30-1）`));
      } else if (isFT && m.hours < set.hoursTarget - 1e-9) {
        out.push(issue('info', 'hoursLow', p.id, null, `四週工時 ${m.hours}h，低於院內目標 ${set.hoursTarget}h`));
      }

      let run = 0, runStart = null, prevSpan = null;
      dates.forEach((d) => {
        const e = entryOf(sched, p.id, d);
        const codes = E.workCodes(e);
        const valid = E.dayShifts(state, d).map((s) => s.code);
        if (codes.length) {
          codes.forEach((c) => {
            if (!valid.includes(c)) out.push(issue('error', 'invalidShift', p.id, d, `${c} 班不在 ${d}（週${E.DOW_NAMES[E.dow(d)]}）的營業時段內`));
          });
          if (codes.length > (set.maxSessionsPerDay || 2)) out.push(issue('error', 'sessions', p.id, d, `一日排 ${codes.length} 節，超過 ${set.maxSessionsPerDay} 節`));
          if (E.overlaps(E.entryShiftMap(state, e, p.group), codes)) out.push(issue('error', 'overlap', p.id, d, '同日班別時間重疊'));
          const sp = E.entrySpan(state, e, p.group);
          if (sp && sp.hours > set.maxDailyHours + 1e-9) out.push(issue('error', 'daily', p.id, d, `單日正常工時 ${sp.hours}h，超過 ${set.maxDailyHours}h（§30-1）`));
          const gap = E.gapBetween(prevSpan, sp);
          if (gap < restMin) {
            out.push(issue('error', 'rest', p.id, d, `與前一日下班間隔僅 ${(gap / 60).toFixed(1)}h，未達 ${set.minRestHours}h（§34）`));
          }
          if (run === 0) runStart = d;
          run++;
          if (run === set.maxConsecutive + 1) {
            out.push(issue('error', 'consecutive', p.id, d, `自 ${runStart} 起連續上班超過 ${set.maxConsecutive} 天（七休一）`));
          }
          if (isFT && E.dow(d) === set.restDow) out.push(issue('error', 'restDow', p.id, d, '例假日（週日）排班'));
        } else {
          run = 0;
        }
        prevSpan = codes.length ? E.entrySpan(state, e, p.group) : null;
        if (!e && isFT) out.push(issue('warn', 'blank', p.id, d, '未排定（請設定班別或休假）'));
        const req = E.requestOf(state, d, p.id);
        if (req && codes.length) {
          if (req.off) out.push(issue('warn', 'request', p.id, d, `預假日仍排班${req.note ? `（${req.note}）` : ''}`));
          else codes.filter((c) => (req.block || []).includes(c)).forEach((c) => out.push(issue('warn', 'request', p.id, d, `${c} 班已預假`)));
        }
      });

      if (isFT) {
        if (m.regular < set.regularLeavePer4w) {
          out.push(issue('error', 'regular', p.id, null, `例假 ${m.regular} 天，少於 ${set.regularLeavePer4w} 天（§30-1）`));
        }
        const needOff = set.regularLeavePer4w + set.restDaysPer4w;
        if (m.regular + m.rest < needOff) {
          out.push(issue('error', 'offDays', p.id, null, `例假＋休息日共 ${m.regular + m.rest} 天，少於 ${needOff} 天`));
        }
        [0, 14].forEach((s0) => {
          const reg = dates.slice(s0, s0 + 14).filter((d) => {
            const e = entryOf(sched, p.id, d);
            return e && e.kind === '例';
          }).length;
          if (reg < 2) out.push(issue('error', 'biweekly', p.id, dates[s0], `${dates[s0]} 起兩週內例假僅 ${reg} 天，需至少 2 天（§30-1）`));
        });
      } else {
        const quota = Number(p.weeklySlots) || 0;
        m.weekSessions.forEach((n, w) => {
          if (quota && n > quota) out.push(issue('warn', 'ptQuota', p.id, dates[w * 7], `第 ${w + 1} 週排 ${n} 節，超過可支援 ${quota} 節`));
        });
        dates.forEach((d) => {
          E.workCodes(entryOf(sched, p.id, d)).forEach((c) => {
            if (!E.availOk(p, c)) out.push(issue('warn', 'ptAvail', p.id, d, `${c} 班不在可支援時段`));
          });
        });
      }
    });
    return out;
  }

  // ---------- 覆蓋 ----------
  function coverage(state, sched, start) {
    const dates = E.periodDates(start);
    const cells = {}, gaps = [], overs = [];
    let totalShort = 0, totalNeed = 0;
    const staff = E.activeStaff(state);
    dates.forEach((d) => {
      E.dayShifts(state, d).forEach((s) => {
        const byStation = {};
        state.stations.forEach((x) => { byStation[x.id] = []; });
        byStation.float = [];
        staff.forEach((p) => {
          const e = entryOf(sched, p.id, d);
          if (!E.workCodes(e).includes(s.code)) return;
          const post = e.posts && e.posts[s.code];
          const sid = post && post.station && byStation[post.station] ? post.station : 'float';
          byStation[sid].push({ id: p.id, name: p.name, group: p.group, seat: post ? post.seat : undefined });
        });
        state.stations.forEach((x) => {
          const q = E.demandOf(state, s.code, x.id, d);
          const n = byStation[x.id].length;
          const status = n < q.min ? 'short' : n > q.max ? 'over' : 'ok';
          const cell = { date: d, code: s.code, station: x.id, n, min: q.min, max: q.max, status, people: byStation[x.id] };
          cells[`${d}|${s.code}|${x.id}`] = cell;
          totalNeed += q.min;
          if (status === 'short') { gaps.push(cell); totalShort += q.min - n; }
          if (status === 'over') overs.push(cell);
        });
        cells[`${d}|${s.code}|float`] = { date: d, code: s.code, station: 'float', n: byStation.float.length, people: byStation.float };
      });
    });
    return { cells, gaps, overs, totalShort, totalNeed, rate: totalNeed ? 1 - totalShort / totalNeed : 1 };
  }

  // ---------- 產能（最低需求 vs 可供給人力，以節為單位） ----------
  function capacity(state, start) {
    const set = state.settings, dates = E.periodDates(start);
    const workdays = dates.filter((d) => E.dayShifts(state, d).length).length;
    const autoOff = dates.filter((d) => E.dow(d) !== set.restDow && !E.dayShifts(state, d).length).length;
    const ftDays = Math.max(0, workdays - Math.max(0, set.restDaysPer4w - autoOff));
    const per = Math.max(1, Math.min(2, set.maxSessionsPerDay || 2));
    const avgH = state.shifts.length ? state.shifts.reduce((h, s) => h + E.shiftHours(s), 0) / state.shifts.length : 4;
    const ftSessions = Math.min(ftDays * per, Math.floor(set.hoursCap / avgH));

    const need = { counter: 0, nurse: 0 }, maxNeed = { counter: 0, nurse: 0 }, fixed = { counter: 0, nurse: 0 };
    const active = new Set(E.activeStaff(state).map((p) => p.id));
    dates.forEach((d) => {
      E.dayShifts(state, d).forEach((s) => {
        ['counter', 'nurse'].forEach((g) => {
          const q = E.groupDemand(state, g, s.code, d);
          need[g] += q.min;
          maxNeed[g] += q.max;
        });
      });
      Object.entries((state.locks && state.locks[d]) || {}).forEach(([pid, lk]) => {
        if (!active.has(pid)) return;
        E.workCodes(lk).forEach((c) => {
          const g = E.stationGroup(state, lk.posts && lk.posts[c] && lk.posts[c].station);
          if (fixed[g] != null) fixed[g]++;
        });
      });
    });
    const groups = {};
    ['counter', 'nurse'].forEach((g) => {
      const n = E.activeStaff(state, g).filter((p) => !p.fixed).length;
      const rest = Math.max(0, need[g] - fixed[g]);
      groups[g] = {
        staff: n, fixedStaff: E.activeStaff(state, g).length - n, fixedSessions: fixed[g],
        supply: n * ftSessions, need: need[g], maxNeed: maxNeed[g], short: Math.max(0, rest - n * ftSessions),
      };
    });
    const pts = E.activeStaff(state, 'part').filter((p) => !p.fixed);
    const ptSupply = pts.reduce((s, p) => s + (Number(p.weeklySlots) || 0) * 4, 0);
    const totalShort = groups.counter.short + groups.nurse.short;
    return {
      ftDays, ftSessionsPerPerson: ftSessions, groups,
      part: { staff: pts.length, supply: ptSupply },
      totalShort,
      netShort: Math.max(0, totalShort - ptSupply),
      feasible: totalShort <= ptSupply,
    };
  }

  // ---------- 公平度 ----------
  function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
  function std(a) { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))) : 0; }
  function spread(values) { return values.length ? Math.max.apply(null, values) - Math.min.apply(null, values) : 0; }
  /** 0–100；差距 ≤ 1 視為完全平均；小數量以 3 為分母下限，避免 0/1/2 次就被判定極不公平 */
  function score(values) {
    if (!values.length || spread(values) <= 1) return 100;
    return Math.round(100 * (1 - Math.min(1, std(values) / Math.max(mean(values), 3))));
  }

  function fairness(state, metrics) {
    const out = {};
    ['counter', 'nurse', 'part'].forEach((g) => {
      const ms = metrics.filter((m) => m.group === g && !m.fixed);
      if (!ms.length) return;
      const pick = (f) => ms.map(f);
      const f = {
        hours: { score: score(pick((m) => m.hours)), spread: spread(pick((m) => m.hours)) },
        late: { score: score(pick((m) => m.late)), spread: spread(pick((m) => m.late)) },
        gap: { score: score(pick((m) => m.gap)), spread: spread(pick((m) => m.gap)) },
        sessions: { score: score(pick((m) => m.sessions)), spread: spread(pick((m) => m.sessions)) },
      };
      if (g === 'nurse') {
        f.stations = {};
        state.stations.filter((x) => x.group === 'nurse').forEach((x) => {
          const vals = pick((m) => m.stations[x.id] || 0);
          f.stations[x.id] = { score: score(vals), spread: spread(vals) };
        });
      }
      const parts = [f.hours.score, f.late.score, f.gap.score];
      if (f.stations) Object.values(f.stations).forEach((v) => parts.push(v.score));
      if (g === 'part') {
        const ratio = ms.map((m) => (m.quota ? m.sessions / (m.quota * 4) : 1) * 10);
        f.utilization = { score: score(ratio), rate: mean(ratio) / 10 };
        f.overall = f.utilization.score;
      } else {
        f.overall = Math.round(mean(parts));
      }
      out[g] = f;
    });
    return out;
  }

  function analyze(state, sched, start) {
    const metrics = E.activeStaff(state).map((p) => personMetrics(state, sched, start, p));
    const issues = legalChecks(state, sched, start);
    const cov = coverage(state, sched, start);
    const cap = capacity(state, start);
    const fair = fairness(state, metrics);
    const errors = issues.filter((x) => x.level === 'error');
    const warns = issues.filter((x) => x.level === 'warn');
    const ft = metrics.filter((m) => m.group !== 'part');
    return {
      metrics, issues, coverage: cov, capacity: cap, fairness: fair,
      summary: {
        errors: errors.length,
        warns: warns.length,
        gaps: cov.gaps.length,
        shortSessions: cov.totalShort,
        coverageRate: cov.rate,
        adj: ft.reduce((s, m) => s + m.adj, 0),
        gap: ft.reduce((s, m) => s + m.gap, 0),
      },
    };
  }

  return { personMetrics, legalChecks, coverage, capacity, fairness, analyze, score };
});
