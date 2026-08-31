/**
 * 勞基法 §30-1 四週變形工時合規引擎
 * - 每日正常工時 ≤ 10 小時
 * - 四週正常工時總計 ≤ 160 小時
 * - 每二週至少 2 日例假
 * - 每四週例假＋休息日合計 ≥ 8 日
 * - 當日正常工時達 10 小時者，延長工時 ≤ 2 小時（當日總工時 ≤ 12）
 */
(function (global) {
  const SLOT_HOURS = 4;

  const SHIFTS = {
    morning: { code: "M", label: "早班", start: "08:00", end: "12:00", hours: 4 },
    afternoon: { code: "A", label: "午班", start: "13:30", end: "17:30", hours: 4 },
    evening: { code: "E", label: "晚班", start: "17:30", end: "21:30", hours: 4 },
  };

  function parseYMD(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function dayOfWeek(ymd) {
    return parseYMD(ymd).getDay(); // 0=Sun … 6=Sat
  }

  /** 該日開放的班別（週日預設不排班） */
  function allowedShifts(ymd) {
    const dow = dayOfWeek(ymd);
    if (dow === 0) return []; // 週日：原則上例假／休息日
    if (dow === 6) return ["morning", "afternoon"]; // 週六假日班
    return ["morning", "afternoon", "evening"]; // 週一～五
  }

  function isHolidayShiftDay(ymd) {
    return dayOfWeek(ymd) === 6;
  }

  /** 產生自 start 起連續 n 天的日期字串 */
  function dateRange(startYmd, days) {
    const out = [];
    const d = parseYMD(startYmd);
    for (let i = 0; i < days; i++) {
      out.push(formatYMD(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  /** 對齊到四週週期起點（週一） */
  function alignCycleStart(ymd) {
    const d = parseYMD(ymd);
    const dow = d.getDay(); // 0 Sun
    const toMon = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + toMon);
    return formatYMD(d);
  }

  /** YYYY-MM-DD → YYYY/MM/DD */
  function toSlashDate(ymd) {
    return String(ymd).replace(/-/g, "/");
  }

  /** 期別顯示：YYYY/MM/DD~YYYY/MM/DD */
  function periodLabel(startYmd, endYmd) {
    return `${toSlashDate(startYmd)}~${toSlashDate(endYmd)}`;
  }

  /** 建立單一四周期別（28 日，自週一起） */
  function makePeriod(anchorYmd) {
    const start = alignCycleStart(anchorYmd);
    const dates = dateRange(start, 28);
    const end = dates[dates.length - 1];
    return {
      id: `per_${start}`,
      start,
      end,
      label: periodLabel(start, end),
      dates,
    };
  }

  /** 自錨點起連續產生 count 個四周期別（限制 3～6） */
  function buildPeriodBatch(anchorYmd, count) {
    const n = Math.min(6, Math.max(3, Number(count) || 3));
    const periods = [];
    let start = alignCycleStart(anchorYmd);
    for (let i = 0; i < n; i++) {
      periods.push(makePeriod(start));
      const d = parseYMD(start);
      d.setDate(d.getDate() + 28);
      start = formatYMD(d);
    }
    return periods;
  }

  function findPeriod(periods, id) {
    return (periods || []).find((p) => p.id === id) || null;
  }

  function allDatesFromPeriods(periods) {
    const set = new Set();
    const out = [];
    for (const p of periods || []) {
      const dates = p.dates || dateRange(p.start, 28);
      for (const ymd of dates) {
        if (!set.has(ymd)) {
          set.add(ymd);
          out.push(ymd);
        }
      }
    }
    return out;
  }

  function fourWeekCyclesCovering(monthYmd) {
    const first = parseYMD(monthYmd);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const cycles = [];
    let cursor = alignCycleStart(formatYMD(first));
    const endStr = formatYMD(last);
    while (cursor <= endStr || cycles.length === 0) {
      cycles.push(makePeriod(cursor));
      const next = parseYMD(cursor);
      next.setDate(next.getDate() + 28);
      cursor = formatYMD(next);
      if (cycles.length > 6) break;
    }
    return cycles;
  }

  /**
   * schedule: { [ymd]: { morning:[id], afternoon:[id], evening:[id] } }
   * restDays: { [staffId]: { [ymd]: '例假'|'休息日'|'空班' } }
   */
  function staffDayHours(schedule, staffId, ymd) {
    const day = schedule[ymd] || {};
    let h = 0;
    for (const key of ["morning", "afternoon", "evening"]) {
      if ((day[key] || []).includes(staffId)) h += SLOT_HOURS;
    }
    return h;
  }

  function staffWorked(schedule, staffId, ymd) {
    return staffDayHours(schedule, staffId, ymd) > 0;
  }

  function validateStaffCycle(staffId, staffName, cycleDates, schedule, restDays) {
    const issues = [];
    let normalHours = 0;
    let otHours = 0;
    const offTypes = restDays[staffId] || {};

    for (const ymd of cycleDates) {
      const worked = staffDayHours(schedule, staffId, ymd);
      if (worked === 0) continue;

      // 正常工時最多 10；超過部分算延長，當日總上限 12
      if (worked > 12) {
        issues.push({
          severity: "error",
          rule: "§30-1／§32",
          date: ymd,
          message: `${staffName} ${ymd} 當日工時 ${worked}h 超過上限 12h`,
        });
      } else if (worked > 10) {
        normalHours += 10;
        otHours += worked - 10;
        issues.push({
          severity: "warn",
          rule: "§30-1",
          date: ymd,
          message: `${staffName} ${ymd} 正常工時達 10h，另有延長 ${worked - 10}h（當日延長 ≤ 2h）`,
        });
      } else {
        normalHours += worked;
      }

      // 早＋晚間隔：午休後晚班銜接無問題；早班結束 12:00 到晚班 17:30 間隔足夠
      // 午班 13:30–17:30 接晚班 17:30–21:30：交班無休息，標記提醒
      const day = schedule[ymd] || {};
      const hasA = (day.afternoon || []).includes(staffId);
      const hasE = (day.evening || []).includes(staffId);
      if (hasA && hasE) {
        issues.push({
          severity: "warn",
          rule: "休息",
          date: ymd,
          message: `${staffName} ${ymd} 午班接晚班，建議安排至少 30 分鐘休息（勞基法 §35）`,
        });
      }
    }

    if (normalHours > 160) {
      issues.push({
        severity: "error",
        rule: "§30-1",
        date: cycleDates[0],
        message: `${staffName} 四週正常工時 ${normalHours}h 超過 160h 上限`,
      });
    }

    // 例假／休息日統計
    let liJia = 0;
    let rest = 0;
    let emptyOff = 0;
    for (const ymd of cycleDates) {
      if (staffWorked(schedule, staffId, ymd)) continue;
      const t = offTypes[ymd];
      if (t === "例假") liJia += 1;
      else if (t === "休息日") rest += 1;
      else emptyOff += 1; // 未標示的未出勤日，暫計入可充當休息日額度
    }
    const totalOff = liJia + rest + emptyOff;

    // 每二週至少 2 日例假
    for (let w = 0; w < 2; w++) {
      const slice = cycleDates.slice(w * 14, w * 14 + 14);
      let lj = 0;
      for (const ymd of slice) {
        if (staffWorked(schedule, staffId, ymd)) continue;
        const t = offTypes[ymd];
        if (t === "例假" || (!t && dayOfWeek(ymd) === 0)) lj += 1;
      }
      if (lj < 2) {
        issues.push({
          severity: "error",
          rule: "§36③",
          date: slice[0],
          message: `${staffName} 第 ${w + 1}～${w + 2} 週例假不足（需每二週 ≥ 2 日例假，目前約 ${lj} 日）`,
        });
      }
    }

    if (totalOff < 8) {
      issues.push({
        severity: "error",
        rule: "§36③",
        date: cycleDates[0],
        message: `${staffName} 四週例假＋休息日合計 ${totalOff} 日，不足 8 日`,
      });
    }

    return {
      staffId,
      staffName,
      normalHours,
      otHours,
      totalOff,
      liJia,
      rest,
      issues,
      ok: !issues.some((i) => i.severity === "error"),
    };
  }

  function validateAll(staffList, schedule, restDays, cycleStart) {
    const dates = dateRange(cycleStart, 28);
    const reports = staffList
      .filter((s) => s.active !== false)
      .map((s) => validateStaffCycle(s.id, s.name, dates, schedule, restDays || {}));
    const issues = reports.flatMap((r) => r.issues);
    return { cycleStart, dates, reports, issues };
  }

  /** 建議：週日預設例假，若當週六有假日班則另一例假可彈性 */
  function suggestRestDays(staffList, schedule, cycleStart) {
    const dates = dateRange(cycleStart, 28);
    const restDays = {};
    for (const s of staffList) {
      restDays[s.id] = {};
      for (const ymd of dates) {
        if (staffWorked(schedule, s.id, ymd)) continue;
        if (dayOfWeek(ymd) === 0) restDays[s.id][ymd] = "例假";
        else restDays[s.id][ymd] = "休息日";
      }
    }
    return restDays;
  }

  global.RosterRules = {
    SLOT_HOURS,
    SHIFTS,
    parseYMD,
    formatYMD,
    toSlashDate,
    periodLabel,
    dayOfWeek,
    allowedShifts,
    isHolidayShiftDay,
    dateRange,
    alignCycleStart,
    makePeriod,
    buildPeriodBatch,
    findPeriod,
    allDatesFromPeriods,
    fourWeekCyclesCovering,
    staffDayHours,
    staffWorked,
    validateStaffCycle,
    validateAll,
    suggestRestDays,
  };
})(window);
