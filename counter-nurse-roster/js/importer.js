/**
 * 匯入「預估人班表」Excel：每週一區塊（星期／日期／行事曆／班別／診間／醫務・護理需求／崗位），
 * 轉成逐日逐節崗位需求、指定班與預假，再交由排班引擎產生合法班表。
 * 瀏覽器：window.RosterImport；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./config.js'));
  else root.RosterImport = factory(root.RosterEngine, root.RosterConfig);
})(typeof self !== 'undefined' ? self : this, function (E, C) {
  'use strict';

  const SESSION_IDX = { 早: 0, 午: 1, 晚: 2 };
  const SUMMARY_LABELS = new Set(['總合', '可休', '醫務', '護理', '一天人力']);
  const CJK_NAME = /^[\u4e00-\u9fff]{2,4}$/;

  function text(v) {
    if (v == null) return '';
    if (v instanceof Date) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }
  function ymdOf(v, year) {
    if (v instanceof Date && !isNaN(v)) {
      const t = new Date(v.getTime() + 12 * 3600000);
      return t.toISOString().slice(0, 10);
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      return E.addDays('1899-12-30', Math.floor(v));
    }
    const s = text(v);
    let m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = /^(\d{1,2})[\/月](\d{1,2})日?$/.exec(s);
    if (m && year) return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return null;
  }

  /** 列標題 → 系統崗位 */
  function stationOfLabel(label) {
    const s = label || '';
    if (/櫃|醫務行政/.test(s)) return 'counter';
    if (/調劑|配藥/.test(s)) return 'dispense';
    if (/醫檢/.test(s)) return 'medlab';
    if (/檢驗/.test(s)) return 'lab';
    if (/鏡|場控|清洗/.test(s)) return 'endo';
    return 'clinic';
  }
  function siteShort(site) { return site ? site.replace(/^敦仁/, '') : ''; }

  // ---------- 名字比對：全名、名（後兩字）、單字（組內唯一） ----------
  function normChar(s) { return String(s || '').replace(/暄/g, '瑄'); }
  function buildAliases(names) {
    const map = {}, count = {};
    const add = (k, n) => { k = normChar(k); (map[k] = map[k] || new Set()).add(n); };
    names.forEach((n) => {
      add(n, n);
      if (n.length >= 3) {
        add(n.slice(-2), n);
        n.slice(1).split('').forEach((ch) => { count[normChar(ch)] = (count[normChar(ch)] || 0) + 1; });
      }
    });
    names.forEach((n) => {
      if (n.length >= 3) n.slice(1).split('').forEach((ch) => { if (count[normChar(ch)] === 1) add(ch, n); });
    });
    return map;
  }
  function resolve(aliases, key) {
    const set = aliases[normChar(key)];
    return set && set.size === 1 ? [...set][0] : null;
  }

  /** 行事曆一格 → 預假 tokens */
  function parseLeaveCell(raw) {
    const out = [];
    String(raw || '').replace(/[()（）]/g, '.').split(/[.。、,，;；\s]+/).forEach((tok) => {
      tok = tok.trim();
      if (!tok) return;
      let m = /^(.+?)(早|午|晚)休$/.exec(tok);
      if (m) { out.push({ raw: tok, who: m[1], block: SESSION_IDX[m[2]] }); return; }
      m = /^(.+?)休$/.exec(tok);
      if (m) { out.push({ raw: tok, who: m[1], off: true }); return; }
      m = /^(.+?)(\d{1,2}\/\d{1,2})$/.exec(tok);
      if (m) { out.push({ raw: tok, who: m[1], off: true, note: `${m[2]} 國定假日補休` }); return; }
      out.push({ raw: tok, who: null });
    });
    return out;
  }

  // ---------- 解析工作表 ----------
  function parseRows(rows, opts) {
    opts = opts || {};
    const A = (r) => text(rows[r] && rows[r][0]);
    const starts = [];
    for (let r = 0; r < rows.length; r++) if (A(r) === '星期') starts.push(r);
    const result = {
      weeks: [], dates: [], staffNames: [], poolSize: {}, cells: [], leaves: [],
      external: {}, support: 0, unresolved: [], doctors: [], doctorCells: [],
    };
    if (!starts.length) return result;

    const headerNames = [];
    for (let c = 20; c < ((rows[starts[0] + 1] || []).length); c++) {
      const v = text(rows[starts[0] + 1][c]);
      headerNames.push(CJK_NAME.test(v) ? v : '');
    }
    const groupsOfNames = [];
    let cur = [];
    headerNames.forEach((n) => { if (n) cur.push(n); else if (cur.length) { groupsOfNames.push(cur); cur = []; } });
    if (cur.length) groupsOfNames.push(cur);
    const allNames = [].concat(...groupsOfNames);
    const nameSet = new Set(allNames);
    const doctors = new Set();

    starts.forEach((s0, bi) => {
      const s1 = bi + 1 < starts.length ? starts[bi + 1] : rows.length;
      let dateRow = -1, shiftRow = -1, sumRow = -1;
      const calRows = [];
      for (let r = s0; r < s1; r++) {
        const a = A(r);
        if (a === '日期' && dateRow < 0) dateRow = r;
        else if (a === '班別' && shiftRow < 0) shiftRow = r;
        else if (a === '總合' && shiftRow >= 0 && sumRow < 0) sumRow = r;
        else if (shiftRow < 0 && dateRow >= 0 && (a === '醫務' || a === '護理')) calRows.push({ r, side: a === '醫務' ? 'counter' : 'nurse' });
      }
      if (dateRow < 0 || shiftRow < 0) return;

      const cols = [];
      let lastDate = null;
      for (let c = 3; c < 20; c++) {
        const dv = ymdOf(rows[dateRow][c], opts.year);
        if (dv) lastDate = dv;
        const lab = text(rows[shiftRow][c]);
        if (lastDate && lab in SESSION_IDX) cols.push({ c, date: lastDate, idx: SESSION_IDX[lab], label: lab, dayStart: !!dv });
      }
      if (!cols.length) return;
      const weekDates = [...new Set(cols.map((x) => x.date))];
      result.weeks.push({ dates: weekDates });
      weekDates.forEach((d) => { if (!result.dates.includes(d)) result.dates.push(d); });

      const docEnd = sumRow > 0 ? sumRow : shiftRow + 1;
      let docSite = '';
      for (let r = shiftRow + 1; r < docEnd; r++) {
        if (text(rows[r][2])) docSite = text(rows[r][2]);
        cols.forEach((x) => {
          const raw = text(rows[r][x.c]);
          const [v, ...rest] = raw.split('-');
          if (!v || v === '*' || nameSet.has(v)) return;
          doctors.add(v);
          const note = rest.join('-');
          result.doctorCells.push({
            date: x.date, idx: x.idx, name: v, note, leave: /請假|休/.test(note),
            site: docSite, room: A(r), spec: text(rows[r][1]),
          });
        });
      }

      let r = docEnd;
      const pools = [];
      while (r < s1 && (SUMMARY_LABELS.has(A(r)) || (!A(r) && typeof rows[r][3] === 'number'))) {
        if (A(r) === '可休' && typeof (rows[r] && rows[r][1]) === 'number') pools.push(rows[r][1]);
        r++;
      }
      if (bi === 0 && pools.length >= 2) result.poolSize = { counter: pools[0], nurse: pools[1] };

      let label = '', site = '';
      for (; r < s1; r++) {
        const a = A(r), cSite = text(rows[r][2]);
        const hasCell = cols.some((x) => text(rows[r][x.c]));
        if (a) label = a;
        if (cSite) site = cSite;
        if (!hasCell || !label) continue;
        cols.forEach((x) => {
          const v = text(rows[r][x.c]);
          if (!v || v === '*') return;
          const base = { date: x.date, idx: x.idx, rowLabel: label, site, station: stationOfLabel(label) };
          if (v === '醫務') result.cells.push(Object.assign(base, { kind: 'pool', side: 'counter' }));
          else if (v === '護理') result.cells.push(Object.assign(base, { kind: 'pool', side: 'nurse' }));
          else if (v === '支援') { result.cells.push(Object.assign(base, { kind: 'support' })); result.support++; }
          else if (nameSet.has(v)) result.cells.push(Object.assign(base, { kind: 'named', name: v }));
          else if (/-/.test(v) || doctors.has(v.split('-')[0])) return;
          else { result.cells.push(Object.assign(base, { kind: 'external', name: v })); result.external[v] = (result.external[v] || 0) + 1; }
        });
      }

      calRows.forEach(({ r: cr, side }) => {
        cols.filter((x) => x.dayStart).forEach((x) => {
          parseLeaveCell(rows[cr][x.c]).forEach((t) => result.leaves.push(Object.assign({ date: x.date, side }, t)));
        });
      });
    });

    // 組別：行事曆「醫務」列與櫃檯崗位出現較多者為醫務櫃檯，其餘為護理
    const evidence = groupsOfNames.map((g) => {
      const al = buildAliases(g);
      let counter = 0, nurse = 0;
      result.leaves.forEach((t) => { if (t.who && resolve(al, t.who)) t.side === 'counter' ? counter++ : nurse++; });
      result.cells.forEach((x) => { if (x.kind === 'named' && g.includes(x.name)) x.station === 'counter' ? counter++ : nurse++; });
      return { g, counter, nurse };
    });
    let counterIdx = -1;
    if (evidence.length >= 2) {
      counterIdx = 0;
      evidence.forEach((e, i) => { if (e.counter - e.nurse > evidence[counterIdx].counter - evidence[counterIdx].nurse) counterIdx = i; });
    }
    evidence.forEach((e, i) => e.g.forEach((n) => result.staffNames.push({ name: n, side: i === counterIdx ? 'counter' : 'nurse' })));

    const sideOf = {};
    result.staffNames.forEach((x) => { sideOf[x.name] = x.side; });
    const aliasBySide = {
      counter: buildAliases(result.staffNames.filter((x) => x.side === 'counter').map((x) => x.name)),
      nurse: buildAliases(result.staffNames.filter((x) => x.side === 'nurse').map((x) => x.name)),
      all: buildAliases(allNames),
    };
    result.leaves.forEach((t) => {
      if (!t.who) { result.unresolved.push(t.raw); return; }
      t.name = resolve(aliasBySide[t.side], t.who) || resolve(aliasBySide.all, t.who);
      if (!t.name) result.unresolved.push(t.raw);
    });
    result.cells.forEach((x) => { if (x.kind === 'named') x.side = sideOf[x.name]; });
    result.doctors = [...doctors];
    result.dates.sort();
    return result;
  }

  function parseWorkbook(XLSX, data, opts) {
    const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });
    const merged = [];
    wb.SheetNames.forEach((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      merged.push(...rows, []);
    });
    const parsed = parseRows(merged, opts);
    parsed.sheets = wb.SheetNames.slice();
    return parsed;
  }

  // ---------- 寫入系統狀態 ----------
  /** 名字出現在指定崗位的節數 ≥ 每週 8 節者視為固定班正職；1–8 節為固定兼職；其餘交由系統排 */
  function classify(parsed) {
    const weeks = Math.max(1, parsed.weeks.length);
    const cnt = {}, perWeek = {}, sites = {};
    parsed.cells.forEach((x) => {
      if (x.kind !== 'named') return;
      cnt[x.name] = (cnt[x.name] || 0) + 1;
      const s = C.siteIdOf(siteShort(x.site));
      sites[x.name] = sites[x.name] || {};
      sites[x.name][s] = (sites[x.name][s] || 0) + 1;
      const w = parsed.weeks.findIndex((wk) => wk.dates.includes(x.date));
      perWeek[x.name] = perWeek[x.name] || [];
      perWeek[x.name][w] = (perWeek[x.name][w] || 0) + 1;
    });
    return parsed.staffNames.map((s) => {
      const n = cnt[s.name] || 0, avg = n / weeks;
      const role = avg >= 8 ? 'fixedFT' : avg >= 1 ? 'fixedPT' : 'pool';
      const maxWeek = Math.max(0, ...(perWeek[s.name] || []).map((v) => v || 0));
      const site = Object.entries(sites[s.name] || { [C.siteIdOf()]: 1 }).sort((a, b) => b[1] - a[1])[0][0];
      const job = s.side === 'counter' ? '醫務櫃檯' : '護理師';
      const title = role === 'fixedPT' ? `兼職${s.side === 'counter' ? '醫務' : '護理'}` : job;
      return { name: s.name, side: s.side, sessions: n, avg, role, maxWeek, site, title };
    });
  }

  const SPEC_NAME = { GI: '腸胃肝膽科', 家醫: '家醫科', 新代: '新陳代謝科', 腎內: '腎臟內科', 心內: '心臟內科', 一般: '一般科', 乳外: '乳房外科' };

  /** 醫師：院所與科別取看診節數最多者（請假不計） */
  function classifyDoctors(parsed) {
    const by = {};
    (parsed.doctorCells || []).forEach((x) => {
      const d = by[x.name] = by[x.name] || { name: x.name, sessions: 0, sites: {}, specs: {} };
      if (x.leave) return;
      d.sessions++;
      const s = C.siteIdOf(siteShort(x.site));
      d.sites[s] = (d.sites[s] || 0) + 1;
      if (x.spec) d.specs[x.spec] = (d.specs[x.spec] || 0) + 1;
    });
    const top = (o) => (Object.entries(o).sort((a, b) => b[1] - a[1])[0] || [])[0];
    return Object.values(by).map((d) => {
      const spec = top(d.specs);
      return { name: d.name, sessions: d.sessions, site: top(d.sites) || C.siteIdOf(), title: spec ? `${SPEC_NAME[spec] || spec}醫師` : '醫師' };
    });
  }

  /** Excel 有排門診的日子寫入門診班；同週其他日子標休（週日標例），供工時與法規檢核 */
  function applyDoctors(state, parsed, periods, codeOf) {
    const docs = classifyDoctors(parsed);
    const idOf = {};
    docs.forEach((d) => {
      let p = state.staff.find((x) => x.group === 'doctor' && x.name === d.name);
      if (!p) {
        p = C.newStaff('doctor', C.nextId(state, 'doctor'), 0);
        p.name = d.name;
        state.staff.push(p);
      }
      p.site = d.site;
      if (!p.title) p.title = d.title;
      idOf[d.name] = p.id;
    });
    const work = {};
    (parsed.doctorCells || []).forEach((x) => {
      const code = codeOf(x.date, x.idx);
      if (x.leave || !code) return;
      const mine = work[idOf[x.name]] = work[idOf[x.name]] || {};
      const day = mine[x.date] = mine[x.date] || { codes: [], notes: [] };
      if (!day.codes.includes(code)) day.codes.push(code);
      if (x.note && !day.notes.includes(`${code} ${x.note}`)) day.notes.push(`${code} ${x.note}`);
    });
    const covered = new Set(parsed.dates);
    const restDow = state.settings.restDow;
    let sessions = 0;
    periods.forEach((p0) => {
      const sc = state.schedules[p0] = state.schedules[p0] || {};
      Object.values(idOf).forEach((pid) => {
        const mine = sc[pid] = sc[pid] || {};
        E.periodDates(p0).forEach((d) => {
          const w = work[pid] && work[pid][d];
          if (w) {
            const order = E.dayShifts(state, d).map((s) => s.code);
            mine[d] = { kind: 'work', shifts: order.filter((c) => w.codes.includes(c)), posts: {} };
            if (w.notes.length) mine[d].note = w.notes.join('、');
            sessions += w.codes.length;
          } else if (covered.has(d)) mine[d] = { kind: '休' };
          else if (E.dow(d) === restDow && [1, 2, 3, 4, 5, 6].some((k) => covered.has(E.addDays(d, k)))) mine[d] = { kind: '例' };
        });
      });
    });
    return {
      list: docs.map((d) => ({ name: d.name, id: idOf[d.name], site: d.site, title: d.title, sessions: d.sessions })),
      sessions,
    };
  }

  function applyToState(state, parsed, opts) {
    opts = opts || {};
    const prefix = { counter: 'F', nurse: 'N', part: 'P' };
    const roles = classify(parsed);
    /** Excel 只重建醫務櫃檯、護理與固定兼職；藥師、醫檢師、非固定兼職與手動組別保留 */
    const rebuilt = (p) => p.group === 'counter' || p.group === 'nurse' || (p.group === 'part' && p.fixed);
    const keep = state.staff.filter((p) => !rebuilt(p) && !roles.some((r) => r.name === p.name));
    const staff = [];
    const counters = { F: 0, N: 0, P: 0 };
    keep.forEach((p) => { const m = /^P(\d+)$/.exec(p.id); if (m) counters.P = Math.max(counters.P, Number(m[1])); });
    const pidOf = {};
    roles.forEach((r) => {
      const group = r.role === 'fixedPT' ? 'part' : r.side;
      const pre = prefix[group];
      counters[pre]++;
      const p = C.newStaff(group, pre + counters[pre], counters[pre]);
      p.name = r.name;
      p.title = r.title;
      p.site = r.site;
      if (group === 'part') {
        p.fixed = true;
        p.weeklySlots = Math.max(1, r.maxWeek);
        p.skills = r.side === 'counter' ? ['counter'] : state.stations.filter((x) => x.group === 'nurse').map((x) => x.id).concat(['counter']);
        p.side = r.side;
      }
      if (r.role === 'fixedFT') p.fixed = true;
      pidOf[r.name] = p.id;
      staff.push(p);
    });
    state.staff = staff.concat(keep);

    const dates = parsed.dates;
    state.dateDemand = state.dateDemand || {};
    state.locks = state.locks || {};
    state.requests = state.requests || {};
    const sheetSites = [...new Set(parsed.cells.map((x) => C.siteIdOf(siteShort(x.site))))];
    sheetSites.forEach((site) => {
      const dd = state.dateDemand[site] = state.dateDemand[site] || {};
      dates.forEach((d) => { dd[d] = {}; });
    });
    /** 只清掉上次 Excel 帶入的預假；同仁在「希望休假」頁自行填的保留 */
    dates.forEach((d) => {
      delete state.locks[d];
      const day = state.requests[d];
      if (!day) return;
      Object.keys(day).forEach((pid) => { if (day[pid].src === 'excel') delete day[pid]; });
      if (!Object.keys(day).length) delete state.requests[d];
    });

    const unmapped = [];
    const codeOf = (d, idx) => { const s = E.dayShifts(state, d)[idx]; return s ? s.code : null; };
    const bump = (site, d, code, sid) => {
      const day = state.dateDemand[site][d];
      day[code] = day[code] || {};
      const q = day[code][sid] = day[code][sid] || { min: 0, max: 0 };
      q.min++; q.max++;
    };
    const stats = { pool: { counter: 0, nurse: 0 }, named: 0, support: 0, external: 0, crossRole: 0 };
    parsed.cells.forEach((x) => {
      const code = codeOf(x.date, x.idx);
      if (!code) { unmapped.push(`${x.date} ${x.rowLabel}`); return; }
      if (x.kind === 'external') { stats.external++; return; }
      let sid = x.station;
      if ((x.kind === 'pool' || x.kind === 'named') && x.side === 'counter') sid = 'counter';
      else if (x.kind !== 'support' && sid === 'counter') { sid = 'clinic'; stats.crossRole++; }
      bump(C.siteIdOf(siteShort(x.site)), x.date, code, sid);
      if (x.kind === 'pool') stats.pool[x.side]++;
      if (x.kind === 'support') stats.support++;
      if (x.kind === 'named') {
        stats.named++;
        const pid = pidOf[x.name];
        const day = state.locks[x.date] = state.locks[x.date] || {};
        const lk = day[pid] = day[pid] || { kind: 'work', shifts: [], posts: {} };
        if (!lk.shifts.includes(code)) lk.shifts.push(code);
        lk.posts[code] = { station: sid, label: siteShort(x.site) + x.rowLabel };
      }
    });
    dates.forEach((d) => {
      const order = E.dayShifts(state, d).map((s) => s.code);
      Object.values(state.locks[d] || {}).forEach((lk) => { lk.shifts = order.filter((c) => lk.shifts.includes(c)); });
    });

    const fixedNames = new Set(roles.filter((r) => r.role !== 'pool').map((r) => r.name));
    const leaveApplied = [], leaveFixed = [];
    parsed.leaves.forEach((t) => {
      if (!t.name || !pidOf[t.name]) return;
      if (fixedNames.has(t.name)) { leaveFixed.push(`${t.date} ${t.raw}`); return; }
      const pid = pidOf[t.name];
      const day = state.requests[t.date] = state.requests[t.date] || {};
      if (t.off) day[pid] = { off: true, note: t.note || t.raw, src: 'excel' };
      else {
        const code = codeOf(t.date, t.block);
        if (!code) return;
        const r = day[pid] = day[pid] || { block: [], src: 'excel' };
        if (!r.off) { r.block = r.block || []; if (!r.block.includes(code)) r.block.push(code); r.note = (r.note ? r.note + '、' : '') + t.raw; }
      }
      leaveApplied.push(`${t.date} ${t.raw}`);
    });

    const set = state.settings;
    const firstSun = dates.length ? E.addDays(dates[0], -E.dow(dates[0])) : null;
    if (firstSun && E.alignPeriod(set.periodAnchor || firstSun, firstSun) !== firstSun) set.periodAnchor = firstSun;
    const periods = [...new Set(dates.map((d) => E.alignPeriod(set.periodAnchor, d)))].sort();
    periods.forEach((p) => {
      const old = state.schedules[p];
      delete state.schedules[p];
      const manual = old ? state.staff.filter((x) => !E.isAutoGroup(x.group) && old[x.id]) : [];
      if (manual.length) state.schedules[p] = Object.fromEntries(manual.map((x) => [x.id, old[x.id]]));
    });
    if (periods.length) state.periodStart = periods[0];
    const docs = applyDoctors(state, parsed, periods, codeOf);

    const summary = {
      file: opts.fileName || '',
      importedAt: new Date().toISOString(),
      weeks: parsed.weeks.length,
      periods,
      dates: [dates[0], dates[dates.length - 1]],
      poolSize: parsed.poolSize,
      roles: roles.map((r) => ({ name: r.name, side: r.side, role: r.role, title: r.title, site: r.site, sessions: r.sessions, id: pidOf[r.name] })),
      doctors: docs.list,
      doctorSessions: docs.sessions,
      demand: stats,
      external: parsed.external,
      leaveApplied: leaveApplied.length,
      leaveFixed,
      unresolved: parsed.unresolved,
      unmapped,
    };
    state.importInfo = summary;
    return summary;
  }

  return { parseRows, parseWorkbook, parseLeaveCell, applyToState, classify, classifyDoctors, stationOfLabel, buildAliases, resolve, ymdOf };
});
