/**
 * 預設設定：班別 A–E、崗位需求、同仁名單
 * 瀏覽器：window.RosterConfig；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RosterConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** manual：只列名單，班別在排班大表手動填；一鍵排班不排也不覆蓋，但照算工時與法規 */
  const GROUPS = [
    { id: 'counter', name: '醫務櫃檯', prefix: 'F' },
    { id: 'nurse', name: '護理同仁', prefix: 'N' },
    { id: 'pharmacist', name: '藥師', prefix: 'PH' },
    { id: 'medtech', name: '醫檢師', prefix: 'MT' },
    { id: 'part', name: '兼職同仁', prefix: 'P' },
    { id: 'doctor', name: '醫師', prefix: 'DR', manual: true },
    { id: 'dietitian', name: '營養師', prefix: 'RD', manual: true },
    { id: 'educator', name: '衛教師', prefix: 'HE', manual: true },
  ];

  /** 院所：各自有崗位需求、各自排班；demand 未列者用崗位預設 */
  const SITES = [
    { id: 'neili', name: '內壢敦仁', short: '內壢' },
    { id: 'qingpu', name: '青埔敦仁', short: '青埔' },
    { id: 'metab', name: '新陳代謝', short: '新陳', aliases: ['12號', '新代'] },
    { id: 'pharmacy', name: '康華藥局', short: '藥局' },
    { id: 'ruikang', name: '睿康檢驗所', short: '睿康' },
    { id: 'health', name: '康華健康', short: '康健', aliases: ['康華健康'] },
  ];
  const SITE_DEMAND = {
    qingpu: { counter: [2, 2], endo: [0, 1], lab: [1, 1], clinic: [1, 2] },
    metab: { counter: [1, 1], endo: [0, 0], lab: [1, 1], clinic: [1, 1] },
    pharmacy: { counter: [0, 0], endo: [0, 0], lab: [0, 0], clinic: [0, 0], dispense: [1, 1] },
    ruikang: { counter: [0, 0], endo: [0, 0], lab: [0, 0], clinic: [0, 0], medlab: [1, 2] },
    health: { counter: [1, 1], endo: [0, 0], lab: [0, 0], clinic: [0, 0] },
  };
  function siteIdOf(v) {
    if (!v) return SITES[0].id;
    const s = SITES.find((x) => x.id === v || x.name === v || x.short === v || String(v).includes(x.short) ||
      (x.aliases || []).some((a) => String(v).includes(a)));
    return s ? s.id : SITES[0].id;
  }

  function defaultStations() {
    return [
      { id: 'counter', name: '櫃檯', short: '櫃', group: 'counter', min: 4, max: 4, seats: true },
      { id: 'endo', name: '胃鏡室', short: '胃', group: 'nurse', min: 1, max: 2 },
      { id: 'lab', name: '檢驗室', short: '檢', group: 'nurse', min: 2, max: 3 },
      { id: 'clinic', name: '跟診', short: '跟', group: 'nurse', min: 3, max: 4 },
      { id: 'dispense', name: '調劑', short: '調', group: 'pharmacist', min: 0, max: 0, ptDefault: false },
      { id: 'medlab', name: '醫檢', short: '醫檢', group: 'medtech', min: 0, max: 0, ptDefault: false },
    ];
  }

  /** 醫師依門診時段計時（早 08:30、午 14:00、晚 18:00 開診） */
  const DOCTOR_TIMES = {
    A: { start: '08:30', end: '12:00' },
    B: { start: '14:00', end: '17:30' },
    C: { start: '18:00', end: '21:30' },
    D: { start: '08:30', end: '12:00' },
    E: { start: '14:00', end: '17:30' },
  };

  function defaultShifts() {
    return [
      { code: 'A', name: '平日早班', start: '08:00', end: '12:00', days: [1, 2, 3, 4, 5] },
      { code: 'B', name: '平日午班', start: '13:30', end: '17:30', days: [1, 2, 3, 4, 5] },
      { code: 'C', name: '平日晚班', start: '17:50', end: '21:30', days: [1, 2, 3, 4, 5] },
      { code: 'D', name: '週六早班', start: '08:00', end: '12:00', days: [6] },
      { code: 'E', name: '週六午班', start: '13:30', end: '17:30', days: [6] },
    ].map(addDoctorTimes);
  }

  function addDoctorTimes(s) {
    const t = DOCTOR_TIMES[s.code];
    if (t && !(s.groupTimes && s.groupTimes.doctor)) s.groupTimes = Object.assign({}, s.groupTimes, { doctor: Object.assign({}, t) });
    return s;
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
      standardGroups: ['counter', 'nurse', 'pharmacist'],
    };
  }

  function groupStations(group) {
    return defaultStations().filter((x) => x.group === group).map((x) => x.id);
  }

  function newStaff(group, id, index) {
    const p = { id, name: id, group, site: SITES[0].id, active: true };
    const g = GROUPS.find((x) => x.id === group);
    if (g && !g.manual && group !== 'part') p.skills = groupStations(group);
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

  /** state.demand[院所][班別][崗位]、state.dateDemand[院所][日期][班別][崗位] */
  function ensureDemand(state) {
    state.demand = state.demand || {};
    state.dateDemand = state.dateDemand || {};
    state.weekDemand = state.weekDemand || {};
    state.sites.forEach((site) => {
      const dm = state.demand[site.id] = state.demand[site.id] || {};
      const def = SITE_DEMAND[site.id] || {};
      state.shifts.forEach((sh) => {
        dm[sh.code] = dm[sh.code] || {};
        state.stations.forEach((st) => {
          if (dm[sh.code][st.id]) return;
          const d = def[st.id];
          dm[sh.code][st.id] = d ? { min: d[0], max: d[1] } : { min: st.min, max: st.max };
        });
      });
      Object.keys(dm).forEach((code) => {
        if (!state.shifts.some((s) => s.code === code)) delete dm[code];
      });
      state.dateDemand[site.id] = state.dateDemand[site.id] || {};
      const wk = state.weekDemand[site.id] = state.weekDemand[site.id] || {};
      Object.values(wk).forEach((byCode) => Object.keys(byCode).forEach((code) => {
        if (!state.shifts.some((s) => s.code === code)) delete byCode[code];
      }));
    });
    return state;
  }

  const isSiteKeyed = (obj) => Object.keys(obj || {}).every((k) => SITES.some((s) => s.id === k));

  /** 舊版預設 C 班（護理 18:00、櫃檯 17:30，皆到 21:30）改為全員 17:50–21:30；使用者自訂過的不動 */
  function migrateOldC(s) {
    const ct = s.groupTimes && s.groupTimes.counter;
    const oldDefault = s.code === 'C' && s.start === '18:00' && s.end === '21:30' &&
      ct && ct.start === '17:30' && ct.end === '21:30' &&
      Object.keys(s.groupTimes).every((g) => g === 'counter' || g === 'doctor');
    if (!oldDefault) return;
    s.start = '17:50';
    delete s.groupTimes.counter;
    if (!Object.keys(s.groupTimes).length) delete s.groupTimes;
  }

  function createState() {
    const state = {
      version: 1,
      settings: defaultSettings(),
      shifts: defaultShifts(),
      stations: defaultStations(),
      sites: SITES.map((s) => Object.assign({}, s)),
      demand: {},
      dateDemand: {},
      weekDemand: {},
      locks: {},
      requests: {},
      wishes: {},
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
    out.shifts.forEach((x) => { migrateOldC(x); addDoctorTimes(x); });
    out.stations = base.stations.map((st) => {
      const x = Object.assign({}, st, (s.stations || []).find((y) => y.id === st.id) || {}, { group: st.group });
      delete x.optIn;
      return x;
    });
    out.sites = base.sites;
    out.staff = Array.isArray(s.staff) ? s.staff : base.staff;
    out.staff.forEach((p) => { p.site = siteIdOf(p.site); });
    const main = SITES[0].id;
    out.demand = isSiteKeyed(s.demand) ? s.demand || {} : { [main]: s.demand };
    out.dateDemand = isSiteKeyed(s.dateDemand) ? s.dateDemand || {} : { [main]: s.dateDemand };
    out.weekDemand = isSiteKeyed(s.weekDemand) ? s.weekDemand || {} : {};
    out.locks = s.locks || {};
    out.requests = s.requests || {};
    out.wishes = s.wishes || {};
    out.importInfo = s.importInfo || null;
    out.schedules = s.schedules || {};
    ensureDemand(out);
    dropOldCounterDefault(out);
    return out;
  }

  /** 康華藥局、睿康檢驗所舊預設櫃檯 1 人（各班皆 1–1、未改過）→ 改為 0 */
  function dropOldCounterDefault(state) {
    ['pharmacy', 'ruikang'].forEach((site) => {
      const dm = state.demand[site];
      const qs = state.shifts.map((s) => dm && dm[s.code] && dm[s.code].counter);
      if (!qs.length || !qs.every((q) => q && q.min === 1 && q.max === 1)) return;
      qs.forEach((q) => { q.min = 0; q.max = 0; });
    });
  }

  return { GROUPS, SITES, DOCTOR_TIMES, siteIdOf, defaultStations, defaultShifts, defaultSettings, newStaff, nextId, ensureDemand, createState, normalize };
});
