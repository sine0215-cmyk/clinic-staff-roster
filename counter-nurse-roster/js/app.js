/* 介面：五大面板 */
(function () {
  'use strict';
  const C = window.RosterConfig, E = window.RosterEngine, A = window.RosterAudit, X = window.RosterExport;
  const KEY = 'counterNurseRoster.v1';
  const $ = (sel) => document.querySelector(sel);
  const h = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const GROUP_NAME = { counter: '醫務櫃檯', nurse: '護理同仁', part: '兼職同仁' };
  const DOW = E.DOW_NAMES;

  let state = load();
  applyUrlPreset();
  const ui = { tab: 'grid', week: 0, filter: 'all', showPost: true, day: null, person: null, edit: null, demandChanged: false };
  const urlWeek = /[?&]week=([0-4])/.exec(location.search);
  if (urlWeek) ui.week = Number(urlWeek[1]);
  let cache = null;

  function load() {
    try { return C.normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (e) { return C.createState(); }
  }
  function presets() { return window.ROSTER_PRESETS || {}; }
  /** 內建資料（data/presets.js）：網址 ?preset=代號 時載入；本機已有其他資料時先確認 */
  function applyUrlPreset() {
    const m = /[?&]preset=([\w-]+)/.exec(location.search);
    const pre = m && presets()[m[1]];
    if (!pre) return;
    if (state.importInfo && state.importInfo.presetId === m[1]) return;
    const hasOwn = !!localStorage.getItem(KEY) && Object.keys(state.schedules || {}).length > 0;
    if (hasOwn && !confirm(`載入內建資料「${pre.label}」？目前瀏覽器內的排班資料將被取代（如需保留請先到設定頁備份）。`)) return;
    loadPreset(m[1]);
  }
  function loadPreset(id) {
    const pre = presets()[id];
    state = C.normalize(clone(pre.state));
    state.importInfo = Object.assign({}, state.importInfo, { presetId: id });
    save();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('儲存失敗：' + e.message); } }
  function invalidate() { cache = null; }
  function commit() { invalidate(); save(); render(); }

  function curStart() {
    if (!state.periodStart) state.periodStart = E.alignPeriod(state.settings.periodAnchor, E.todayYMD());
    return state.periodStart;
  }
  function curSched() { return state.schedules[curStart()] || null; }
  function analysis() {
    if (!cache) { const s = curSched(); cache = s ? A.analyze(state, s, curStart()) : null; }
    return cache;
  }
  function metricOf(pid) { const a = analysis(); return a ? a.metrics.find((m) => m.id === pid) : null; }
  function slash(d) { return d.replace(/-/g, '/'); }
  function md(d) { const [, m, x] = d.split('-'); return `${Number(m)}/${Number(x)}`; }
  function staffById(id) { return state.staff.find((p) => p.id === id); }
  function timeGroupOf(p) { return p.group === 'part' ? null : p.group; }
  function stationName(id) { if (id === 'float') return '機動'; const s = E.stationById(state, id); return s ? s.name : id; }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  // ---------- 排班動作 ----------
  function generate(n) {
    const start = curStart();
    for (let i = 0; i < n; i++) {
      const st = E.addDays(start, 28 * i);
      state.schedules[st] = E.generate(state, st);
    }
    ui.demandChanged = false;
    commit();
    const a = analysis();
    toast(`已排定 ${n} 期｜違規 ${a.summary.errors}｜缺口 ${a.summary.shortSessions} 人次節`);
  }

  // ---------- 頂部 ----------
  function renderHeader() {
    const st = curStart(), end = E.addDays(st, 27);
    $('#orgTitle').textContent = `${state.settings.orgName}｜醫務櫃檯・護理人員排班`;
    $('#periodNo').textContent = `第 ${E.periodIndex(state.settings.periodAnchor, st) + 1} 期（四週）`;
    $('#periodRange').textContent = `${slash(st)}~${slash(end)}`;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    const a = analysis(), el = $('#summary');
    if (!a) { el.innerHTML = '<span class="pill">本期尚未排班，請按「一鍵排班」</span>'; return; }
    const s = a.summary, fair = a.fairness;
    const fairText = ['counter', 'nurse'].filter((g) => fair[g]).map((g) => `${GROUP_NAME[g]} ${fair[g].overall}`).join('・');
    el.innerHTML = [
      `<span class="pill ${s.errors ? 'bad' : 'good'}">法規違規 ${s.errors}</span>`,
      `<span class="pill ${s.gaps ? 'warn' : 'good'}">人力缺口 ${s.shortSessions} 人次節（${s.gaps} 格）</span>`,
      `<span class="pill">需求覆蓋率 ${(s.coverageRate * 100).toFixed(1)}%</span>`,
      `<span class="pill">AB/BC ${s.adj}・AC ${s.gap}</span>`,
      `<span class="pill">公平度 ${fairText}</span>`,
      ui.demandChanged ? '<span class="pill warn">需求／設定已變更，請重新一鍵排班</span>' : '',
    ].join('');
  }

  function render() {
    renderHeader();
    const main = $('#main');
    const fn = { grid: renderGrid, day: renderDay, person: renderPerson, legal: renderLegal, settings: renderSettings }[ui.tab];
    main.innerHTML = fn();
    if (ui.edit) renderModal();
  }

  function emptyState() {
    return `<div class="card empty"><p>本期（${slash(curStart())} 起）尚未排班。</p>
      <button class="btn primary" data-act="generate" data-n="1">⚡ 一鍵排班</button></div>`;
  }

  // ---------- 1. 排班大表 ----------
  function issueIndex(a) {
    const map = {}, person = {};
    (a ? a.issues : []).forEach((x) => {
      if (x.level === 'info') return;
      if (x.date) (map[`${x.pid}|${x.date}`] = map[`${x.pid}|${x.date}`] || []).push(x);
      else (person[x.pid] = person[x.pid] || []).push(x);
    });
    return { map, person };
  }
  function cellClass(entry, d, group) {
    if (!entry) return 'blank';
    const lk = entry.locked ? ' locked' : '';
    if (entry.kind === '例') return 'off-reg' + lk;
    if (entry.kind === '休') return `off-rest${entry.req ? ' req' : ''}${lk}`;
    const codes = E.workCodes(entry);
    const k = E.comboKind(state, d, codes);
    const late = E.isLateEntry(state, entry, group);
    return `work k-${k}${late ? ' late' : ''}${lk}`;
  }
  function cellInner(entry, showPost) {
    if (!entry) return '';
    if (entry.kind !== 'work') return `<b>${h(entry.kind)}</b>${entry.req ? '<small>預假</small>' : ''}`;
    const codes = E.workCodes(entry);
    const posts = showPost ? `<small>${codes.map((c) => h(X.stationLabel(state, entry.posts && entry.posts[c]))).join('/')}</small>` : '';
    return `<b>${entry.locked ? '🔒' : ''}${h(codes.join(''))}</b>${posts}`;
  }
  function cellTitle(entry, pid, d, iss) {
    const lines = iss ? iss.map((x) => x.msg) : [];
    const req = E.requestOf(state, d, pid);
    if (req) lines.push(`預假：${req.note || (req.off ? '全日' : (req.block || []).join('、') + ' 班')}`);
    if (entry && entry.locked) lines.push('Excel 指定班（固定）');
    return lines.length ? lines.join('\n') : '點擊編輯';
  }

  function renderGrid() {
    const sched = curSched();
    const toolbar = `<div class="toolbar">
      <div class="seg">${[0, 1, 2, 3].map((w) => `<button class="${ui.week === w ? 'on' : ''}" data-act="week" data-w="${w}">第${w + 1}週</button>`).join('')}
        <button class="${ui.week === 4 ? 'on' : ''}" data-act="week" data-w="4">四周全覽</button></div>
      <div class="seg">${[['all', '全部'], ['counter', '櫃檯'], ['nurse', '護理'], ['part', '兼職']].map(([k, n]) => `<button class="${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${n}</button>`).join('')}</div>
      <label class="chk"><input type="checkbox" data-act="showpost" ${ui.showPost ? 'checked' : ''}> 顯示崗位</label>
      <div class="legend"><span class="lg k-adj">AB/BC</span><span class="lg k-gap">AC</span><span class="lg k-single">單節</span><span class="lg late">含晚班</span><span class="lg off-reg">例</span><span class="lg off-rest">休</span><span class="lg off-rest req">預假</span><span class="lg locked">🔒 指定班</span><span class="lg has-issue">法規警示</span></div>
    </div>`;
    if (!sched) return toolbar + emptyState();
    const a = analysis(), st = curStart(), all = E.periodDates(st);
    const dates = ui.week === 4 ? all : all.slice(ui.week * 7, ui.week * 7 + 7);
    const idx = issueIndex(a);
    const compact = ui.week === 4;
    const showPost = ui.showPost && !compact;
    const metrics = {};
    a.metrics.forEach((m) => { metrics[m.id] = m; });

    let html = `<div class="grid-wrap ${compact ? 'compact' : ''}"><table class="grid"><thead><tr><th class="name">同仁</th>`;
    dates.forEach((d) => {
      const dw = E.dow(d);
      html += `<th class="${dw === state.settings.restDow ? 'sun' : dw === 6 ? 'sat' : ''}">${md(d)}<br><span>${DOW[dw]}</span></th>`;
    });
    html += '<th>工時</th><th>例/休</th><th>晚班</th><th>AC</th></tr></thead><tbody>';
    C.GROUPS.forEach((g) => {
      if (ui.filter !== 'all' && ui.filter !== g.id) return;
      const staff = E.activeStaff(state, g.id);
      if (!staff.length) return;
      html += `<tr class="grp"><td colspan="${dates.length + 5}">${h(g.name)}（${staff.length} 人）</td></tr>`;
      staff.forEach((p) => {
        const m = metrics[p.id] || { hours: 0, regular: 0, rest: 0, late: 0, gap: 0 };
        const pIss = idx.person[p.id];
        html += `<tr><td class="name ${pIss ? 'has-issue' : ''}" title="${h(pIss ? pIss.map((x) => x.msg).join('\n') : '')}">${h(p.name)}${p.fixed ? '<em class="tag">固定</em>' : ''}${p.name !== p.id ? `<small>${h(p.id)}${p.title ? '・' + h(p.title) : ''}</small>` : ''}</td>`;
        dates.forEach((d) => {
          const e = sched[p.id] && sched[p.id][d];
          const iss = idx.map[`${p.id}|${d}`];
          html += `<td class="cell ${cellClass(e, d, p.group)} ${iss ? 'has-issue' : ''}" data-act="edit" data-pid="${h(p.id)}" data-d="${d}" title="${h(cellTitle(e, p.id, d, iss))}">${cellInner(e, showPost)}</td>`;
        });
        const hoursCls = p.group !== 'part' && m.hours > state.settings.hoursCap ? 'bad' : p.group !== 'part' && m.hours < state.settings.hoursTarget ? 'low' : '';
        html += `<td class="num ${hoursCls}">${m.hours}</td><td class="num">${p.group === 'part' ? '—' : `${m.regular}/${m.rest}`}</td><td class="num">${m.late}</td><td class="num">${m.gap}</td></tr>`;
      });
    });
    html += '</tbody><tfoot>';
    html += coverageRows(a, dates, compact);
    html += '</tfoot></table></div>';
    return toolbar + html;
  }

  function coverageRows(a, dates, compact) {
    let html = `<tr class="grp"><td colspan="${dates.length + 5}">每節人力（實排／需求）</td></tr>`;
    state.shifts.forEach((s) => {
      if (!dates.some((d) => E.dayShifts(state, d).some((x) => x.code === s.code))) return;
      html += `<tr class="cov"><td class="name" title="${h(X.shiftTimeText(state, s))}">${h(s.code)} ${h(s.start)}-${h(s.end)}</td>`;
      dates.forEach((d) => {
        if (!E.dayShifts(state, d).some((x) => x.code === s.code)) { html += '<td class="na"></td>'; return; }
        const parts = state.stations.map((x) => {
          const c = a.coverage.cells[`${d}|${s.code}|${x.id}`];
          if (!c) return '';
          const need = c.min === c.max ? c.min : `${c.min}-${c.max}`;
          const label = compact ? `${c.n}` : `${h(x.short || x.name)}${c.n}/${need}`;
          return `<span class="${c.status}" title="${h(x.name)} ${c.n}/${need}">${label}</span>`;
        });
        html += `<td class="covcell">${parts.join(compact ? '·' : '<br>')}</td>`;
      });
      html += '<td colspan="4"></td></tr>';
    });
    return html;
  }

  // ---------- 編輯視窗 ----------
  function openEditor(pid, d) {
    const sched = curSched();
    if (!sched) return;
    const e = sched[pid] && sched[pid][d];
    ui.edit = { pid, d, draft: e ? clone(e) : null };
    renderModal();
  }
  function closeEditor() { ui.edit = null; $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

  function draftSched() {
    const sched = clone(curSched());
    const { pid, d, draft } = ui.edit;
    sched[pid] = sched[pid] || {};
    if (draft) sched[pid][d] = draft; else delete sched[pid][d];
    return sched;
  }

  function defaultStation(p, code, d) {
    const sk = E.skillsOf(state, p);
    const a = analysis();
    let best = null;
    sk.forEach((sid) => {
      const c = a && a.coverage.cells[`${d}|${code}|${sid}`];
      const gap = c ? c.min - c.n : 0;
      if (!best || gap > best.gap) best = { sid, gap };
    });
    return best ? best.sid : 'float';
  }

  function renderModal() {
    const { pid, d, draft } = ui.edit;
    const p = staffById(pid);
    if (!p) { closeEditor(); return; }
    const shifts = E.dayShifts(state, d, timeGroupOf(p));
    const combos = E.combosFor(state, shifts);
    const curKey = draft && draft.kind === 'work' ? E.workCodes(draft).join('') : draft ? draft.kind : '';
    const opts = combos.map((c) => {
      const key = c.codes.join('');
      const tag = c.size === 2 ? (c.adjacent ? '' : ' <em>AC型</em>') : '';
      return `<button class="opt ${curKey === key ? 'on' : ''}" data-act="pick" data-codes="${key}">${h(key)}<small>${c.hours}h${tag}</small></button>`;
    }).join('');
    const offs = (p.group === 'part' ? [] : ['例', '休']).map((k) => `<button class="opt ${curKey === k ? 'on' : ''}" data-act="pick" data-kind="${k}">${k}</button>`).join('');
    const clear = `<button class="opt ${!draft ? 'on' : ''}" data-act="pick" data-kind="">清除</button>`;

    let posts = '';
    if (draft && draft.kind === 'work') {
      const sk = E.skillsOf(state, p);
      posts = E.workCodes(draft).map((code) => {
        const post = (draft.posts && draft.posts[code]) || { station: 'float' };
        const st = E.stationById(state, post.station);
        const stationOpts = sk.concat(['float']).map((sid) => `<option value="${h(sid)}" ${post.station === sid ? 'selected' : ''}>${h(stationName(sid))}</option>`).join('');
        let seat = '';
        if (st && st.seats) {
          const max = E.demandOf(state, code, st.id, d).max;
          seat = `<select data-act="seat" data-code="${h(code)}"><option value="0">機動</option>${Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${post.seat === i + 1 ? 'selected' : ''}>第 ${i + 1} 櫃</option>`).join('')}</select>`;
        }
        return `<div class="post-row"><b>${h(code)} 班</b><select data-act="station" data-code="${h(code)}">${stationOpts}</select>${seat}</div>`;
      }).join('');
    }

    const sched = draftSched();
    const iss = A.legalChecks(state, sched, curStart()).filter((x) => x.pid === pid && x.level !== 'info' &&
      (!x.date || Math.abs(E.diffDays(d, x.date)) <= 1 || x.rule === 'consecutive'));
    const cov = A.coverage(state, sched, curStart());
    const covHtml = shifts.map((s) => `<div class="cov-line"><b>${h(s.code)}</b> ${state.stations.map((x) => {
      const c = cov.cells[`${d}|${s.code}|${x.id}`];
      return c ? `<span class="${c.status}">${h(x.name)} ${c.n}/${c.min === c.max ? c.min : c.min + '-' + c.max}</span>` : '';
    }).join(' ')}</div>`).join('');

    const req = E.requestOf(state, d, pid);
    const lock = E.lockOf(state, d, pid);
    const notes = [
      req ? `📝 預假：${h(req.note || (req.off ? '全日休' : (req.block || []).join('、') + ' 班不排'))}` : '',
      lock || p.fixed ? '🔒 Excel 指定班（固定人員，重排時沿用 Excel）' : '',
    ].filter(Boolean).map((x) => `<div class="w info">${x}</div>`).join('');

    const m = $('#modal');
    m.classList.remove('hidden');
    m.innerHTML = `<div class="dialog">
      <div class="dialog-head"><h3>${h(p.name)}（${h(p.id)}・${h(GROUP_NAME[p.group])}）</h3><span>${slash(d)}（週${DOW[E.dow(d)]}）</span></div>
      ${notes ? `<div class="warnings">${notes}</div>` : ''}
      <div class="opts">${opts || '<span class="muted">本日無營業時段</span>'}${offs}${clear}</div>
      ${posts ? `<div class="posts"><h4>崗位</h4>${posts}</div>` : ''}
      <div class="warnings">${iss.length ? iss.map((x) => `<div class="w ${x.level}">⚠ ${h(x.msg)}</div>`).join('') : '<div class="w ok">✓ 此調整符合勞基法檢核</div>'}</div>
      ${covHtml ? `<div class="cov-box"><h4>當日人力（調整後）</h4>${covHtml}</div>` : ''}
      <div class="dialog-foot"><button class="btn" data-act="edit-cancel">取消</button><button class="btn primary" data-act="edit-save">儲存</button></div>
    </div>`;
  }

  function pickOption(btn) {
    const { pid, d } = ui.edit;
    const p = staffById(pid);
    if (btn.dataset.codes) {
      const combo = E.combosFor(state, E.dayShifts(state, d, timeGroupOf(p))).find((cb) => cb.codes.join('') === btn.dataset.codes);
      if (!combo) return;
      const codes = combo.codes.slice();
      const old = ui.edit.draft && ui.edit.draft.posts ? ui.edit.draft.posts : {};
      const posts = {};
      codes.forEach((c) => { posts[c] = old[c] ? old[c] : { station: defaultStation(p, c, d) }; });
      ui.edit.draft = { kind: 'work', shifts: codes, posts, group: p.group };
    } else if (btn.dataset.kind) {
      ui.edit.draft = { kind: btn.dataset.kind };
    } else {
      ui.edit.draft = null;
    }
    renderModal();
  }

  function saveEdit() {
    const { pid, d, draft } = ui.edit;
    const sched = curSched();
    sched[pid] = sched[pid] || {};
    if (draft) sched[pid][d] = draft; else delete sched[pid][d];
    closeEditor();
    commit();
    toast('已更新班表');
  }

  // ---------- 2. 當日崗位 ----------
  function renderDay() {
    const sched = curSched();
    if (!sched) return emptyState();
    const st = curStart(), dates = E.periodDates(st);
    if (!ui.day || !dates.includes(ui.day)) ui.day = dates.includes(E.todayYMD()) ? E.todayYMD() : dates[1];
    const a = analysis();
    const gapDays = new Set(a.coverage.gaps.map((c) => c.date));
    const chips = dates.map((d) => {
      const dw = E.dow(d);
      return `<button class="chip ${d === ui.day ? 'on' : ''} ${dw === state.settings.restDow ? 'sun' : ''}" data-act="day" data-d="${d}">${md(d)}<small>${DOW[dw]}</small>${gapDays.has(d) ? '<i class="dot"></i>' : ''}</button>`;
    }).join('');
    const d = ui.day, shifts = E.dayShifts(state, d);
    let cards = '';
    if (!shifts.length) cards = '<div class="card empty">本日休診（例假）</div>';
    shifts.forEach((s) => {
      const rows = state.stations.map((x) => {
        const c = a.coverage.cells[`${d}|${s.code}|${x.id}`];
        if (!c) return '';
        const names = c.people.slice().sort((p1, p2) => (p1.seat || 99) - (p2.seat || 99))
          .map((p) => `<span class="tag g-${p.group}">${x.seats && p.seat ? `<b>${p.seat}</b> ` : ''}${h(p.name)}</span>`).join('') || '<span class="muted">—</span>';
        const need = c.min === c.max ? c.min : `${c.min}–${c.max}`;
        return `<tr class="${c.status}"><th>${h(x.name)}</th><td class="need">${c.n} / ${need}${c.status === 'short' ? `<em>缺 ${c.min - c.n}</em>` : ''}</td><td>${names}</td></tr>`;
      }).join('');
      const fl = a.coverage.cells[`${d}|${s.code}|float`];
      const float = fl && fl.n ? `<tr><th>機動</th><td></td><td>${fl.people.map((p) => `<span class="tag g-${p.group}">${h(p.name)}</span>`).join('')}</td></tr>` : '';
      cards += `<div class="card shift-card"><h3>${h(s.code)} 班 <span class="muted">${h(X.shiftTimeText(state, s))} ${h(s.name || '')}</span></h3><table class="posts-table">${rows}${float}</table></div>`;
    });
    const off = E.activeStaff(state).filter((p) => p.group !== 'part' && sched[p.id] && sched[p.id][d] && sched[p.id][d].kind !== 'work');
    const offHtml = off.length ? `<div class="card"><h3>休假</h3>${off.map((p) => `<span class="tag">${h(p.name)}（${h(sched[p.id][d].kind)}）</span>`).join('')}</div>` : '';
    const notice = X.lineNotice(state, sched, d);
    return `<div class="toolbar"><input type="date" value="${d}" min="${dates[0]}" max="${dates[27]}" data-act="day-input"><span class="muted">紅點＝當日有人力缺口</span></div>
      <div class="chips">${chips}</div>
      <div class="day-layout"><div class="day-cards">${cards}${offHtml}</div>
      <div class="card line-card"><h3>LINE 通報</h3><textarea readonly id="lineText">${h(notice)}</textarea>
      <button class="btn primary" data-act="copy-line">📋 一鍵複製 LINE 通報</button></div></div>`;
  }

  // ---------- 3. 個人班表 ----------
  function renderPerson() {
    const sched = curSched();
    if (!sched) return emptyState();
    const staff = E.activeStaff(state);
    if (!staff.length) return '<div class="card empty">尚無同仁</div>';
    if (!ui.person || !staffById(ui.person)) ui.person = staff[0].id;
    const p = staffById(ui.person), a = analysis();
    const m = a.metrics.find((x) => x.id === p.id) || A.personMetrics(state, sched, curStart(), p);
    const set = state.settings;
    const select = `<select data-act="person">${C.GROUPS.map((g) => `<optgroup label="${h(g.name)}">${E.activeStaff(state, g.id).map((x) => `<option value="${h(x.id)}" ${x.id === p.id ? 'selected' : ''}>${h(x.name)}（${h(x.id)}）</option>`).join('')}</optgroup>`).join('')}</select>`;
    const pairs = m.adj + m.gap;
    const isPT = p.group === 'part';
    const stat = (label, val, sub, cls) => `<div class="stat ${cls || ''}"><div class="v">${val}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const stats = [
      stat('四週工時', `${m.hours}h`, isPT ? `每週 ${m.weekHours.map((x) => x).join(' / ')}` : `目標 ${set.hoursTarget}～${set.hoursCap}h`, !isPT && m.hours > set.hoursCap ? 'bad' : !isPT && m.hours < set.hoursTarget ? 'low' : 'good'),
      stat('上班日', m.workdays, `${m.sessions} 節`),
      isPT ? stat('可支援', `${p.weeklySlots || 0} 節/週`, `已排 ${m.weekSessions.join(' / ')}`) : stat('例假', m.regular, `需 ${set.regularLeavePer4w}`, m.regular < set.regularLeavePer4w ? 'bad' : ''),
      isPT ? '' : stat('休息日', m.rest, `例＋休 ${m.regular + m.rest}`),
      stat('AB/BC : AC', `${m.adj} : ${m.gap}`, pairs ? `相鄰 ${Math.round((m.adj / pairs) * 100)}%` : '—'),
      stat('晚班（含 C）', m.late, Object.keys(m.byShift).map((k) => `${k}${m.byShift[k]}`).join(' ')),
    ].join('');

    const dates = E.periodDates(curStart());
    let cal = '<div class="cal">' + DOW.map((x) => `<div class="cal-h">${x}</div>`).join('');
    const offset = E.dow(dates[0]);
    for (let i = 0; i < offset; i++) cal += '<div class="cal-d pad"></div>';
    dates.forEach((d) => {
      const e = sched[p.id] && sched[p.id][d];
      cal += `<div class="cal-d ${cellClass(e, d, p.group)}" data-act="edit" data-pid="${h(p.id)}" data-d="${d}"><span class="dd">${md(d)}</span>${cellInner(e, true)}</div>`;
    });
    cal += '</div>';

    let rotation = '';
    const stations = state.stations.filter((x) => (isPT ? E.skillsOf(state, p).includes(x.id) : x.group === p.group));
    if (stations.length > 1 || isPT) {
      const peers = a.metrics.filter((x) => x.group === p.group);
      rotation = `<div class="card"><h3>崗位輪調</h3><div class="rot-cards">${stations.map((x) => {
        const n = m.stations[x.id] || 0;
        const avg = peers.length ? peers.reduce((s, q) => s + (q.stations[x.id] || 0), 0) / peers.length : 0;
        return `<div class="rot"><div class="v">${n}</div><div class="l">${h(x.name)}</div><div class="s">組平均 ${avg.toFixed(1)}</div></div>`;
      }).join('')}${m.stations.float ? `<div class="rot"><div class="v">${m.stations.float}</div><div class="l">機動</div></div>` : ''}</div></div>`;
    }

    const table = `<div class="card"><h3>全員統計</h3><div class="table-wrap"><table class="list"><thead><tr><th>同仁</th><th>組別</th><th>工時</th><th>上班日</th><th>例</th><th>休</th><th>AB/BC</th><th>AC</th><th>晚班</th>${state.stations.map((x) => `<th>${h(x.short || x.name)}</th>`).join('')}</tr></thead><tbody>${
      a.metrics.map((x) => `<tr class="${x.id === p.id ? 'on' : ''}" data-act="person-row" data-pid="${h(x.id)}"><td>${h(x.name)}</td><td>${h(GROUP_NAME[x.group])}</td><td class="num">${x.hours}</td><td class="num">${x.workdays}</td><td class="num">${x.group === 'part' ? '—' : x.regular}</td><td class="num">${x.group === 'part' ? '—' : x.rest}</td><td class="num">${x.adj}</td><td class="num">${x.gap}</td><td class="num">${x.late}</td>${state.stations.map((s) => `<td class="num">${x.stations[s.id] || ''}</td>`).join('')}</tr>`).join('')
    }</tbody></table></div></div>`;

    return `<div class="toolbar">${select}<span class="muted">點日曆格可直接調班</span></div>
      <div class="stats">${stats}</div>
      <div class="person-layout"><div class="card"><h3>${h(p.name)} 的四週班表</h3>${cal}</div>${rotation}</div>${table}`;
  }

  // ---------- 4. 法規平衡 ----------
  const RULES = [
    { id: 'hours', label: '四週正常工時 ≤ 上限（§30-1）', rules: ['hours'] },
    { id: 'regular', label: '四週例假 ≥ 4 天（§30-1）', rules: ['regular'] },
    { id: 'biweekly', label: '每兩週例假 ≥ 2 天（§30-1）', rules: ['biweekly'] },
    { id: 'offDays', label: '例假＋休息日 ≥ 8 天', rules: ['offDays'] },
    { id: 'daily', label: '單日正常工時 ≤ 10 小時（§30-1）', rules: ['daily'] },
    { id: 'rest', label: '輪班間隔 ≥ 11 小時（§34）', rules: ['rest'] },
    { id: 'consecutive', label: '連續上班 ≤ 6 天（七休一）', rules: ['consecutive'] },
    { id: 'restDow', label: '週日例假不排班', rules: ['restDow'] },
    { id: 'valid', label: '班別有效（不重疊、每日 ≤ 2 節、在營業時段內）', rules: ['sessions', 'overlap', 'invalidShift'] },
  ];

  function bar(value, max, cls, label) {
    const w = max ? Math.min(100, (value / max) * 100) : 0;
    return `<div class="bar"><div class="fill ${cls || ''}" style="width:${w}%"></div><span>${label != null ? label : value}</span></div>`;
  }

  function renderLegal() {
    const sched = curSched();
    if (!sched) return emptyState();
    const a = analysis(), set = state.settings;
    const checklist = RULES.map((r) => {
      const list = a.issues.filter((x) => r.rules.includes(x.rule));
      const who = [...new Set(list.map((x) => staffById(x.pid) ? staffById(x.pid).name : x.pid))];
      return `<li class="${list.length ? 'fail' : 'pass'}"><span class="mark">${list.length ? '✗' : '✓'}</span>${h(r.label)}${list.length ? `<small>${list.length} 筆：${h(who.join('、'))}</small>` : ''}</li>`;
    }).join('');
    const warns = a.issues.filter((x) => x.level === 'warn');
    const infos = a.issues.filter((x) => x.level === 'info');

    const ft = a.metrics.filter((m) => m.group !== 'part');
    const maxH = Math.max(set.hoursCap + 10, ...a.metrics.map((m) => m.hours));
    const hoursChart = a.metrics.map((m) => {
      const cls = m.group === 'part' ? 'pt' : m.hours > set.hoursCap ? 'bad' : m.hours < set.hoursTarget ? 'low' : 'good';
      return `<div class="chart-row"><label>${h(m.name)}</label>${bar(m.hours, maxH, cls, `${m.hours}h`)}</div>`;
    }).join('');
    const vline = (v, cls) => `<div class="vline ${cls}" style="left:calc(90px + (100% - 90px) * ${v / maxH})"><span>${v}</span></div>`;
    const marks = vline(set.hoursTarget, 'target') + vline(set.hoursCap, 'cap');
    const maxLate = Math.max(1, ...ft.map((m) => m.late));
    const lateChart = ft.map((m) => `<div class="chart-row"><label>${h(m.name)}</label>${bar(m.late, maxLate, 'late', `${m.late} 次（AC ${m.gap}）`)}</div>`).join('');
    const nurseStations = state.stations.filter((x) => x.group === 'nurse');
    const nurses = a.metrics.filter((m) => m.group === 'nurse');
    const maxS = Math.max(1, ...nurses.map((m) => nurseStations.reduce((s, x) => s + (m.stations[x.id] || 0), 0) + (m.stations.float || 0)));
    const rotChart = nurses.map((m) => `<div class="chart-row"><label>${h(m.name)}</label><div class="bar stack">${nurseStations.map((x, i) => {
      const n = m.stations[x.id] || 0;
      return `<div class="seg s${i}" style="width:${(n / maxS) * 100}%" title="${h(x.name)} ${n}">${n || ''}</div>`;
    }).join('')}${m.stations.float ? `<div class="seg sf" style="width:${(m.stations.float / maxS) * 100}%" title="機動">${m.stations.float}</div>` : ''}</div></div>`).join('');
    const rotLegend = nurseStations.map((x, i) => `<span class="lg s${i}">${h(x.name)}</span>`).join('');

    const fairCards = ['counter', 'nurse', 'part'].filter((g) => a.fairness[g]).map((g) => {
      const f = a.fairness[g];
      const rows = g === 'part'
        ? `<li>時段利用率 ${(f.utilization.rate * 100).toFixed(0)}%</li>`
        : `<li>工時 ${f.hours.score}（差 ${f.hours.spread}h）</li><li>晚班 ${f.late.score}（差 ${f.late.spread} 次）</li><li>AC ${f.gap.score}（差 ${f.gap.spread} 次）</li>${f.stations ? Object.keys(f.stations).map((k) => `<li>${h(stationName(k))} ${f.stations[k].score}（差 ${f.stations[k].spread}）</li>`).join('') : ''}`;
      return `<div class="fair"><div class="score ${f.overall >= 85 ? 'good' : f.overall >= 70 ? 'mid' : 'bad'}">${f.overall}</div><div><b>${h(GROUP_NAME[g])}</b><ul>${rows}</ul></div></div>`;
    }).join('');

    const cap = a.capacity;
    const capRows = ['counter', 'nurse'].map((g) => {
      const c = cap.groups[g];
      return `<tr><td>${h(GROUP_NAME[g])}</td><td class="num">${c.staff}</td><td class="num">${c.need}（每週約 ${Math.round(c.need / 4)}）</td><td class="num">${c.supply}</td><td class="num ${c.short ? 'bad' : ''}">${c.short}</td></tr>`;
    }).join('');
    const gapSum = {};
    a.coverage.gaps.forEach((c) => {
      const k = `${c.code}|${c.station}`;
      gapSum[k] = (gapSum[k] || 0) + (c.min - c.n);
    });
    const gapList = Object.keys(gapSum).sort((x, y) => gapSum[y] - gapSum[x]).map((k) => {
      const [code, sid] = k.split('|');
      return `<span class="tag bad">${h(code)} 班 ${h(stationName(sid))} 缺 ${gapSum[k]}</span>`;
    }).join('') || '<span class="tag good">各節最低人力皆已滿足</span>';
    const advice = cap.feasible
      ? '依目前名單，最低需求在產能範圍內。'
      : `最低需求超出可供給人力約 ${cap.netShort} 人次節（每週約 ${Math.ceil(cap.netShort / 4)}）。可：增加兼職人數或每週時段、調降每節最低需求（設定頁滑桿）、或增聘正職。系統不會以違法加班補足缺口。`;

    return `<div class="legal-layout">
      <div class="card"><h3>§30-1 四週變形工時檢核</h3><ul class="checklist">${checklist}</ul>
        ${warns.length ? `<details><summary>提醒 ${warns.length} 筆</summary><ul class="issues">${warns.map((x) => `<li>${h(staffById(x.pid) ? staffById(x.pid).name : x.pid)} ${h(x.date || '')} ${h(x.msg)}</li>`).join('')}</ul></details>` : ''}
        ${infos.length ? `<details><summary>工時低於院內目標 ${infos.length} 人</summary><ul class="issues">${infos.map((x) => `<li>${h(staffById(x.pid) ? staffById(x.pid).name : x.pid)}：${h(x.msg)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div class="card"><h3>公平度</h3><div class="fair-cards">${fairCards}</div></div>
      <div class="card"><h3>四週工時 <small class="muted">虛線：目標 ${set.hoursTarget}h／上限 ${set.hoursCap}h</small></h3><div class="chart hours-chart">${hoursChart}${marks}</div></div>
      <div class="card"><h3>晚班（C）分布</h3><div class="chart">${lateChart}</div></div>
      ${nurses.length ? `<div class="card"><h3>護理崗位輪調</h3><div class="legend">${rotLegend}<span class="lg sf">機動</span></div><div class="chart">${rotChart}</div></div>` : ''}
      <div class="card"><h3>人力產能與缺口</h3>
        <table class="list"><thead><tr><th>組別</th><th>人數</th><th>四週最低需求（人次節）</th><th>正職可供給</th><th>差額</th></tr></thead><tbody>${capRows}
        <tr><td>兼職</td><td class="num">${cap.part.staff}</td><td></td><td class="num">${cap.part.supply}</td><td></td></tr></tbody></table>
        <p class="advice ${cap.feasible ? 'good' : 'warn'}">${h(advice)}</p>
        <div class="gap-tags">${gapList}</div>
      </div>
    </div>`;
  }

  // ---------- 5. 智慧排班與設定 ----------
  function renderSettings() {
    const set = state.settings;
    const ptCount = state.staff.filter((p) => p.group === 'part').length;
    const cap = A.capacity(state, curStart());

    const demandSliders = state.stations.map((x) => {
      const q = E.demandOf(state, state.shifts[0] ? state.shifts[0].code : '', x.id);
      return `<div class="slider-row"><label>${h(x.name)}</label>
        <span>最少 <input type="range" min="0" max="8" value="${q.min}" data-act="demand-all" data-sid="${h(x.id)}" data-k="min"><b>${q.min}</b></span>
        <span>最多 <input type="range" min="0" max="8" value="${q.max}" data-act="demand-all" data-sid="${h(x.id)}" data-k="max"><b>${q.max}</b></span></div>`;
    }).join('');
    const demandTable = `<table class="list demand"><thead><tr><th>班別</th>${state.stations.map((x) => `<th>${h(x.name)}<br><small>最少–最多</small></th>`).join('')}</tr></thead><tbody>${
      state.shifts.map((s) => `<tr><td><b>${h(s.code)}</b></td>${state.stations.map((x) => {
        const q = E.demandOf(state, s.code, x.id);
        return `<td><input type="number" min="0" max="12" value="${q.min}" data-act="demand" data-code="${h(s.code)}" data-sid="${h(x.id)}" data-k="min">–<input type="number" min="0" max="12" value="${q.max}" data-act="demand" data-code="${h(s.code)}" data-sid="${h(x.id)}" data-k="max"></td>`;
      }).join('')}</tr>`).join('')
    }</tbody></table>`;

    const dayBoxes = (s, i) => [1, 2, 3, 4, 5, 6, 0].map((dw) => `<label class="dchk"><input type="checkbox" data-act="shift-day" data-i="${i}" data-dow="${dw}" ${(s.days || []).includes(dw) ? 'checked' : ''}>${DOW[dw]}</label>`).join('');
    const shiftRows = state.shifts.map((s, i) => {
      const ct = E.shiftTime(s, 'counter');
      const hn = E.shiftHours(s), hc = E.shiftHours(ct);
      return `<tr>
      <td><input class="code" value="${h(s.code)}" maxlength="3" data-act="shift-field" data-i="${i}" data-k="code"></td>
      <td><input value="${h(s.name || '')}" data-act="shift-field" data-i="${i}" data-k="name"></td>
      <td class="tpair"><input type="time" value="${h(s.start)}" data-act="shift-field" data-i="${i}" data-k="start">–<input type="time" value="${h(s.end)}" data-act="shift-field" data-i="${i}" data-k="end"></td>
      <td class="tpair ${ct !== s ? 'alt' : ''}"><input type="time" value="${h(ct.start)}" data-act="shift-ctime" data-i="${i}" data-k="start">–<input type="time" value="${h(ct.end)}" data-act="shift-ctime" data-i="${i}" data-k="end"></td>
      <td class="num">${hn === hc ? `${hn}h` : `護 ${hn}h／櫃 ${hc}h`}</td>
      <td>${dayBoxes(s, i)}</td>
      <td><button class="btn small danger" data-act="shift-del" data-i="${i}">刪除</button></td></tr>`;
    }).join('');

    const staffSection = C.GROUPS.map((g) => {
      const list = state.staff.filter((p) => p.group === g.id);
      const stations = state.stations.filter((x) => g.id === 'part' || x.group === g.id);
      const rows = list.map((p) => {
        const sk = E.skillsOf(state, p);
        const skills = stations.length > 1 ? stations.map((x) => `<label class="dchk"><input type="checkbox" data-act="staff-skill" data-pid="${h(p.id)}" data-sid="${h(x.id)}" ${sk.includes(x.id) ? 'checked' : ''}>${h(x.short || x.name)}</label>`).join('') : '<span class="muted">櫃檯</span>';
        const pt = g.id === 'part'
          ? `<td><input type="number" min="0" max="10" value="${Number(p.weeklySlots) || 0}" data-act="staff-field" data-pid="${h(p.id)}" data-k="weeklySlots" class="narrow"> 節/週</td>
             <td>${state.shifts.map((s) => `<label class="dchk"><input type="checkbox" data-act="staff-avail" data-pid="${h(p.id)}" data-code="${h(s.code)}" ${E.availOk(p, s.code) ? 'checked' : ''}>${h(s.code)}</label>`).join('')}</td>`
          : '';
        const m = metricOf(p.id);
        return `<tr class="${p.active === false ? 'inactive' : ''}"><td class="muted">${h(p.id)}</td>
          <td><input value="${h(p.name)}" data-act="staff-field" data-pid="${h(p.id)}" data-k="name"></td>
          <td><input value="${h(p.title || '')}" placeholder="${h(g.name)}" data-act="staff-field" data-pid="${h(p.id)}" data-k="title"></td>
          <td class="num">${m ? `${m.hours}h<small class="muted">／${m.sessions}節</small>` : '—'}${p.fixed ? '<em class="tag">固定</em>' : ''}</td>
          <td>${skills}</td>${pt}
          <td><label class="dchk"><input type="checkbox" data-act="staff-active" data-pid="${h(p.id)}" ${p.active !== false ? 'checked' : ''}>在職</label></td>
          <td><button class="btn small danger" data-act="staff-del" data-pid="${h(p.id)}">刪除</button></td></tr>`;
      }).join('');
      const head = `<th>編號</th><th>姓名</th><th>職務</th><th>本期工時</th><th>可擔任崗位</th>${g.id === 'part' ? '<th>每週可支援</th><th>可支援時段</th>' : ''}<th>狀態</th><th></th>`;
      return `<div class="staff-group"><div class="staff-head"><h4>${h(g.name)}（${list.length}）</h4><button class="btn small" data-act="staff-add" data-g="${g.id}">＋ 新增</button></div>
        <div class="table-wrap"><table class="list"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }).join('');

    const num = (k, label, min, max, step) => `<label class="field"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step || 1}" value="${set[k]}" data-act="setting" data-k="${k}"></label>`;

    return `<div class="settings-layout">
      ${importCard()}
      <div class="card"><h3>⚡ 智慧排班</h3>
        <p class="muted">依四週變形工時、11 小時間隔、七休一自動排定；AB/BC 優先，人力不足時才用 AC；晚班、AC、崗位與工時自動平均。手動調整後再按會覆蓋本期。</p>
        <div class="btn-row"><button class="btn primary" data-act="generate" data-n="1">重排本期</button>
        <button class="btn" data-act="generate" data-n="3">連排 3 期</button><button class="btn" data-act="generate" data-n="6">連排 6 期</button></div>
        <p class="advice ${cap.feasible ? 'good' : 'warn'}">產能預估：櫃檯缺 ${cap.groups.counter.short}、護理缺 ${cap.groups.nurse.short}、兼職可補 ${cap.part.supply} 人次節／四週 → ${cap.feasible ? '可滿足最低需求' : `仍缺約 ${cap.netShort}`}</p>
      </div>
      <div class="card"><h3>每節人力需求</h3>
        ${E.periodDates(curStart()).some((d) => state.dateDemand && state.dateDemand[d]) ? '<p class="advice warn">本期使用 Excel 匯入的逐日需求；以下滑桿只影響未匯入的日期。</p>' : ''}
        <p class="muted">滑桿＝套用到所有班別；下表可逐班微調。</p>${demandSliders}
        <details><summary>逐班別微調</summary>${demandTable}</details>
        <div class="slider-row"><label>兼職人數</label><span><input type="range" min="0" max="8" value="${ptCount}" data-act="pt-count"><b>${ptCount}</b> 人</span></div>
      </div>
      <div class="card wide"><h3>班別時段（可新增、修改、刪除）</h3>
        <div class="table-wrap"><table class="list"><thead><tr><th>代碼</th><th>名稱</th><th>護理／兼職時間</th><th>醫務櫃檯時間</th><th>時數</th><th>適用星期</th><th></th></tr></thead><tbody>${shiftRows}</tbody></table></div>
        <button class="btn small" data-act="shift-add">＋ 新增班別</button>
        <p class="muted">醫務櫃檯時間與護理相同時沿用；不同時（底色標示）櫃檯同仁及支援櫃檯的兼職依櫃檯時間計工時與間隔。相鄰兩節（如 AB、BC）視為連續班；中間隔一節（如 AC）視為跨節班。C 班結束時間晚於隔日最早班別前 ${set.minRestHours} 小時，系統會自動避免隔日排早班。</p>
      </div>
      <div class="card wide"><h3>同仁名單（可新增、修改姓名、刪除）</h3>${staffSection}</div>
      <div class="card"><h3>法規與院內規則</h3><div class="fields">
        <label class="field"><span>院所名稱</span><input value="${h(set.orgName)}" data-act="setting" data-k="orgName" data-type="text"></label>
        <label class="field"><span>期別起算日（建議週日）</span><input type="date" value="${h(set.periodAnchor)}" data-act="setting" data-k="periodAnchor" data-type="text"></label>
        ${num('hoursCap', '四週工時上限 h', 100, 200)}${num('hoursTarget', '四週工時目標 h', 0, 200)}
        ${num('maxDailyHours', '單日工時上限 h', 4, 12, 0.5)}${num('minRestHours', '輪班最少間隔 h', 8, 16, 0.5)}
        ${num('maxConsecutive', '最多連續上班天數', 1, 12)}${num('restDaysPer4w', '四週休息日天數', 0, 8)}${num('regularLeavePer4w', '四週例假天數', 0, 8)}
        <label class="field chk"><input type="checkbox" data-act="setting" data-k="allowGapPair" data-type="bool" ${set.allowGapPair !== false ? 'checked' : ''}><span>人力不足時允許 AC 跨節班</span></label>
        <label class="field chk"><input type="checkbox" data-act="setting" data-k="protectHours" data-type="bool" ${set.protectHours !== false ? 'checked' : ''}><span>優先確保正職工時 ≥ 目標（週五晚班者週六排休，避免只上單節 E；週六人力會略減）</span></label>
      </div></div>
      <div class="card"><h3>匯出與資料</h3><div class="btn-row wrap">
        <button class="btn" data-act="export-csv">班表 CSV</button>
        <button class="btn" data-act="export-post">崗位明細 CSV</button>
        <button class="btn" data-act="copy-tsv">複製班表到剪貼簿</button>
        <button class="btn" data-act="backup">備份 JSON</button>
        <label class="btn">還原備份<input type="file" accept=".json" data-act="restore" hidden></label>
        <button class="btn danger" data-act="reset">恢復預設</button></div>
        <p class="muted">剪貼簿內容為 Tab 分隔，可直接貼到 Excel／Google 試算表。資料僅存在本機瀏覽器。</p>
      </div>
    </div>`;
  }

  function importCard() {
    const info = state.importInfo;
    const head = `<h3>📥 匯入 Excel 預估人班表</h3>
      <p class="muted">每週一區塊（星期／日期／行事曆／班別／診間／崗位）。「醫務」「護理」格＝該節需求；寫名字＝指定班；「支援」＝需兼職或外援；行事曆「某某休／午休／晚休」＝預假。連續四週自動成為一期，可一次匯入多期。</p>
      <label class="btn primary">選擇 Excel 檔<input type="file" accept=".xlsx,.xls,.xlsm" data-act="import-xlsx" hidden></label>`;
    const builtIn = Object.entries(presets()).map(([id, p]) => `<button class="btn small" data-act="load-preset" data-id="${h(id)}">載入內建：${h(p.label)}</button>`).join(' ');
    if (!info) return `<div class="card wide">${head} ${builtIn}</div>`;
    const roleName = { pool: '系統排班', fixedFT: '固定班（正職）', fixedPT: '固定班（兼職）' };
    const byRole = {};
    info.roles.forEach((r) => { (byRole[r.role] = byRole[r.role] || []).push(r.title ? `${r.name}・${r.title}` : r.name); });
    const ext = Object.entries(info.external || {}).map(([k, v]) => `${k}×${v}`).join('、');
    const dm = info.demand || {};
    return `<div class="card wide">${head}
      ${builtIn} <button class="btn small danger" data-act="import-clear">清除匯入資料</button>
      <div class="import-info">
        <p><b>${h(info.file || 'Excel')}</b>｜${h(slash(info.dates[0]))}~${h(slash(info.dates[1]))}｜${info.weeks} 週 → ${info.periods.length} 期（${info.periods.map(slash).join('、')} 起）</p>
        <p>原表人力池：醫務 ${h(info.poolSize.counter ?? '—')} 人、護理 ${h(info.poolSize.nurse ?? '—')} 人｜需求節次：醫務 ${dm.pool ? dm.pool.counter : 0}、護理 ${dm.pool ? dm.pool.nurse : 0}、指定 ${dm.named || 0}、支援 ${dm.support || 0}${dm.crossRole ? `（護理支援櫃台 ${dm.crossRole} 節計入跟診）` : ''}</p>
        ${Object.keys(byRole).map((k) => `<p>${roleName[k] || k}：${h(byRole[k].join('、'))}</p>`).join('')}
        <p>預假已套用 ${info.leaveApplied} 筆${info.leaveFixed && info.leaveFixed.length ? `；固定班人員的休假已含在 Excel 指定班中（${info.leaveFixed.length} 筆）` : ''}</p>
        ${ext ? `<p class="muted">院外／他院人力（不列入本系統）：${h(ext)}</p>` : ''}
        ${info.unresolved && info.unresolved.length ? `<p class="advice warn">無法對應名單的行事曆註記：${h(info.unresolved.join('、'))}</p>` : ''}
      </div></div>`;
  }

  function importExcel(file) {
    if (!window.XLSX || !window.RosterImport) { toast('匯入元件未載入'); return; }
    const roc = /^(\d{3})/.exec(file.name);
    const year = roc ? Number(roc[1]) + 1911 : new Date().getFullYear();
    file.arrayBuffer().then((buf) => {
      const parsed = window.RosterImport.parseWorkbook(window.XLSX, buf, { year });
      if (!parsed.dates.length) { toast('找不到「星期／日期／班別」區塊，請確認格式'); return; }
      const last = parsed.dates[parsed.dates.length - 1];
      if (!confirm(`偵測到 ${parsed.weeks.length} 週（${slash(parsed.dates[0])}~${slash(last)}）、${parsed.staffNames.length} 位同仁。\n匯入後以 Excel 名單取代正職名單（保留現有兼職），並重排涵蓋的期別，確定？`)) return;
      const sum = window.RosterImport.applyToState(state, parsed, { fileName: file.name });
      sum.periods.forEach((p) => { state.schedules[p] = E.generate(state, p); });
      ui.tab = 'grid';
      ui.demandChanged = false;
      commit();
      const a = analysis();
      toast(`已匯入 ${sum.periods.length} 期｜違規 ${a ? a.summary.errors : 0}｜缺口 ${a ? a.summary.shortSessions : 0} 人次節`);
    }).catch((e) => toast('匯入失敗：' + e.message));
  }

  // ---------- 設定變更 ----------
  function markChanged() { ui.demandChanged = true; invalidate(); save(); }

  function renameShift(i, code) {
    code = code.trim().toUpperCase();
    const old = state.shifts[i].code;
    if (!code || code === old) return false;
    if (state.shifts.some((s) => s.code === code)) { toast(`代碼 ${code} 已存在`); return false; }
    state.shifts[i].code = code;
    if (state.demand[old]) { state.demand[code] = state.demand[old]; delete state.demand[old]; }
    Object.values(state.schedules).forEach((sched) => Object.values(sched).forEach((days) => Object.values(days).forEach((e) => {
      if (!e || e.kind !== 'work') return;
      e.shifts = e.shifts.map((c) => (c === old ? code : c));
      if (e.posts && e.posts[old]) { e.posts[code] = e.posts[old]; delete e.posts[old]; }
    })));
    state.staff.forEach((p) => { if (Array.isArray(p.avail)) p.avail = p.avail.map((c) => (c === old ? code : c)); });
    return true;
  }

  function deleteShift(i) {
    const code = state.shifts[i].code;
    state.shifts.splice(i, 1);
    C.ensureDemand(state);
    Object.values(state.schedules).forEach((sched) => Object.values(sched).forEach((days) => Object.keys(days).forEach((d) => {
      const e = days[d];
      if (!e || e.kind !== 'work') return;
      e.shifts = e.shifts.filter((c) => c !== code);
      if (e.posts) delete e.posts[code];
      if (!e.shifts.length) delete days[d];
    })));
    state.staff.forEach((p) => { if (Array.isArray(p.avail)) p.avail = p.avail.filter((c) => c !== code); });
  }

  function addShift() {
    const used = new Set(state.shifts.map((s) => s.code));
    let code = 'F';
    for (let c = 70; c < 91; c++) { if (!used.has(String.fromCharCode(c))) { code = String.fromCharCode(c); break; } }
    state.shifts.push({ code, name: '新班別', start: '18:00', end: '21:00', days: [1, 2, 3, 4, 5] });
    C.ensureDemand(state);
    state.stations.forEach((x) => { state.demand[code][x.id] = { min: 0, max: x.max }; });
  }

  function removeStaff(pid) {
    state.staff = state.staff.filter((p) => p.id !== pid);
    Object.values(state.schedules).forEach((sched) => { delete sched[pid]; });
  }

  function setPtCount(n) {
    let pts = state.staff.filter((p) => p.group === 'part');
    while (pts.length < n) {
      const id = C.nextId(state, 'part');
      state.staff.push(C.newStaff('part', id, Number(id.slice(1))));
      pts = state.staff.filter((p) => p.group === 'part');
    }
    while (pts.length > n) {
      removeStaff(pts[pts.length - 1].id);
      pts = state.staff.filter((p) => p.group === 'part');
    }
  }

  // ---------- 事件 ----------
  document.addEventListener('click', (ev) => {
    const tab = ev.target.closest('[data-tab]');
    if (tab) { ui.tab = tab.dataset.tab; render(); return; }
    if (ev.target.id === 'modal') { closeEditor(); return; }
    const t = ev.target.closest('[data-act]');
    if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    const act = t.dataset.act;
    switch (act) {
      case 'period': state.periodStart = E.addDays(curStart(), 28 * Number(t.dataset.step)); commit(); break;
      case 'period-today': state.periodStart = E.alignPeriod(state.settings.periodAnchor, E.todayYMD()); commit(); break;
      case 'generate': {
        const n = Number(t.dataset.n) || 1;
        if (curSched() && !confirm(`將重新排定 ${n} 期，覆蓋現有班表（含手動調整），確定？`)) return;
        generate(n);
        break;
      }
      case 'week': ui.week = Number(t.dataset.w); render(); break;
      case 'filter': ui.filter = t.dataset.f; render(); break;
      case 'edit': openEditor(t.dataset.pid, t.dataset.d); break;
      case 'pick': pickOption(t); break;
      case 'edit-cancel': closeEditor(); break;
      case 'edit-save': saveEdit(); break;
      case 'day': ui.day = t.dataset.d; render(); break;
      case 'copy-line': copyText($('#lineText').value).then((ok) => toast(ok ? '已複製 LINE 通報' : '複製失敗，請手動選取')); break;
      case 'person-row': ui.person = t.dataset.pid; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'export-csv': {
        const s = curSched();
        if (!s) { toast('本期尚未排班'); return; }
        download(`班表_${curStart()}.csv`, X.buildCSV(state, s, curStart()));
        break;
      }
      case 'export-post': {
        const s = curSched();
        if (!s) { toast('本期尚未排班'); return; }
        download(`崗位明細_${curStart()}.csv`, X.buildPostCSV(state, s, curStart()));
        break;
      }
      case 'copy-tsv': {
        const s = curSched();
        if (!s) { toast('本期尚未排班'); return; }
        copyText(X.buildTSV(state, s, curStart())).then((ok) => toast(ok ? '已複製，可貼到 Excel' : '複製失敗'));
        break;
      }
      case 'backup': download(`排班備份_${E.todayYMD()}.json`, JSON.stringify(state, null, 2), 'application/json'); break;
      case 'load-preset': {
        const pre = presets()[t.dataset.id];
        if (!pre || !confirm(`載入「${pre.label}」？目前排班資料將被取代。`)) return;
        loadPreset(t.dataset.id);
        ui.tab = 'grid';
        ui.demandChanged = false;
        commit();
        toast(`已載入 ${pre.label}`);
        break;
      }
      case 'import-clear':
        if (!confirm('清除匯入的逐日需求、指定班與預假？（名單保留，需重新排班）')) return;
        state.dateDemand = {};
        state.locks = {};
        state.requests = {};
        state.importInfo = null;
        state.staff.forEach((p) => { delete p.fixed; });
        markChanged(); render();
        break;
      case 'reset':
        if (!confirm('恢復預設會清除所有名單、班別與班表，確定？')) return;
        state = C.createState();
        ui.demandChanged = false;
        commit();
        break;
      case 'shift-add': addShift(); markChanged(); render(); break;
      case 'shift-del': {
        const s = state.shifts[Number(t.dataset.i)];
        if (!confirm(`刪除 ${s.code} 班？已排入此班的格子也會移除。`)) return;
        deleteShift(Number(t.dataset.i));
        markChanged(); render();
        break;
      }
      case 'staff-add': {
        const g = t.dataset.g, id = C.nextId(state, g);
        state.staff.push(C.newStaff(g, id, Number(id.slice(1))));
        markChanged(); render();
        break;
      }
      case 'staff-del': {
        const p = staffById(t.dataset.pid);
        if (!confirm(`刪除 ${p.name}（${p.id}）？其班表也會移除。`)) return;
        removeStaff(p.id);
        markChanged(); render();
        break;
      }
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target, act = t.dataset && t.dataset.act;
    if (act === 'demand-all' || act === 'pt-count') {
      const b = t.parentElement.querySelector('b');
      if (b) b.textContent = t.value;
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target, act = t.dataset && t.dataset.act;
    if (!act) return;
    switch (act) {
      case 'showpost': ui.showPost = t.checked; render(); break;
      case 'day-input': if (t.value) { ui.day = t.value; render(); } break;
      case 'person': ui.person = t.value; render(); break;
      case 'station': {
        const post = ui.edit.draft.posts[t.dataset.code] = ui.edit.draft.posts[t.dataset.code] || {};
        post.station = t.value;
        delete post.seat;
        renderModal();
        break;
      }
      case 'seat': ui.edit.draft.posts[t.dataset.code].seat = Number(t.value); renderModal(); break;
      case 'demand-all': {
        const v = Number(t.value), sid = t.dataset.sid, k = t.dataset.k;
        state.shifts.forEach((s) => {
          const q = state.demand[s.code][sid];
          q[k] = v;
          if (k === 'min' && q.max < v) q.max = v;
          if (k === 'max' && q.min > v) q.min = v;
        });
        markChanged(); render();
        break;
      }
      case 'demand': {
        const q = state.demand[t.dataset.code][t.dataset.sid];
        q[t.dataset.k] = Math.max(0, Number(t.value) || 0);
        if (q.max < q.min) { if (t.dataset.k === 'min') q.max = q.min; else q.min = q.max; }
        markChanged(); render();
        break;
      }
      case 'pt-count': setPtCount(Number(t.value)); markChanged(); render(); break;
      case 'shift-field': {
        const i = Number(t.dataset.i), k = t.dataset.k;
        if (k === 'code') { if (!renameShift(i, t.value)) { render(); return; } }
        else state.shifts[i][k] = t.value;
        if ((k === 'start' || k === 'end') && E.toMin(state.shifts[i].end) <= E.toMin(state.shifts[i].start)) toast('結束時間需晚於開始時間');
        markChanged(); render();
        break;
      }
      case 'shift-ctime': {
        const s = state.shifts[Number(t.dataset.i)];
        const cur = E.shiftTime(s, 'counter');
        const next = { start: cur.start, end: cur.end };
        next[t.dataset.k] = t.value;
        s.groupTimes = Object.assign({}, s.groupTimes);
        if (next.start === s.start && next.end === s.end) delete s.groupTimes.counter;
        else s.groupTimes.counter = next;
        if (!Object.keys(s.groupTimes).length) delete s.groupTimes;
        if (E.toMin(next.end) <= E.toMin(next.start)) toast('結束時間需晚於開始時間');
        markChanged(); render();
        break;
      }
      case 'shift-day': {
        const s = state.shifts[Number(t.dataset.i)], dw = Number(t.dataset.dow);
        s.days = (s.days || []).filter((x) => x !== dw);
        if (t.checked) s.days.push(dw);
        s.days.sort();
        markChanged(); render();
        break;
      }
      case 'staff-field': {
        const p = staffById(t.dataset.pid);
        const k = t.dataset.k;
        p[k] = k === 'weeklySlots' ? Math.max(0, Number(t.value) || 0) : k === 'title' ? t.value.trim() : t.value.trim() || p.id;
        if (k === 'name' || k === 'title') { invalidate(); save(); render(); } else { markChanged(); render(); }
        break;
      }
      case 'staff-skill': {
        const p = staffById(t.dataset.pid);
        const sk = new Set(E.skillsOf(state, p));
        if (t.checked) sk.add(t.dataset.sid); else sk.delete(t.dataset.sid);
        if (!sk.size) { toast('至少保留一個崗位'); render(); return; }
        p.skills = [...sk];
        markChanged(); render();
        break;
      }
      case 'staff-avail': {
        const p = staffById(t.dataset.pid);
        const av = new Set(Array.isArray(p.avail) ? p.avail : state.shifts.map((s) => s.code));
        if (t.checked) av.add(t.dataset.code); else av.delete(t.dataset.code);
        p.avail = av.size === state.shifts.length ? null : [...av];
        markChanged(); render();
        break;
      }
      case 'staff-active': staffById(t.dataset.pid).active = t.checked; markChanged(); render(); break;
      case 'setting': {
        const k = t.dataset.k, type = t.dataset.type;
        state.settings[k] = type === 'bool' ? t.checked : type === 'text' ? t.value : Number(t.value);
        if (k === 'periodAnchor' && t.value) state.periodStart = E.alignPeriod(t.value, curStart());
        if (k === 'orgName') { invalidate(); save(); render(); } else { markChanged(); render(); }
        break;
      }
      case 'import-xlsx': {
        const f = t.files && t.files[0];
        t.value = '';
        if (f) importExcel(f);
        break;
      }
      case 'restore': {
        const f = t.files && t.files[0];
        if (!f) return;
        f.text().then((txt) => {
          state = C.normalize(JSON.parse(txt));
          commit();
          toast('已還原備份');
        }).catch((e) => toast('還原失敗：' + e.message));
        break;
      }
      default: break;
    }
  });

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.edit) closeEditor(); });

  render();
})();
