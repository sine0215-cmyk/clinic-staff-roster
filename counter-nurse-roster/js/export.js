/**
 * 匯出：CSV（Excel 可開）、TSV（剪貼簿貼上）、LINE 當日崗位通報
 * 瀏覽器：window.RosterExport；Node：module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./audit.js'));
  else root.RosterExport = factory(root.RosterEngine, root.RosterAudit);
})(typeof self !== 'undefined' ? self : this, function (E, A) {
  'use strict';

  const GROUP_NAME = { counter: '醫務櫃檯', nurse: '護理', part: '兼職', doctor: '醫師', dietitian: '營養師', educator: '衛教師', pharmacist: '藥師', medtech: '醫檢師' };
  const MANUAL_GROUPS = ['doctor', 'dietitian', 'educator'];

  function siteName(state, id) { const s = (state.sites || []).find((x) => x.id === id); return s ? s.name : id; }
  /** 傳入院所視圖時只輸出該院；完整 state 則逐院輸出（略過沒有同仁的院所） */
  function viewsOf(state) {
    if (state.siteId) return [state];
    return E.siteIds(state).map((id) => E.siteView(state, id)).filter((v) => E.activeStaff(v).length);
  }

  function stationLabel(state, post) {
    if (post && post.label) return post.label;
    if (!post || !post.station || post.station === 'float') return '機動';
    const st = E.stationById(state, post.station);
    if (!st) return '機動';
    if (st.seats) return post.seat ? `${st.short || st.name}${post.seat}` : `${st.short || st.name}機動`;
    return st.short || st.name;
  }

  /** 例：「AB 櫃2/櫃3」「BC 胃/跟」「例」「休」 */
  function cellText(state, entry, withStation) {
    if (!entry) return '';
    if (entry.kind !== 'work') return entry.kind;
    const codes = E.workCodes(entry);
    if (!codes.length) return '';
    const head = codes.join('');
    if (!withStation || !entry.posts || !Object.keys(entry.posts).length) return head;
    const posts = codes.map((c) => stationLabel(state, entry.posts && entry.posts[c]));
    return `${head} ${posts.join('/')}`;
  }

  function dateHeader(d) {
    const [, m, day] = d.split('-');
    return `${Number(m)}/${Number(day)}(${E.DOW_NAMES[E.dow(d)]})`;
  }

  function rosterRows(state, sched, start, withStation) {
    const dates = E.periodDates(start);
    const head = ['編號', '姓名', '院所', '組別', '職務'].concat(dates.map(dateHeader), ['工時', '上班日', '例', '休', 'AB/BC', 'AC', '晚班']);
    const rows = [head];
    E.activeStaff(state).forEach((p) => {
      const m = A.personMetrics(state, sched, start, p);
      rows.push([p.id, p.name, siteName(state, E.siteOf(state, p)), GROUP_NAME[p.group] || p.group, p.title || GROUP_NAME[p.group] || p.group]
        .concat(dates.map((d) => cellText(state, sched[p.id] && sched[p.id][d], withStation)))
        .concat([m.hours, m.workdays, m.regular, m.rest, m.adj, m.gap, m.late]));
    });
    return rows;
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function buildCSV(state, sched, start, withStation) {
    const rows = rosterRows(state, sched, start, withStation !== false);
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  function buildTSV(state, sched, start, withStation) {
    return rosterRows(state, sched, start, withStation !== false)
      .map((r) => r.map((v) => String(v == null ? '' : v).replace(/[\t\r\n]/g, ' ')).join('\t'))
      .join('\n');
  }

  /** 崗位明細：每日每節每崗位一列 */
  function buildPostCSV(state, sched, start) {
    const rows = [['院所', '日期', '星期', '班別', '時間', '崗位', '需求', '實排', '狀態', '人員']];
    viewsOf(state).forEach((v) => {
      const cov = A.coverage(v, sched, start);
      const site = siteName(v, v.siteId);
      E.periodDates(start).forEach((d) => {
        E.dayShifts(v, d).forEach((s) => {
          v.stations.concat([{ id: 'float', name: '機動' }]).forEach((x) => {
            const c = cov.cells[`${d}|${s.code}|${x.id}`];
            if (!c || (!c.n && (x.id === 'float' || !c.max))) return;
            const need = x.id === 'float' ? '' : c.min === c.max ? c.min : `${c.min}-${c.max}`;
            const status = x.id === 'float' ? '' : c.status === 'short' ? `缺${c.min - c.n}` : c.status === 'over' ? '超額' : 'OK';
            const t = E.shiftTime(s, x.group);
            rows.push([site, d, E.DOW_NAMES[E.dow(d)], s.code, `${t.start}-${t.end}`, x.name, need, c.n, status,
              c.people.map((p) => (p.seat ? `${p.name}(${p.seat})` : p.name)).join('、')]);
          });
        });
      });
    });
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  /** 「18:00-21:30」；各組時間不同時為「護理 18:00-21:30／櫃檯 17:30-21:30」 */
  function shiftTimeText(state, s) {
    const groups = [...new Set(state.stations.map((x) => x.group))];
    const texts = groups.map((g) => { const t = E.shiftTime(s, g); return { g, text: `${t.start}-${t.end}` }; });
    if (new Set(texts.map((x) => x.text)).size <= 1) return `${s.start}-${s.end}`;
    const label = { counter: '櫃檯', nurse: '護理', pharmacist: '藥師', medtech: '醫檢' };
    return texts.map((x) => `${label[x.g] || x.g} ${x.text}`).join('／');
  }

  function lineNotice(state, sched, d) {
    const views = viewsOf(state);
    const where = state.siteId ? siteName(state, state.siteId) : '';
    const lines = [`【${state.settings.orgName}${where ? '・' + where : ''}】${d.replace(/-/g, '/')}（週${E.DOW_NAMES[E.dow(d)]}）崗位通報`];
    const shifts = E.dayShifts(state, d);
    if (!shifts.length) return lines.concat(['本日休診（例假）']).join('\n');
    views.forEach((v) => {
      const cov = A.coverage(v, sched, d);
      if (!state.siteId) lines.push('', `■ ${siteName(v, v.siteId)}`);
      shifts.forEach((s) => {
        lines.push('', `▍${s.code} 班 ${shiftTimeText(v, s)}${s.name ? ' ' + s.name : ''}`);
        v.stations.forEach((x) => {
          const c = cov.cells[`${d}|${s.code}|${x.id}`];
          if (!c || (!c.n && !c.min)) return;
          const people = x.seats ? c.people.slice().sort((a, b) => (a.seat || 99) - (b.seat || 99)) : c.people;
          const names = people.map((p) => (x.seats && p.seat ? `${p.seat}.${p.name}` : p.name)).join('、') || '—';
          const short = c.status === 'short' ? `（缺 ${c.min - c.n}）` : '';
          lines.push(`${x.name}：${names}${short}`);
        });
        const fl = cov.cells[`${d}|${s.code}|float`];
        if (fl && fl.n) lines.push(`機動：${fl.people.map((p) => p.name).join('、')}`);
        MANUAL_GROUPS.forEach((g) => {
          const on = E.activeStaff(v, g).filter((p) => E.workCodes(sched[p.id] && sched[p.id][d]).includes(s.code));
          if (on.length) lines.push(`${GROUP_NAME[g]}：${on.map((p) => p.name).join('、')}`);
        });
      });
      const off = E.activeStaff(v).filter((p) => {
        const e = sched[p.id] && sched[p.id][d];
        return p.group !== 'part' && e && e.kind !== 'work';
      });
      if (off.length) lines.push('', `休假：${off.map((p) => `${p.name}(${sched[p.id][d].kind})`).join('、')}`);
    });
    return lines.join('\n');
  }

  return { cellText, stationLabel, dateHeader, shiftTimeText, rosterRows, buildCSV, buildTSV, buildPostCSV, lineNotice };
});
