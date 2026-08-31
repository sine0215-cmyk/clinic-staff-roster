/**
 * 自動排班：依主管配班設定 + 同仁希望班 + 可上班日，產生月班表
 * 優先序：want > ok > 未填；避開 no 與不可上班日；滿足覆蓋與週配額；通過四週工時檢查
 */
(function (global) {
  const R = () => global.RosterRules;

  function monthDates(monthYmd) {
    const [y, m] = monthYmd.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const out = [];
    for (let d = 1; d <= last; d++) {
      out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return out;
  }

  function prefScore(pref, shift) {
    if (!pref) return 1; // 未填視為可接受
    const v = pref[shift];
    if (v === "want") return 3;
    if (v === "ok" || v == null) return 1;
    if (v === "no") return -99;
    return 1;
  }

  function countWeekSlots(schedule, staffId, weekDates, shiftKey, holidayOnly) {
    let n = 0;
    for (const ymd of weekDates) {
      const allowed = R().allowedShifts(ymd);
      if (!allowed.includes(shiftKey)) continue;
      if (holidayOnly && !R().isHolidayShiftDay(ymd)) continue;
      if (!holidayOnly && R().isHolidayShiftDay(ymd) && (shiftKey === "morning" || shiftKey === "afternoon")) {
        // 平日配額不含週六假日班
        continue;
      }
      if (((schedule[ymd] || {})[shiftKey] || []).includes(staffId)) n += 1;
    }
    return n;
  }

  function weekSlices(dates) {
    // 依週一對齊切週
    const weeks = [];
    let cur = [];
    for (const ymd of dates) {
      if (R().dayOfWeek(ymd) === 1 && cur.length) {
        weeks.push(cur);
        cur = [];
      }
      cur.push(ymd);
    }
    if (cur.length) weeks.push(cur);
    return weeks;
  }

  /**
   * 對單一期別（28 日）自動排班
   * @param {object} state
   * @param {object} [period] - { start, dates }；未傳則用 state 的 active 期別
   */
  function buildSchedule(state, period) {
    const rules = R();
    const p =
      period ||
      rules.findPeriod(state.periods, state.activePeriodId) ||
      (state.periods && state.periods[0]) ||
      rules.makePeriod(state.month || rules.formatYMD(new Date()));
    const dates = p.dates || rules.dateRange(p.start, 28);
    const cycleStart = p.start || rules.alignCycleStart(dates[0]);
    const staff = state.staff.filter((s) => s.active !== false);
    const schedule = {};
    for (const ymd of dates) {
      schedule[ymd] = { morning: [], afternoon: [], evening: [] };
    }

    const weeks = weekSlices(dates);

    const used = {};
    for (const s of staff) {
      used[s.id] = { morning: 0, afternoon: 0, evening: 0, holiday: 0 };
    }

    function already(ymd, shift, sid) {
      return ((schedule[ymd] || {})[shift] || []).includes(sid);
    }

    function canAssign(s, ymd, shift) {
      const unavail = state.unavailable[s.id] || [];
      if (unavail.includes(ymd)) return false;

      const prefs = (state.preferences[s.id] || {})[ymd];
      if (prefs && prefs[shift] === "no") return false;

      const allowed = rules.allowedShifts(ymd);
      if (!allowed.includes(shift)) return false;

      const curH = rules.staffDayHours(schedule, s.id, ymd);
      if (curH + rules.SLOT_HOURS > 12) return false;

      const week = weeks.find((w) => w.includes(ymd)) || dates;
      const q = state.quotas[s.id] || { morning: 99, afternoon: 99, evening: 99, holiday: 99 };
      if (rules.isHolidayShiftDay(ymd)) {
        const hCount =
          countWeekSlots(schedule, s.id, week, "morning", true) +
          countWeekSlots(schedule, s.id, week, "afternoon", true);
        if (hCount >= (q.holiday ?? 1)) return false;
      } else {
        const c = countWeekSlots(schedule, s.id, week, shift, false);
        if (c >= (q[shift] ?? 3)) return false;
      }

      return true;
    }

    function coverageNeed(role, ymd, shift) {
      const cov = state.coverage[role] || {};
      if (rules.isHolidayShiftDay(ymd)) {
        if (shift === "morning") return cov.holidayMorning ?? 1;
        if (shift === "afternoon") return cov.holidayAfternoon ?? 1;
        return 0;
      }
      return cov[shift] ?? 1;
    }

    function fillPass() {
      for (const ymd of dates) {
        const shifts = rules.allowedShifts(ymd);
        for (const shift of shifts) {
          for (const role of global.RosterStore.ROLES.map((r) => r.id)) {
            const need = coverageNeed(role, ymd, shift);
            const roleStaff = staff.filter((s) => s.role === role);
            let have = (schedule[ymd][shift] || []).filter((id) =>
              roleStaff.some((s) => s.id === id)
            ).length;

            while (have < need) {
              const candidates = roleStaff
                .filter((s) => !already(ymd, shift, s.id) && canAssign(s, ymd, shift))
                .map((s) => {
                  const prefs = (state.preferences[s.id] || {})[ymd];
                  let score = prefScore(prefs, shift);
                  const load =
                    used[s.id].morning +
                    used[s.id].afternoon +
                    used[s.id].evening +
                    used[s.id].holiday;
                  score = score * 10 - load;
                  return { s, score };
                })
                .filter((c) => c.score > -50)
                .sort((a, b) => b.score - a.score);

              if (!candidates.length) break;
              const pick = candidates[0].s;
              schedule[ymd][shift].push(pick.id);
              if (rules.isHolidayShiftDay(ymd)) used[pick.id].holiday += 1;
              else used[pick.id][shift] += 1;
              have += 1;
            }
          }
        }
      }
    }

    fillPass();

    for (const s of staff) {
      const prefsByDate = state.preferences[s.id] || {};
      for (const ymd of dates) {
        const prefs = prefsByDate[ymd];
        if (!prefs) continue;
        for (const shift of rules.allowedShifts(ymd)) {
          if (prefs[shift] !== "want") continue;
          if (already(ymd, shift, s.id)) continue;
          if (!canAssign(s, ymd, shift)) continue;
          schedule[ymd][shift].push(s.id);
          if (rules.isHolidayShiftDay(ymd)) used[s.id].holiday += 1;
          else used[s.id][shift] += 1;
        }
      }
    }

    const restDays = rules.suggestRestDays(staff, schedule, cycleStart);
    const compliance = rules.validateAll(staff, schedule, restDays, cycleStart);

    return {
      schedule,
      restDays,
      cycleStart,
      used,
      compliance,
      dates,
      period: { ...p, dates, label: p.label || rules.periodLabel(cycleStart, dates[dates.length - 1]) },
    };
  }

  /** 連續排定多個期別，合併班表 */
  function buildScheduleForPeriods(state, periods) {
    const list = periods && periods.length ? periods : state.periods || [];
    let schedule = { ...(state.schedule || {}) };
    let restDays = { ...(state.restDays || {}) };
    const results = [];

    for (const period of list) {
      const result = buildSchedule(state, period);
      // 只覆寫本期日期
      for (const ymd of result.dates) {
        schedule[ymd] = result.schedule[ymd];
      }
      for (const [sid, days] of Object.entries(result.restDays || {})) {
        restDays[sid] = { ...(restDays[sid] || {}), ...days };
      }
      results.push(result);
    }

    return { schedule, restDays, results, periods: list };
  }

  /**
   * 職務主管自動排班：只覆寫該職務人員，保留其他職務既有班表
   */
  function mergeScheduleByRole(oldSchedule, newSchedule, staff, roleId) {
    const roleIds = new Set(staff.filter((s) => s.role === roleId).map((s) => s.id));
    const dates = new Set([
      ...Object.keys(oldSchedule || {}),
      ...Object.keys(newSchedule || {}),
    ]);
    const out = {};
    for (const ymd of dates) {
      out[ymd] = { morning: [], afternoon: [], evening: [] };
      for (const shift of ["morning", "afternoon", "evening"]) {
        const keep = ((oldSchedule[ymd] || {})[shift] || []).filter((id) => !roleIds.has(id));
        const neu = ((newSchedule[ymd] || {})[shift] || []).filter((id) => roleIds.has(id));
        out[ymd][shift] = [...keep, ...neu];
      }
    }
    return out;
  }

  /** 僅合併指定日期範圍內的職務班表 */
  function mergeScheduleByRoleInDates(oldSchedule, newSchedule, staff, roleId, dates) {
    const roleIds = new Set(staff.filter((s) => s.role === roleId).map((s) => s.id));
    const out = { ...(oldSchedule || {}) };
    for (const ymd of dates) {
      const prev = out[ymd] || { morning: [], afternoon: [], evening: [] };
      out[ymd] = { morning: [], afternoon: [], evening: [] };
      for (const shift of ["morning", "afternoon", "evening"]) {
        const keep = (prev[shift] || []).filter((id) => !roleIds.has(id));
        const neu = ((newSchedule[ymd] || {})[shift] || []).filter((id) => roleIds.has(id));
        out[ymd][shift] = [...keep, ...neu];
      }
    }
    return out;
  }

  global.RosterScheduler = {
    monthDates,
    buildSchedule,
    buildScheduleForPeriods,
    mergeScheduleByRole,
    mergeScheduleByRoleInDates,
  };
})(window);
