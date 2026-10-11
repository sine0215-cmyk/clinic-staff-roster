/* 單元測試與自動化檢核：node tests/run-tests.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../js/config.js'));
const E = require(path.join(__dirname, '../js/engine.js'));
const A = require(path.join(__dirname, '../js/audit.js'));
const X = require(path.join(__dirname, '../js/export.js'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期望 ${JSON.stringify(b)}，實得 ${JSON.stringify(a)}`); }

const START = '2026-08-30';
function run(state, start) {
  const sched = E.generate(state, start || START);
  return { sched, a: A.analyze(state, sched, start || START) };
}
function errorsOf(a) { return a.issues.filter((x) => x.level === 'error'); }
function errText(a) { return errorsOf(a).slice(0, 3).map((x) => `${x.pid} ${x.date || ''} ${x.msg}`).join('；'); }
function setDemand(state, stationId, min, max, site) {
  state.shifts.forEach((s) => { state.demand[site || 'neili'][s.code][stationId] = { min, max }; });
}
function spreadOf(arr) { return Math.max.apply(null, arr) - Math.min.apply(null, arr); }

console.log('\n[設定與日期]');
test('預設名單 F1–F5、N1–N9、P1–P4', () => {
  const s = C.createState();
  eq(s.staff.filter((p) => p.group === 'counter').length, 5);
  eq(s.staff.filter((p) => p.group === 'nurse').length, 9);
  eq(s.staff.filter((p) => p.group === 'part').length, 4);
  eq(s.shifts.map((x) => x.code).join(''), 'ABCDE');
  eq(s.demand.neili.A.counter.min, 4);
  eq(s.demand.neili.C.endo.max, 2);
  eq(s.sites.map((x) => x.name).join('、'), '內壢敦仁、青埔敦仁、新陳代謝、康華藥局、睿康檢驗所、康華健康');
  ok(s.staff.every((p) => p.site === 'neili'), '預設同仁都在內壢敦仁');
});
test('舊版資料（單一院所需求）自動移到內壢敦仁', () => {
  const old = C.createState();
  old.demand = { A: { counter: { min: 3, max: 3 } } };
  old.dateDemand = { '2026-09-01': { A: { lab: { min: 1, max: 1 } } } };
  old.staff[0].site = '青埔';
  old.staff[1].site = '本院';
  const s = C.normalize(JSON.parse(JSON.stringify(old)));
  eq(s.demand.neili.A.counter.min, 3);
  eq(s.demand.qingpu.A.counter.min, 2);
  eq(s.dateDemand.neili['2026-09-01'].A.lab.min, 1);
  eq(s.staff[0].site, 'qingpu');
  eq(s.staff[1].site, 'neili');
});
test('Excel 院址「12號」「敦仁12號」對應新陳代謝', () => {
  eq(C.siteIdOf('12號'), 'metab');
  eq(C.siteIdOf('敦仁12號'), 'metab');
  eq(C.siteIdOf('敦仁診所'), 'neili');
  eq(C.siteIdOf('敦仁青埔'), 'qingpu');
  eq(C.siteIdOf('康華藥局'), 'pharmacy');
  eq(C.siteIdOf('睿康檢驗所'), 'ruikang');
  eq(C.siteIdOf('康華健康'), 'health');
});
test('藥師（調劑）、醫檢師（醫檢）為自動排班組別；只有康華藥局／睿康檢驗所預設有需求', () => {
  const s = C.createState();
  eq(s.stations.map((x) => x.name).join('、'), '櫃檯、胃鏡室、檢驗室、跟診、調劑、醫檢');
  eq(E.stationGroup(s, 'dispense'), 'pharmacist');
  eq(E.stationGroup(s, 'medlab'), 'medtech');
  ok(E.isAutoGroup('pharmacist') && E.isAutoGroup('medtech'));
  eq(s.demand.neili.A.dispense.max, 0);
  eq(s.demand.neili.A.medlab.max, 0);
  eq(s.demand.pharmacy.A.dispense.min, 1);
  eq(s.demand.ruikang.A.medlab.max, 2);
  eq(s.demand.pharmacy.A.counter.max, 0, '康華藥局不預設櫃檯');
  eq(s.demand.ruikang.B.counter.max, 0, '睿康檢驗所不預設櫃檯');
  eq(s.demand.health.A.counter.min, 1);
  eq(C.newStaff('pharmacist', 'PH1', 1).skills.join(), 'dispense');
  eq(C.newStaff('medtech', 'MT1', 1).skills.join(), 'medlab');
  ok(!C.newStaff('nurse', 'N99', 99).skills.includes('medlab'));
  eq(C.nextId(s, 'medtech'), 'MT1');
  const imp = require(path.join(__dirname, '../js/importer.js'));
  eq(imp.stationOfLabel('調劑一'), 'dispense');
  eq(imp.stationOfLabel('醫檢'), 'medlab');
  eq(imp.stationOfLabel('檢驗一'), 'lab');
});
test('舊資料：調劑／醫檢原屬護理組、藥師原為手動組別 → 開啟時改為各自組別', () => {
  const old = C.createState();
  old.stations.find((x) => x.id === 'dispense').group = 'nurse';
  old.stations.find((x) => x.id === 'medlab').optIn = true;
  const s = C.normalize(JSON.parse(JSON.stringify(old)));
  eq(s.stations.find((x) => x.id === 'dispense').group, 'pharmacist');
  ok(!('optIn' in s.stations.find((x) => x.id === 'medlab')));
});
test('舊資料：康華藥局／睿康檢驗所櫃檯舊預設 1 人改為 0；使用者改過的不動', () => {
  const old = C.createState();
  old.shifts.forEach((x) => { old.demand.pharmacy[x.code].counter = { min: 1, max: 1 }; old.demand.ruikang[x.code].counter = { min: 1, max: 1 }; });
  old.demand.ruikang.A.counter = { min: 2, max: 2 };
  const s = C.normalize(JSON.parse(JSON.stringify(old)));
  ok(s.shifts.every((x) => s.demand.pharmacy[x.code].counter.max === 0));
  eq(s.demand.ruikang.A.counter.min, 2);
  eq(s.demand.ruikang.B.counter.min, 1);
});
test('藥師排在康華藥局、醫檢師排在睿康檢驗所，各自排到調劑／醫檢且符合法規', () => {
  const s = C.createState();
  ['PH1', 'PH2'].forEach((id, i) => s.staff.push(Object.assign(C.newStaff('pharmacist', id, i + 1), { site: 'pharmacy' })));
  ['MT1', 'MT2', 'MT3'].forEach((id, i) => s.staff.push(Object.assign(C.newStaff('medtech', id, i + 1), { site: 'ruikang' })));
  const sched = E.generate(s, START);
  const at = (pid, sid) => E.periodDates(START).reduce((n, d) => {
    const e = sched[pid][d];
    return n + E.workCodes(e).filter((c) => e.posts && e.posts[c] && e.posts[c].station === sid).length;
  }, 0);
  ok(at('PH1', 'dispense') > 30, `PH1 調劑 ${at('PH1', 'dispense')} 節`);
  ok(at('MT1', 'medlab') > 30, `MT1 醫檢 ${at('MT1', 'medlab')} 節`);
  const all = A.analyzeSites(s, sched, START);
  eq(all.pharmacy.summary.errors, 0, errText(all.pharmacy));
  eq(all.ruikang.summary.errors, 0, errText(all.ruikang));
  ok(all.pharmacy.capacity.groups.pharmacist.staff === 2);
  ok(all.ruikang.fairness.medtech, '醫檢師有公平度');
  const wk = E.periodDates(START).slice(1, 6);
  ok(wk.every((d) => all.ruikang.coverage.cells[`${d}|A|medlab`].n >= 1), '平日早班醫檢至少 1 人');
});
test('重新匯入 Excel 保留藥師與醫檢師', () => {
  const s = C.createState();
  s.staff.push(Object.assign(C.newStaff('pharmacist', 'PH1', 1), { name: '林藥師', site: 'pharmacy' }));
  s.staff.push(Object.assign(C.newStaff('medtech', 'MT1', 1), { name: '張醫檢', site: 'ruikang' }));
  require(path.join(__dirname, '../js/importer.js')).applyToState(s, require(path.join(__dirname, '../js/importer.js')).parseRows(sampleRows(), {}), {});
  ok(s.staff.some((p) => p.id === 'PH1') && s.staff.some((p) => p.id === 'MT1'));
});
test('舊資料只有三院所時自動補上新院所與需求', () => {
  const old = C.createState();
  old.sites = old.sites.slice(0, 3);
  ['pharmacy', 'ruikang', 'health'].forEach((id) => { delete old.demand[id]; delete old.dateDemand[id]; delete old.weekDemand[id]; });
  const s = C.normalize(JSON.parse(JSON.stringify(old)));
  eq(s.sites.length, 6);
  eq(s.demand.ruikang.A.medlab.max, 2);
  eq(s.demand.pharmacy.A.clinic.max, 0);
});
const r2 = (x) => Math.round(x * 100) / 100;
function counterCAt1730(s) { s.shifts.find((x) => x.code === 'C').groupTimes = { counter: { start: '17:30', end: '21:30' } }; return s; }
test('班別時數：C 17:50–21:30 全員一致（3h40m、BC 7.67h）', () => {
  const s = C.createState(), sm = E.shiftMap(s), cm = E.shiftMap(s, 'counter'), nm = E.shiftMap(s, 'nurse');
  eq(E.shiftHours(sm.A), 4); eq(r2(E.shiftHours(nm.C)), 3.67); eq(r2(E.shiftHours(cm.C)), 3.67);
  eq(cm.C.start, '17:50'); eq(nm.C.start, '17:50'); eq(nm.C.end, '21:30');
  eq(E.spanOf(nm, ['A', 'B']).hours, 8); eq(r2(E.spanOf(nm, ['B', 'C']).hours), 7.67);
});
test('舊版預設 C 班（護理 18:00／櫃檯 17:30）自動改為 17:50–21:30；自訂過的不動', () => {
  const old = counterCAt1730(C.createState());
  old.shifts.find((x) => x.code === 'C').start = '18:00';
  const c = C.normalize(JSON.parse(JSON.stringify(old))).shifts.find((x) => x.code === 'C');
  eq(c.start, '17:50'); ok(!c.groupTimes.counter); eq(c.groupTimes.doctor.start, '18:00');
  const custom = C.createState();
  custom.shifts.find((x) => x.code === 'C').start = '18:10';
  eq(C.normalize(JSON.parse(JSON.stringify(custom))).shifts.find((x) => x.code === 'C').start, '18:10');
});
test('櫃檯另訂 C 時間時：兼職支援櫃檯用櫃檯時間，支援跟診用一般時間', () => {
  const s = counterCAt1730(C.createState());
  eq(E.entrySpan(s, { kind: 'work', shifts: ['C'], posts: { C: { station: 'counter' } } }, 'part').hours, 4);
  eq(r2(E.entrySpan(s, { kind: 'work', shifts: ['C'], posts: { C: { station: 'clinic' } } }, 'part').hours), 3.67);
});
test('醫師依門診時間計時（早 08:30、午 14:00、晚 18:00），晚診接隔日早診剛好 11 小時', () => {
  const s = C.createState(), dm = E.shiftMap(s, 'doctor');
  eq(dm.A.start, '08:30'); eq(dm.B.start, '14:00'); eq(dm.C.start, '18:00'); eq(dm.E.end, '17:30');
  eq(E.spanOf(dm, ['A', 'B', 'C']).hours, 10.5);
  ok(E.restGapMin(dm, ['C'], ['A']) >= 660);
  const old = C.createState();
  old.shifts.forEach((x) => { delete x.groupTimes; });
  eq(C.normalize(JSON.parse(JSON.stringify(old))).shifts.find((x) => x.code === 'B').groupTimes.doctor.start, '14:00', '舊資料補上醫師門診時間');
});
test('C 班下班到隔日 A 班不足 11 小時', () => {
  const s = C.createState(), sm = E.shiftMap(s);
  ok(E.restGapMin(sm, ['C'], ['A']) < 660);
  ok(E.restGapMin(sm, ['C'], ['B']) >= 660);
  ok(E.isLateCodes(s, ['B', 'C'], sm));
});
test('期別對齊與星期', () => {
  eq(E.alignPeriod('2026-08-30', '2026-10-06'), '2026-09-27');
  eq(E.dow('2026-08-30'), 0);
  eq(E.periodDates(START).length, 28);
});
test('nextId 自動遞增', () => {
  const s = C.createState();
  eq(C.nextId(s, 'nurse'), 'N10');
  eq(C.nextId(s, 'part'), 'P5');
});

console.log('\n[預設需求排班]');
const base = C.createState();
const r0 = run(base);
test('零法規違規（工時、例假、11 小時、七休一、單日上限）', () => {
  eq(errorsOf(r0.a).length, 0, errText(r0.a));
});
test('正職：每人例假 4 天、例假＋休息日 ≥ 8 天、工時 ≤ 160h', () => {
  r0.a.metrics.filter((m) => m.group !== 'part').forEach((m) => {
    eq(m.regular, 4, `${m.id} 例假`);
    ok(m.regular + m.rest >= 8, `${m.id} 休假 ${m.regular + m.rest}`);
    ok(m.hours <= 160, `${m.id} 工時 ${m.hours}`);
  });
});
test('正職（櫃檯＋護理）四週工時皆在 152–160h，連續 8 期', () => {
  for (let k = 0; k < 8; k++) {
    const st = E.addDays(START, 28 * k);
    const { a } = run(C.createState(), st);
    a.metrics.filter((m) => m.group !== 'part').forEach((m) => {
      ok(m.hours >= 152 && m.hours <= 160, `${st} ${m.id} ${m.hours}h`);
    });
  }
});
test('護理週五晚班不接週六單節（零單節日）', () => {
  r0.a.metrics.filter((m) => m.group === 'nurse').forEach((m) => eq(m.single, 0, `${m.id} 單節`));
});
test('標準班別：醫務櫃檯、護理只排 AB／BC／DE，連續 8 期零 AC、零單節', () => {
  eq(C.createState().settings.standardGroups.join(), 'counter,nurse,pharmacist');
  for (let k = 0; k < 8; k++) {
    const st = E.addDays(START, 28 * k);
    const { a } = run(C.createState(), st);
    a.metrics.filter((m) => m.group !== 'part').forEach((m) => {
      eq(m.gap, 0, `${st} ${m.id} AC`);
      eq(m.single, 0, `${st} ${m.id} 單節`);
    });
  }
});
test('標準班別：藥師也只排相鄰兩節；取消勾選的組別恢復可排 AC', () => {
  const s = C.createState();
  ['PH1', 'PH2', 'PH3'].forEach((id, i) => s.staff.push(Object.assign(C.newStaff('pharmacist', id, i + 1), { site: 'pharmacy' })));
  s.shifts.forEach((x) => { s.demand.pharmacy[x.code].dispense = { min: 2, max: 2 }; });
  const sched = E.generate(s, START);
  const ph = A.analyzeSites(s, sched, START).pharmacy;
  ph.metrics.forEach((m) => { eq(m.gap, 0, `${m.id} AC`); eq(m.single, 0, `${m.id} 單節`); });
  eq(ph.summary.errors, 0, errText(ph));
  s.settings.standardGroups = ['nurse', 'pharmacist'];
  ok(run(s).a.metrics.some((m) => m.group === 'counter' && m.gap > 0), '櫃檯取消標準班別後應可排 AC');
  ok(E.isStandardGroup(s, 'nurse') && !E.isStandardGroup(s, 'counter') && !E.isStandardGroup(s, 'medtech'));
});
test('標準班別清單：平日 AB、BC，週六 DE', () => {
  const s = C.createState();
  eq(E.standardCombos(s, E.dayShifts(s, '2026-08-31')).map((c) => c.codes.join('')).join(), 'AB,BC');
  eq(E.standardCombos(s, E.dayShifts(s, '2026-09-05')).map((c) => c.codes.join('')).join(), 'DE');
});
test('各組工時差距 ≤ 8h；晚班差距 櫃檯 ≤ 5、護理 ≤ 8 次', () => {
  [['counter', 5], ['nurse', 8]].forEach(([g, lim]) => {
    const ms = r0.a.metrics.filter((m) => m.group === g);
    ok(spreadOf(ms.map((m) => m.hours)) <= 8, `${g} 工時差 ${spreadOf(ms.map((m) => m.hours))}`);
    ok(spreadOf(ms.map((m) => m.late)) <= lim, `${g} 晚班差 ${spreadOf(ms.map((m) => m.late))}`);
  });
});
test('護理崗位輪調：胃鏡／檢驗／跟診每人差距 ≤ 3', () => {
  const ms = r0.a.metrics.filter((m) => m.group === 'nurse');
  ['endo', 'lab', 'clinic'].forEach((sid) => {
    const v = ms.map((m) => m.stations[sid] || 0);
    ok(spreadOf(v) <= 3, `${sid} 差距 ${spreadOf(v)}`);
    ok(Math.min.apply(null, v) > 0, `${sid} 有人未輪到`);
  });
});
test('兼職不超過每週可支援節數', () => {
  eq(r0.a.issues.filter((x) => x.rule === 'ptQuota').length, 0);
});
test('櫃檯座位 1–4 每節不重複', () => {
  r0.a.coverage.gaps.length; // 觸發計算
  Object.values(r0.a.coverage.cells).filter((c) => c.station === 'counter').forEach((c) => {
    const seats = c.people.map((p) => p.seat).filter((x) => x > 0);
    eq(new Set(seats).size, seats.length, `${c.date} ${c.code} 座位重複`);
    ok(seats.every((x) => x >= 1 && x <= 4), `${c.date} ${c.code} 座位超出`);
  });
});
test('預設需求超出人力：缺口 ≥ 產能下限並如實列出', () => {
  ok(!r0.a.capacity.feasible, '應判定人力不足');
  ok(r0.a.coverage.totalShort >= r0.a.capacity.netShort, `${r0.a.coverage.totalShort} < ${r0.a.capacity.netShort}`);
  ok(r0.a.coverage.gaps.length > 0);
});

console.log('\n[可行需求 → 零缺口]');
test('櫃檯每節 2 人、護理 1/1/2：零缺口、零違規', () => {
  const s = C.createState();
  setDemand(s, 'counter', 2, 2);
  setDemand(s, 'endo', 1, 2); setDemand(s, 'lab', 1, 3); setDemand(s, 'clinic', 2, 4);
  const { a } = run(s);
  ok(A.capacity(s, START).feasible);
  eq(errorsOf(a).length, 0, errText(a));
  eq(a.coverage.gaps.length, 0, `缺口 ${a.coverage.gaps.slice(0, 3).map((c) => c.date + c.code + c.station).join(',')}`);
});
test('櫃檯每節 3 人＋兼職 5 人：零違規', () => {
  const s = C.createState();
  setDemand(s, 'counter', 3, 3);
  s.staff.push(C.newStaff('part', 'P5', 5));
  const { a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
});

console.log('\n[不同期別]');
['2026-09-27', '2026-10-25', '2026-11-22', '2026-10-06'].forEach((st) => {
  test(`期別起日 ${st}：零違規`, () => {
    const { a } = run(C.createState(), st);
    eq(errorsOf(a).length, 0, errText(a));
  });
});

console.log('\n[時段、人員可增修刪]');
test('C 改 17:30：零違規、工時 ≤ 160', () => {
  const s = C.createState();
  s.shifts.find((x) => x.code === 'C').start = '17:30';
  const { a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
});
test('櫃檯另訂 C 17:30：零違規；取消後回到 17:50', () => {
  const s = counterCAt1730(C.createState());
  eq(E.shiftMap(s, 'counter').C.start, '17:30');
  eq(errorsOf(run(s).a).length, 0, errText(run(s).a));
  delete s.shifts.find((x) => x.code === 'C').groupTimes;
  eq(E.shiftMap(s, 'counter').C.start, '17:50');
  const { a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
});
test('刪除 E 班、新增週六晚班 F：零違規且 F 只出現在週六', () => {
  const s = C.createState();
  s.shifts = s.shifts.filter((x) => x.code !== 'E');
  s.shifts.push({ code: 'F', name: '週六晚班', start: '14:00', end: '17:00', days: [6] });
  C.ensureDemand(s);
  ok(!s.demand.neili.E && !s.demand.metab.E, 'E 需求應移除');
  const { sched, a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
  Object.keys(sched).forEach((pid) => Object.keys(sched[pid]).forEach((d) => {
    if (E.workCodes(sched[pid][d]).includes('F')) eq(E.dow(d), 6);
  }));
});
test('新增 N10、刪除 F5、停用 P4：零違規', () => {
  const s = C.createState();
  s.staff.push(C.newStaff('nurse', C.nextId(s, 'nurse'), 10));
  s.staff = s.staff.filter((p) => p.id !== 'F5');
  s.staff.find((p) => p.id === 'P4').active = false;
  const { sched, a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
  ok(sched.N10 && !sched.F5 && !sched.P4);
});
test('關閉 AC：不出現 AC', () => {
  const s = C.createState();
  s.settings.allowGapPair = false;
  const { a } = run(s);
  eq(a.summary.gap, 0);
  eq(errorsOf(a).length, 0, errText(a));
});
test('兼職限定時段（P1 只能 A/D）被遵守', () => {
  const s = C.createState();
  s.staff.find((p) => p.id === 'P1').avail = ['A', 'D'];
  const { sched } = run(s);
  Object.values(sched.P1).forEach((e) => E.workCodes(e).forEach((c) => ok(['A', 'D'].includes(c), c)));
});

console.log('\n[隨機壓力測試]');
test('60 組隨機人數／需求／期別：皆零違規', () => {
  let seed = 20261006;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 60; k++) {
    const s = C.createState();
    const nc = 3 + rnd(6), nn = 4 + rnd(8), np = rnd(6);
    s.staff = [];
    for (let i = 1; i <= nc; i++) s.staff.push(C.newStaff('counter', 'F' + i, i));
    for (let i = 1; i <= nn; i++) s.staff.push(C.newStaff('nurse', 'N' + i, i));
    for (let i = 1; i <= np; i++) s.staff.push(C.newStaff('part', 'P' + i, i));
    s.stations.forEach((x) => { const mn = rnd(5); setDemand(s, x.id, mn, mn + rnd(3)); });
    s.settings.allowGapPair = rnd(2) === 0;
    const cs = s.shifts.find((x) => x.code === 'C');
    if (rnd(2)) cs.start = '17:30';
    if (rnd(3) === 0) cs.groupTimes = { counter: { start: '18:30', end: '21:30' } };
    const st = E.addDays(START, 28 * rnd(12) + (rnd(3) === 0 ? rnd(7) : 0));
    const { a } = run(s, st);
    eq(errorsOf(a).length, 0, `#${k} ${st} F${nc} N${nn} P${np}：${errText(a)}`);
  }
});

console.log('\n[違規偵測]');
function blankSched(state) {
  const sched = {};
  E.activeStaff(state).forEach((p) => { sched[p.id] = {}; });
  return sched;
}
test('C 班後隔日 A 班 → 11 小時違規', () => {
  const s = C.createState(), sched = blankSched(s);
  sched.F1['2026-08-31'] = { kind: 'work', shifts: ['C'], posts: {} };
  sched.F1['2026-09-01'] = { kind: 'work', shifts: ['A'], posts: {} };
  ok(A.legalChecks(s, sched, START).some((x) => x.rule === 'rest' && x.pid === 'F1'));
});
test('連上 7 天 → 七休一違規；週日排班 → 例假違規', () => {
  const s = C.createState(), sched = blankSched(s);
  E.periodDates(START).slice(1, 8).forEach((d) => { sched.N1[d] = { kind: 'work', shifts: [E.dayShifts(s, d)[0] ? E.dayShifts(s, d)[0].code : 'A'], posts: {} }; });
  const iss = A.legalChecks(s, sched, START);
  ok(iss.some((x) => x.rule === 'consecutive' && x.pid === 'N1'));
  ok(iss.some((x) => x.rule === 'restDow' && x.pid === 'N1'));
});
test('單日 ABC → 超過 2 節與 10 小時', () => {
  const s = C.createState(), sched = blankSched(s);
  sched.F2['2026-08-31'] = { kind: 'work', shifts: ['A', 'B', 'C'], posts: {} };
  const iss = A.legalChecks(s, sched, START);
  ok(iss.some((x) => x.rule === 'sessions'));
  ok(iss.some((x) => x.rule === 'daily'));
});
test('週六排 C 班 → 無效班別', () => {
  const s = C.createState(), sched = blankSched(s);
  sched.F3['2026-09-05'] = { kind: 'work', shifts: ['C'], posts: {} };
  ok(A.legalChecks(s, sched, START).some((x) => x.rule === 'invalidShift'));
});

console.log('\n[匯出]');
test('CSV 含 BOM、每人一列', () => {
  const csv = X.buildCSV(base, r0.sched, START);
  ok(csv.charCodeAt(0) === 0xfeff);
  eq(csv.trim().split('\r\n').length, E.activeStaff(base).length + 1);
});
test('崗位明細 CSV 與 TSV', () => {
  ok(X.buildPostCSV(base, r0.sched, START).includes('胃鏡室'));
  ok(X.buildTSV(base, r0.sched, START).split('\n')[0].includes('\t'));
});
test('LINE 通報含櫃檯與各崗位、C 班 17:50-21:30（櫃檯另訂時分列兩組），週日顯示休診', () => {
  const t = X.lineNotice(base, r0.sched, '2026-08-31');
  ok(t.includes('櫃檯') && t.includes('胃鏡室') && t.includes('A 班'));
  ok(t.includes('C 班 17:50-21:30'), t.split('\n').find((x) => x.includes('C 班')));
  const t2 = X.lineNotice(counterCAt1730(C.createState()), r0.sched, '2026-08-31');
  ok(t2.includes('護理 17:50-21:30') && t2.includes('櫃檯 17:30-21:30'), t2.split('\n').find((x) => x.includes('C 班')));
  ok(X.lineNotice(base, r0.sched, '2026-08-30').includes('休診'));
});

console.log('\n[預假、指定班、逐日需求]');
test('全日預假 → 當天排休且算入當週休息日（不額外多休）', () => {
  const s = C.createState();
  s.requests = { '2026-09-02': { N1: { off: true, note: '預假' } } };
  const { sched, a } = run(s);
  eq(sched.N1['2026-09-02'].kind, '休');
  ok(sched.N1['2026-09-02'].req, '應標記為預假');
  const week = E.periodDates(START).slice(0, 7).filter((d) => sched.N1[d] && sched.N1[d].kind === '休').length;
  eq(week, 1, '第一週休息日');
  eq(errorsOf(a).length, 0, errText(a));
});
test('半日預假（午休）→ 當天不排該節', () => {
  const s = C.createState();
  s.requests = { '2026-09-01': { N2: { block: ['B'] } }, '2026-09-03': { F2: { block: ['A'] } } };
  const { sched } = run(s);
  ok(!E.workCodes(sched.N2['2026-09-01']).includes('B'));
  ok(!E.workCodes(sched.F2['2026-09-03']).includes('A'));
});
test('指定班保留原崗位；固定人員其他日不被系統排班', () => {
  const s = C.createState();
  s.staff.push(Object.assign(C.newStaff('nurse', 'N10', 10), { name: '固定', fixed: true }));
  s.locks = {
    '2026-09-01': { F1: { kind: 'work', shifts: ['B'], posts: { B: { station: 'counter', label: '指定櫃' } } } },
    '2026-09-02': { N10: { kind: 'work', shifts: ['A', 'B'], posts: { A: { station: 'lab' }, B: { station: 'endo' } } } },
  };
  const { sched, a } = run(s);
  eq(sched.F1['2026-09-01'].shifts.join(''), 'B');
  ok(sched.F1['2026-09-01'].locked);
  eq(X.stationLabel(s, sched.F1['2026-09-01'].posts.B), '指定櫃');
  eq(E.periodDates(START).filter((d) => E.workCodes(sched.N10[d]).length).length, 1, '固定人員只上指定的一天');
  eq(sched.N10['2026-09-02'].posts.A.station, 'lab');
  ok(a.metrics.find((m) => m.id === 'N10').fixed);
});
test('逐日需求優先於班別預設；未列出的崗位視為 0', () => {
  const s = C.createState();
  s.dateDemand.neili = { '2026-09-01': { A: { counter: { min: 2, max: 2 } } } };
  eq(E.demandOf(s, 'A', 'counter', '2026-09-01').min, 2);
  eq(E.demandOf(s, 'A', 'lab', '2026-09-01').min, 0);
  eq(E.demandOf(s, 'A', 'counter', '2026-09-02').min, 4);
  const { a } = run(s);
  eq(a.coverage.cells['2026-09-01|A|counter'].min, 2);
});

console.log('\n[Excel 匯入]');
const I = require(path.join(__dirname, '../js/importer.js'));
function sampleRows() {
  const W = 46, row = (cells) => { const r = Array(W).fill(''); Object.entries(cells).forEach(([k, v]) => { r[k] = v; }); return r; };
  const days = [3, 6, 9, 12, 15, 18];
  const dateRow = { 0: '日期' }, dowRow = { 0: '星期' }, shiftRow = { 0: '班別' };
  days.forEach((c, i) => {
    dateRow[c] = new Date(2026, 7, 31 + i);
    dowRow[c] = '星期' + '一二三四五六'[i];
    ['早', '午', '晚'].forEach((lab, k) => { if (i < 5 || k < 2) shiftRow[c + k] = lab; });
  });
  Object.assign(dateRow, { 20: '王小美', 21: '李小華', 22: '', 23: '陳大文', 24: '林志玲' });
  return [
    row(dowRow), row(dateRow), row({ 0: '行事曆' }),
    row({ 0: '醫務', 3: '志玲休' }), row({ 0: '護理', 3: '小美晚休' }),
    row(shiftRow),
    row({ 0: '1診', 3: '張醫師' }),
    row({ 0: '2診', 1: 'GI', 2: '青埔', 3: '李醫師', 5: '李醫師-八德', 6: '李醫師-請假' }),
    row({ 0: '總合', 3: 3 }), row({ 0: '可休', 1: 2 }), row({ 0: '醫務', 3: 1 }), row({ 0: '可休', 1: 3 }), row({ 0: '護理', 3: 2 }),
    row({ 0: '櫃臺一', 3: '醫務', 4: '醫務', 18: '醫務' }),
    row({ 0: '檢驗一', 3: '護理', 4: '王小美', 5: '支援' }),
    row({ 0: '3診', 3: '護理', 4: '亘' }),
    row({ 0: '鏡檢一線', 3: '張醫師-請假' }),
  ];
}
test('行事曆註記解析：休／午休／晚休／國定假日補休', () => {
  const t = I.parseLeaveCell('(毓慈休)卿午休.鈴晚休\n郁淇10/26');
  eq(t.length, 4);
  ok(t[0].off && t[0].who === '毓慈');
  eq(t[1].block, 1);
  eq(t[2].block, 2);
  ok(t[3].off && /國定假日/.test(t[3].note));
});
test('解析週區塊：日期、組別、需求、指定、支援、外部人力、預假', () => {
  const p = I.parseRows(sampleRows(), {});
  eq(p.weeks.length, 1);
  eq(p.dates[0], '2026-08-31');
  eq(p.dates.length, 6);
  eq(p.staffNames.find((x) => x.name === '林志玲').side, 'counter');
  eq(p.staffNames.find((x) => x.name === '王小美').side, 'nurse');
  eq(p.poolSize.counter, 2);
  eq(p.poolSize.nurse, 3);
  eq(p.cells.filter((x) => x.kind === 'pool' && x.side === 'counter').length, 3);
  eq(p.cells.filter((x) => x.kind === 'pool' && x.side === 'nurse').length, 2);
  eq(p.cells.filter((x) => x.kind === 'named').length, 1);
  eq(p.support, 1);
  eq(p.external['亘'], 1);
  ok(!p.cells.some((x) => /張醫師/.test(x.name || '')), '醫師請假不列需求');
  eq(p.leaves.find((x) => x.name === '林志玲').off, true);
  eq(p.leaves.find((x) => x.name === '王小美').block, 2);
});
test('寫入系統：逐日需求、指定班、預假，並可直接排班', () => {
  const s = C.createState();
  const sum = I.applyToState(s, I.parseRows(sampleRows(), {}), {});
  eq(sum.periods[0], '2026-08-30');
  const d = '2026-08-31', dd = s.dateDemand.neili;
  eq(dd[d].A.counter.min, 1);
  eq(dd[d].A.lab.min, 1);
  eq(dd[d].A.clinic.min, 1);
  eq(dd[d].B.lab.min, 1);
  eq(dd[d].C.lab.min, 1);
  eq(dd['2026-09-05'].D.counter.min, 1);
  ok(!s.dateDemand.metab[d], 'Excel 沒有的院所不寫入逐日需求');
  const mei = s.staff.find((p) => p.name === '王小美'), ling = s.staff.find((p) => p.name === '林志玲');
  eq(mei.group, 'part');
  ok(mei.fixed);
  eq(s.locks[d][mei.id].shifts.join(''), 'B');
  ok(s.requests[d][ling.id].off);
  const { sched } = run(s, sum.periods[0]);
  eq(sched[ling.id][d].kind, '休');
  eq(sched[mei.id][d].posts.B.station, 'lab');
});

console.log('\n[三院所分別排班]');
function threeSites() {
  const s = C.createState();
  ['F4', 'F5', 'N7', 'N8', 'N9'].forEach((id) => { s.staff.find((p) => p.id === id).site = 'qingpu'; });
  s.staff.push(Object.assign(C.newStaff('counter', 'F6', 6), { site: 'metab' }));
  s.staff.push(Object.assign(C.newStaff('nurse', 'N10', 10), { site: 'metab' }));
  s.staff.push(Object.assign(C.newStaff('nurse', 'N11', 11), { site: 'metab' }));
  return s;
}
test('院所視圖只含該院同仁與該院需求', () => {
  const s = threeSites();
  const q = E.siteView(s, 'qingpu');
  eq(E.activeStaff(q).map((p) => p.id).join(','), 'F4,F5,N7,N8,N9');
  eq(E.demandOf(q, 'A', 'counter').min, 2);
  eq(E.demandOf(E.siteView(s, 'metab'), 'A', 'endo').max, 0);
  eq(E.demandOf(s, 'A', 'counter').min, 4, '完整 state 以第一院所為準');
});
test('同仁只排在自己院所的崗位，各院覆蓋各自計算', () => {
  const s = threeSites();
  const sched = E.generate(s, START);
  ok(Object.keys(sched).length === s.staff.length, '三院同仁都有班表');
  const all = A.analyzeSites(s, sched, START);
  eq(Object.keys(all).join(','), 'neili,qingpu,metab');
  Object.entries(all).forEach(([site, a]) => {
    eq(errorsOf(a).length, 0, `${site}：${errText(a)}`);
    const ids = new Set(E.activeStaff(E.siteView(s, site)).map((p) => p.id));
    Object.values(a.coverage.cells).forEach((c) => c.people.forEach((p) => ok(ids.has(p.id), `${p.id} 不屬於 ${site}`)));
  });
  const cnt = (site, d, code) => Object.values(all[site].coverage.cells).filter((c) => c.date === d && c.code === code && c.station === 'counter')[0].n;
  ok(cnt('qingpu', '2026-09-01', 'A') <= 2, '青埔櫃檯不超過該院上限');
});
test('沒有同仁的院所略過，不產生缺口', () => {
  const s = C.createState();
  const all = A.analyzeSites(s, E.generate(s, START), START);
  eq(Object.keys(all).join(','), 'neili');
});
test('CSV 與崗位明細含院所欄', () => {
  const s = threeSites();
  const sched = E.generate(s, START);
  ok(X.buildCSV(s, sched, START).split('\r\n')[0].includes('院所'));
  const post = X.buildPostCSV(s, sched, START);
  ok(post.includes('青埔敦仁') && post.includes('新陳代謝'));
  ok(X.lineNotice(s, sched, '2026-08-31').includes('■ 新陳代謝'));
});

console.log('\n[醫師、營養師、衛教師（手動填班）]');
test('手動組別：醫師、營養師、衛教師，編號 DR／RD／HE；藥師 PH 改為自動排班', () => {
  eq(C.GROUPS.filter((g) => g.manual).map((g) => g.name).join('、'), '醫師、營養師、衛教師');
  const s = C.createState();
  eq(C.nextId(s, 'doctor'), 'DR1');
  s.staff.push(C.newStaff('doctor', 'DR1', 1));
  eq(C.nextId(s, 'doctor'), 'DR2');
  eq(C.nextId(s, 'pharmacist'), 'PH1');
});
function withDoctor() {
  const s = C.createState();
  s.staff.push(Object.assign(C.newStaff('doctor', 'DR1', 1), { name: '王醫師' }));
  s.staff.push(Object.assign(C.newStaff('dietitian', 'RD1', 1), { name: '陳營養師' }));
  return s;
}
test('一鍵排班不排手動組別，重排時保留已填的班', () => {
  const s = withDoctor();
  const first = E.generate(s, START);
  ok(!first.DR1 && !first.RD1, '手動組別不自動排');
  first.DR1 = { '2026-08-31': { kind: 'work', shifts: ['A', 'B'], posts: {} } };
  const again = E.generate(s, START, first);
  eq(again.DR1['2026-08-31'].shifts.join(''), 'AB');
  ok(again.F1, '自動組別照常重排');
});
test('手動組別未填班不檢核；填了班照算工時並檢核 11 小時', () => {
  const s = withDoctor();
  const sched = E.generate(s, START);
  ok(!A.legalChecks(s, sched, START).some((x) => x.pid === 'DR1'), '未填班不應有違規');
  const cThenA = { '2026-08-31': { kind: 'work', shifts: ['C'], posts: {} }, '2026-09-01': { kind: 'work', shifts: ['A'], posts: {} } };
  sched.RD1 = cThenA;
  ok(A.legalChecks(s, sched, START).some((x) => x.pid === 'RD1' && x.rule === 'rest'), '營養師 C 21:30 → 隔日 A 08:00 不足 11 小時');
  eq(A.personMetrics(s, sched, START, s.staff.find((p) => p.id === 'RD1')).hours, 7.67);
  sched.DR1 = cThenA;
  ok(!A.legalChecks(s, sched, START).some((x) => x.pid === 'DR1' && x.rule === 'rest'), '醫師晚診 21:30 → 隔日早診 08:30 剛好 11 小時');
  eq(A.personMetrics(s, sched, START, s.staff.find((p) => p.id === 'DR1')).hours, 7);
});
test('醫師只計工時與節數，不做勞基法檢核（早午晚三診也不列違規）', () => {
  const s = withDoctor();
  const sched = E.generate(s, START);
  sched.DR1 = {};
  E.periodDates(START).slice(1, 7).forEach((d) => { sched.DR1[d] = { kind: 'work', shifts: E.dow(d) === 6 ? ['D', 'E'] : ['A', 'B', 'C'], posts: {} }; });
  ok(!A.legalChecks(s, sched, START).some((x) => x.pid === 'DR1'));
  const m = A.personMetrics(s, sched, START, s.staff.find((p) => p.id === 'DR1'));
  eq(m.sessions, 17); eq(m.hours, 59.5);
});
test('手動組別不計入崗位覆蓋；LINE 通報另列醫師', () => {
  const s = withDoctor();
  const sched = E.generate(s, START);
  sched.DR1 = { '2026-08-31': { kind: 'work', shifts: ['A'], posts: {} } };
  const cov = A.coverage(s, sched, START);
  ok(!Object.values(cov.cells).some((c) => c.people.some((p) => p.id === 'DR1')));
  ok(X.lineNotice(s, sched, '2026-08-31').includes('醫師：王醫師'));
  eq(X.cellText(s, sched.DR1['2026-08-31'], true), 'A');
});
test('匯入 Excel 保留醫師等名單與已填的班', () => {
  const s = withDoctor();
  s.schedules['2026-08-30'] = { DR1: { '2026-08-31': { kind: 'work', shifts: ['A'], posts: {} } } };
  I.applyToState(s, I.parseRows(sampleRows(), {}), {});
  ok(s.staff.some((p) => p.id === 'DR1') && s.staff.some((p) => p.id === 'RD1'));
  eq(s.schedules['2026-08-30'].DR1['2026-08-31'].shifts.join(''), 'A');
});
test('匯入 Excel 醫師名單與門診班：院所、科別、外診備註、請假', () => {
  const p = I.parseRows(sampleRows(), {});
  eq(p.doctors.join('、'), '張醫師、李醫師');
  eq(p.doctorCells.length, 4);
  ok(p.doctorCells.find((x) => x.note === '請假').leave);
  const s = C.createState();
  const sum = I.applyToState(s, p, {});
  const zhang = s.staff.find((x) => x.name === '張醫師'), li = s.staff.find((x) => x.name === '李醫師');
  eq(zhang.group, 'doctor'); eq(zhang.id, 'DR1'); eq(zhang.site, 'neili');
  eq(li.id, 'DR2'); eq(li.site, 'qingpu'); eq(li.title, '腸胃肝膽科醫師');
  eq(sum.doctors.length, 2); eq(sum.doctorSessions, 3);
  const sc = s.schedules['2026-08-30'];
  eq(sc.DR2['2026-08-31'].shifts.join(''), 'AC');
  eq(sc.DR2['2026-08-31'].note, 'C 八德');
  eq(sc.DR2['2026-09-01'].kind, '休', '請假當天標休');
  eq(sc.DR1['2026-09-02'].kind, '休', '沒門診的日子標休');
  eq(sc.DR1['2026-08-30'].kind, '例', '週日標例');
  ok(!sc.DR1['2026-09-06'], 'Excel 沒涵蓋的週不填');
  const sched = E.generate(s, '2026-08-30', sc);
  eq(sched.DR2['2026-08-31'].shifts.join(''), 'AC', '重排保留醫師門診');
  ok(sched.F1, '其他同仁照常排班');
  const again = I.applyToState(s, I.parseRows(sampleRows(), {}), {});
  eq(s.staff.filter((x) => x.group === 'doctor').length, 2, '重複匯入不會新增重複醫師');
  eq(again.doctors[1].id, 'DR2');
});

console.log('\n[需求標準表、希望休假、希望班別、預排建議]');
test('星期需求標準：優先於班別預設；Excel 逐日需求仍最優先', () => {
  const s = C.createState();
  s.weekDemand.neili = { 3: { A: { counter: { min: 2, max: 2 } } } };
  eq(E.demandOf(s, 'A', 'counter', '2026-09-02').min, 2, '週三另設');
  eq(E.demandOf(s, 'A', 'counter', '2026-09-01').min, 4, '週二沿用預設');
  eq(E.demandOf(s, 'A', 'lab', '2026-09-02').min, s.demand.neili.A.lab.min, '週三未另設的崗位沿用預設');
  ok(E.hasWeekOverride(s, 'A', 'counter', 3));
  ok(!E.hasWeekOverride(s, 'A', 'counter', 2));
  s.dateDemand.neili = { '2026-09-02': { A: { counter: { min: 1, max: 1 } } } };
  eq(E.demandOf(s, 'A', 'counter', '2026-09-02').min, 1);
  eq(E.weekdayDemand(s, 'A', 'counter', 3).min, 2, '標準表顯示不受逐日需求影響');
  s.dateDemand.neili = {};
  const { a } = run(s);
  eq(a.coverage.cells['2026-09-02|A|counter'].min, 2);
});
test('舊資料沒有 weekDemand／wishes 時自動補上', () => {
  const old = C.createState();
  delete old.weekDemand; delete old.wishes;
  const s = C.normalize(JSON.parse(JSON.stringify(old)));
  ok(s.weekDemand.neili && s.weekDemand.qingpu, '各院所都有星期需求');
  eq(JSON.stringify(s.wishes), '{}');
});
test('希望班別：在需求範圍內優先排入，且不違反法規', () => {
  const s = C.createState();
  const wishes = {};
  const plan = [['N1', 'AB'], ['N2', 'BC'], ['F1', 'AB'], ['F3', 'BC']];
  E.periodDates(START).slice(1, 6).forEach((d) => {
    wishes[d] = {};
    plan.forEach(([pid, codes]) => { wishes[d][pid] = { shifts: codes.split('') }; });
  });
  s.wishes = wishes;
  const { sched, a } = run(s);
  const r = A.wishReport(s, sched, START);
  eq(r.wish, 20);
  ok(r.exact >= 16, `完全符合 ${r.exact}/20`);
  eq(errorsOf(a).length, 0, errText(a));
});
test('人力不足時，只上單節的希望不會擴大缺口（改排含該節的兩節）', () => {
  const s = C.createState();
  s.wishes = {};
  E.periodDates(START).forEach((d) => {
    if (E.dow(d) < 1 || E.dow(d) > 5) return;
    s.wishes[d] = { N5: { shifts: ['A'] }, N6: { shifts: ['C'] } };
  });
  const gaps = run(C.createState()).a.summary.shortSessions;
  const { sched, a } = run(s);
  ok(a.summary.shortSessions <= gaps, `缺口 ${a.summary.shortSessions}，未填希望時 ${gaps}`);
  const r = A.wishReport(s, sched, START);
  ok(r.exact + r.partial >= r.wish * 0.6, `至少包含希望的那一節：${r.exact}+${r.partial}/${r.wish}`);
});
test('希望休假一定遵守；與希望班別同日時以休假為準', () => {
  const s = C.createState();
  const d = '2026-09-03';
  s.requests = { [d]: { N3: { off: true, note: '希望休假' } } };
  s.wishes = { [d]: { N3: { shifts: ['A', 'B'] } } };
  const { sched } = run(s);
  eq(sched.N3[d].kind, '休');
  const st = A.wishStatus(s, d, 'N3', sched.N3[d]);
  eq(st.leave, true);
  eq(st.wish, 'miss');
  const r = A.wishReport(s, sched, START);
  eq(r.leaveOk, 1);
});
test('希望上班的日子不會被排成每週休息日', () => {
  const s = C.createState();
  const sat = '2026-09-05';
  s.wishes = { [sat]: {} };
  s.staff.filter((p) => p.group === 'nurse').forEach((p) => { s.wishes[sat][p.id] = { shifts: ['D'] }; });
  const { sched } = run(s);
  const working = s.staff.filter((p) => p.group === 'nurse' && E.workCodes(sched[p.id][sat]).length).length;
  const base = run(C.createState()).sched;
  const baseWorking = s.staff.filter((p) => p.group === 'nurse' && E.workCodes(base[p.id][sat]).length).length;
  ok(working >= baseWorking, `週六上班 ${working} 人，未填希望時 ${baseWorking} 人`);
});
test('希望班別只看當天有的班別（週六填 C 會被忽略）', () => {
  const s = C.createState();
  s.wishes = { '2026-09-05': { N1: { shifts: ['C', 'D'] } } };
  eq(E.wishCodes(s, '2026-09-05', 'N1').join(''), 'D');
  ok(E.sameCodes(['B', 'A'], ['A', 'B']));
  ok(!E.sameCodes(['A'], ['A', 'B']));
});
test('Excel 固定人員：只有該期有指定班時才整期沿用 Excel，其他期別照常排班', () => {
  const s = C.createState();
  s.staff.push(Object.assign(C.newStaff('nurse', 'N10', 10), { name: '固定', fixed: true }));
  s.locks = { '2026-09-02': { N10: { kind: 'work', shifts: ['A'], posts: { A: { station: 'lab' } } } } };
  const next = E.addDays(START, 28);
  ok(E.isFixedIn(s, s.staff.find((p) => p.id === 'N10'), START));
  ok(!E.isFixedIn(s, s.staff.find((p) => p.id === 'N10'), next));
  const { sched, a } = run(s, next);
  ok(E.periodDates(next).filter((d) => E.workCodes(sched.N10[d]).length).length >= 18, '下一期應正常排班');
  ok(!a.metrics.find((m) => m.id === 'N10').fixed);
});
test('重新匯入 Excel 只清掉 Excel 帶入的預假，同仁自填的保留', () => {
  const s = C.createState();
  I.applyToState(s, I.parseRows(sampleRows(), {}), {});
  const d = '2026-08-31';
  const ling = s.staff.find((p) => p.name === '林志玲');
  eq(s.requests[d][ling.id].src, 'excel');
  const other = s.staff.find((p) => p.name === '陳大文');
  s.requests['2026-09-01'] = { [other.id]: { off: true, note: '希望休假' } };
  I.applyToState(s, I.parseRows(sampleRows(), {}), {});
  ok(s.requests['2026-09-01'] && s.requests['2026-09-01'][other.id], '自填休假保留');
  ok(s.requests[d][ling.id].off, 'Excel 預假重新寫入');
});

console.log(`\n結果：${pass} 通過，${fail} 失敗\n`);
process.exit(fail ? 1 : 0);
