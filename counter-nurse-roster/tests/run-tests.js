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
function setDemand(state, stationId, min, max) {
  state.shifts.forEach((s) => { state.demand[s.code][stationId] = { min, max }; });
}
function spreadOf(arr) { return Math.max.apply(null, arr) - Math.min.apply(null, arr); }

console.log('\n[設定與日期]');
test('預設名單 F1–F5、N1–N9、P1–P4', () => {
  const s = C.createState();
  eq(s.staff.filter((p) => p.group === 'counter').length, 5);
  eq(s.staff.filter((p) => p.group === 'nurse').length, 9);
  eq(s.staff.filter((p) => p.group === 'part').length, 4);
  eq(s.shifts.map((x) => x.code).join(''), 'ABCDE');
  eq(s.demand.A.counter.min, 4);
  eq(s.demand.C.endo.max, 2);
});
test('班別時數：護理 C 18:00–21:30（3.5h、BC 7.5h）；櫃檯 C 17:30–21:30（4h、BC 8h）', () => {
  const s = C.createState(), sm = E.shiftMap(s), cm = E.shiftMap(s, 'counter'), nm = E.shiftMap(s, 'nurse');
  eq(E.shiftHours(sm.A), 4); eq(E.shiftHours(nm.C), 3.5); eq(E.shiftHours(cm.C), 4);
  eq(cm.C.start, '17:30'); eq(nm.C.start, '18:00');
  eq(E.spanOf(nm, ['A', 'B']).hours, 8); eq(E.spanOf(nm, ['B', 'C']).hours, 7.5);
  eq(E.spanOf(cm, ['B', 'C']).hours, 8); eq(E.spanOf(cm, ['A', 'C']).hours, 8);
});
test('兼職支援櫃檯 C 用櫃檯時間，支援跟診 C 用護理時間', () => {
  const s = C.createState();
  eq(E.entrySpan(s, { kind: 'work', shifts: ['C'], posts: { C: { station: 'counter' } } }, 'part').hours, 4);
  eq(E.entrySpan(s, { kind: 'work', shifts: ['C'], posts: { C: { station: 'clinic' } } }, 'part').hours, 3.5);
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
test('AB/BC 為主，AC 少於相鄰班', () => {
  ok(r0.a.summary.gap < r0.a.summary.adj / 3, `AC ${r0.a.summary.gap} vs AB/BC ${r0.a.summary.adj}`);
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
test('護理 C 也改 17:30：零違規、工時 ≤ 160', () => {
  const s = C.createState();
  s.shifts.find((x) => x.code === 'C').start = '17:30';
  const { a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
});
test('取消櫃檯另訂時間：櫃檯 C 回到 18:00', () => {
  const s = C.createState();
  delete s.shifts.find((x) => x.code === 'C').groupTimes;
  eq(E.shiftMap(s, 'counter').C.start, '18:00');
  const { a } = run(s);
  eq(errorsOf(a).length, 0, errText(a));
});
test('刪除 E 班、新增週六晚班 F：零違規且 F 只出現在週六', () => {
  const s = C.createState();
  s.shifts = s.shifts.filter((x) => x.code !== 'E');
  s.shifts.push({ code: 'F', name: '週六晚班', start: '14:00', end: '17:00', days: [6] });
  C.ensureDemand(s);
  ok(!s.demand.E, 'E 需求應移除');
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
test('LINE 通報含櫃檯與各崗位、C 班分列兩組時間，週日顯示休診', () => {
  const t = X.lineNotice(base, r0.sched, '2026-08-31');
  ok(t.includes('櫃檯') && t.includes('胃鏡室') && t.includes('A 班'));
  ok(t.includes('護理 18:00-21:30') && t.includes('櫃檯 17:30-21:30'), t.split('\n').find((x) => x.includes('C 班')));
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
  s.dateDemand = { '2026-09-01': { A: { counter: { min: 2, max: 2 } } } };
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
  const d = '2026-08-31';
  eq(s.dateDemand[d].A.counter.min, 1);
  eq(s.dateDemand[d].A.lab.min, 1);
  eq(s.dateDemand[d].A.clinic.min, 1);
  eq(s.dateDemand[d].B.lab.min, 1);
  eq(s.dateDemand[d].C.lab.min, 1);
  eq(s.dateDemand['2026-09-05'].D.counter.min, 1);
  const mei = s.staff.find((p) => p.name === '王小美'), ling = s.staff.find((p) => p.name === '林志玲');
  eq(mei.group, 'part');
  ok(mei.fixed);
  eq(s.locks[d][mei.id].shifts.join(''), 'B');
  ok(s.requests[d][ling.id].off);
  const { sched } = run(s, sum.periods[0]);
  eq(sched[ling.id][d].kind, '休');
  eq(sched[mei.id][d].posts.B.station, 'lab');
});

console.log(`\n結果：${pass} 通過，${fail} 失敗\n`);
process.exit(fail ? 1 : 0);
