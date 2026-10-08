/**
 * 預設設定：班別 A–E、崗位需求、同仁名單
 * 瀏覽器：window.RosterConfig；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RosterConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GROUPS = [
    { id: 'counter', name: '醫務櫃檯', prefix: 'F' },
    { id: 'nurse', name: '護理同仁', prefix: 'N' },
    { id: 'part', name: '兼職同仁', prefix: 'P' },
  ];

  function defaultStations() {
    return [
      { id: 'counter', name: '櫃檯', short: '櫃', group: 'counter', min: 4, max: 4, seats: true },
      { id: 'endo', name: '胃鏡室', short: '胃', group: 'nurse', min: 1, max: 2 },
      { id: 'lab', name: '檢驗室', short: '檢', group: 'nurse', min: 2, max: 3 },
      { id: 'clinic', name: '跟診', short: '跟', group: 'nurse', min: 3, max: 4 },
    ];
  }

  function defaultShifts() {
    return [
      { code: 'A', name: '平日早班', start: '08:00', end: '12:00', days: [1, 2, 3, 4, 5] },
      { code: 'B', name: '平日午班', start: '13:30', end: '17:30', days: [1, 2, 3, 4, 5] },
      {
        code: 'C', name: '平日晚班', start: '18:00', end: '21:30', days: [1, 2, 3, 4, 5],
        groupTimes: { counter: { start: '17:30', end: '21:30' } },
      },
      { code: 'D', name: '週六早班', start: '08:00', end: '12:00', days: [6] },
      { code: 'E', name: '週六午班', start: '13:30', end: '17:30', days: [6] },
    ];
  }

  function defaultSettings() {
    return {
      orgName: '敦仁診所',
      periodAnchor: '2026-08-30',
      restDow: 0,
      restDaysPer4w: 4,
      regularLeavePer4w: 4,
      hoursCap: 160,
      hoursTarget: 152,
      maxDailyHours: 10,
      maxSessionsPerDay: 2,
      minRestHours: 11,
      maxConsecutive: 6,
      allowGapPair: true,
      protectHours: true,
    };
  }

  function groupStations(group) {
    return defaultStations().filter((x) => x.group === group).map((x) => x.id);
  }

  function newStaff(group, id, index) {
    const p = { id, name: id, group, active: true };
    if (group === 'counter') p.skills = groupStations('counter');
    if (group === 'nurse') p.skills = groupStations('nurse');
    if (group === 'part') {
      p.skills = ['lab', 'clinic', 'counter'];
      p.weeklySlots = index % 2 === 1 ? 4 : 3;
      p.avail = null;
    }
    return p;
  }

  function makeStaff(group, n) {
    const g = GROUPS.find((x) => x.id === group);
    const out = [];
    for (let i = 1; i <= n; i++) out.push(newStaff(group, g.prefix + i, i));
    return out;
  }

  function nextId(state, group) {
    const g = GROUPS.find((x) => x.id === group);
    let max = 0;
    state.staff.forEach((p) => {
      const m = new RegExp('^' + g.prefix + '(\\d+)$').exec(p.id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return g.prefix + (max + 1);
  }

  function ensureDemand(state) {
    state.demand = state.demand || {};
    state.shifts.forEach((sh) => {
      state.demand[sh.code] = state.demand[sh.code] || {};
      state.stations.forEach((st) => {
        if (!state.demand[sh.code][st.id]) state.demand[sh.code][st.id] = { min: st.min, max: st.max };
      });
    });
    Object.keys(state.demand).forEach((code) => {
      if (!state.shifts.some((s) => s.code === code)) delete state.demand[code];
    });
    return state;
  }

  function createState() {
    const state = {
      version: 1,
      settings: defaultSettings(),
      shifts: defaultShifts(),
      stations: defaultStations(),
      demand: {},
      dateDemand: {},
      locks: {},
      requests: {},
      importInfo: null,
      staff: [].concat(makeStaff('counter', 5), makeStaff('nurse', 9), makeStaff('part', 4)),
      schedules: {},
      periodStart: null,
      dirty: false,
    };
    return ensureDemand(state);
  }

  function normalize(saved) {
    const base = createState();
    const s = saved || {};
    const out = Object.assign({}, base, s);
    out.settings = Object.assign({}, base.settings, s.settings || {});
    out.shifts = Array.isArray(s.shifts) && s.shifts.length ? s.shifts : base.shifts;
    out.stations = base.stations.map((st) => Object.assign({}, st, (s.stations || []).find((x) => x.id === st.id) || {}));
    out.staff = Array.isArray(s.staff) ? s.staff : base.staff;
    out.demand = s.demand || {};
    out.dateDemand = s.dateDemand || {};
    out.locks = s.locks || {};
    out.requests = s.requests || {};
    out.importInfo = s.importInfo || null;
    out.schedules = s.schedules || {};
    return ensureDemand(out);
  }

  return { GROUPS, defaultStations, defaultShifts, defaultSettings, newStaff, nextId, ensureDemand, createState, normalize };
});
