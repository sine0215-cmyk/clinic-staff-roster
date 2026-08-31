/**
 * localStorage 資料層 + 示範資料
 */
(function (global) {
  const KEY = "clinic-staff-roster-v3";

  const ROLES = [
    { id: "nurse", label: "護理師" },
    { id: "medical", label: "醫務人員" },
    { id: "dietitian", label: "營養師" },
    { id: "pharmacist", label: "藥師" },
    { id: "educator", label: "衛教師" },
  ];

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function defaultPeriods() {
    const Rules = global.RosterRules;
    if (!Rules) {
      return { periods: [], activePeriodId: null, periodCount: 4 };
    }
    const today = Rules.formatYMD(new Date());
    const periods = Rules.buildPeriodBatch(today, 4);
    return {
      periods,
      activePeriodId: periods[0].id,
      periodCount: 4,
      periodAnchor: periods[0].start,
    };
  }

  function defaultState() {
    const staff = [
      { id: "n1", name: "王小玲", role: "nurse", group: "A", active: true },
      { id: "n2", name: "陳雅婷", role: "nurse", group: "A", active: true },
      { id: "n3", name: "林美惠", role: "nurse", group: "B", active: true },
      { id: "m1", name: "張志明", role: "medical", group: "行政", active: true },
      { id: "m2", name: "李佳蓉", role: "medical", group: "行政", active: true },
      { id: "d1", name: "黃詩涵", role: "dietitian", group: "臨床", active: true },
      { id: "d2", name: "吳宜臻", role: "dietitian", group: "門診", active: true },
      { id: "p1", name: "蔡宗翰", role: "pharmacist", group: "門診藥局", active: true },
      { id: "p2", name: "許雅琪", role: "pharmacist", group: "門診藥局", active: true },
      { id: "e1", name: "鄭佩君", role: "educator", group: "糖尿病", active: true },
      { id: "e2", name: "周佳玲", role: "educator", group: "慢性病", active: true },
    ];

    const quotas = {};
    for (const s of staff) {
      quotas[s.id] = {
        morning: 3,
        afternoon: 3,
        evening: s.role === "dietitian" || s.role === "educator" ? 1 : 2,
        holiday: 1,
      };
    }

    const coverage = {};
    for (const r of ROLES) {
      coverage[r.id] = {
        morning: 1,
        afternoon: 1,
        evening: r.id === "dietitian" ? 0 : 1,
        holidayMorning: 1,
        holidayAfternoon: 1,
      };
    }

    const periodState = defaultPeriods();

    return {
      orgName: "醫療人員綜合排班系統",
      // 相容舊欄位
      month: periodState.periods[0]
        ? `${periodState.periods[0].start.slice(0, 7)}-01`
        : null,
      cycleStart: periodState.periods[0]?.start || null,
      ...periodState,
      staff,
      quotas,
      coverage,
      preferences: {},
      unavailable: {},
      schedule: {},
      restDays: {},
      selfUserId: staff[0].id,
      accounts: [],
    };
  }

  function migratePeriods(state) {
    const Rules = global.RosterRules;
    if (!Rules) return state;
    if (Array.isArray(state.periods) && state.periods.length >= 3) {
      // 確保 dates / label 齊全
      state.periods = state.periods.map((p) => {
        const full = Rules.makePeriod(p.start);
        return { ...full, id: p.id || full.id };
      });
      if (!state.activePeriodId || !Rules.findPeriod(state.periods, state.activePeriodId)) {
        state.activePeriodId = state.periods[0].id;
      }
      state.periodCount = state.periods.length;
      state.periodAnchor = state.periods[0].start;
      return state;
    }
    const anchor = state.cycleStart || state.month || Rules.formatYMD(new Date());
    const count = Math.min(6, Math.max(3, state.periodCount || 4));
    const periods = Rules.buildPeriodBatch(anchor, count);
    state.periods = periods;
    state.activePeriodId = periods[0].id;
    state.periodCount = count;
    state.periodAnchor = periods[0].start;
    return state;
  }

  function load() {
    try {
      let raw = localStorage.getItem(KEY);
      if (!raw) {
        raw =
          localStorage.getItem("clinic-staff-roster-v2") ||
          localStorage.getItem("clinic-staff-roster-v1");
      }
      if (!raw) return migratePeriods(defaultState());
      const merged = migratePeriods({ ...defaultState(), ...JSON.parse(raw) });
      return merged;
    } catch {
      return migratePeriods(defaultState());
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function reset() {
    localStorage.removeItem(KEY);
    return migratePeriods(defaultState());
  }

  function roleLabel(id) {
    return (ROLES.find((r) => r.id === id) || {}).label || id;
  }

  function activePeriod(state) {
    const Rules = global.RosterRules;
    if (!Rules) return null;
    return (
      Rules.findPeriod(state.periods, state.activePeriodId) ||
      (state.periods && state.periods[0]) ||
      null
    );
  }

  global.RosterStore = {
    KEY,
    ROLES,
    uid,
    defaultState,
    load,
    save,
    reset,
    roleLabel,
    activePeriod,
    migratePeriods,
  };
})(window);
