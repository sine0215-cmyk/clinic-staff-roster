(function () {
  const Store = window.RosterStore;
  const Rules = window.RosterRules;
  const Scheduler = window.RosterScheduler;
  const Auth = window.RosterAuth;
  const Excel = window.RosterExcel;

  let state = Store.load();
  Auth.ensureAccounts(state, Store.ROLES);
  state = Store.migratePeriods(state);
  Store.save(state);

  let session = Auth.loadSession();
  let page = "home";
  let roleFilter = "all";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function persist() {
    Auth.ensureAccounts(state, Store.ROLES);
    Store.save(state);
  }

  function currentPeriod() {
    return Store.activePeriod(state);
  }

  function periodDates(period) {
    const p = period || currentPeriod();
    if (!p) return [];
    return p.dates || Rules.dateRange(p.start, 28);
  }

  function periodLabelOf(p) {
    if (!p) return "—";
    return p.label || Rules.periodLabel(p.start, p.end);
  }

  function ensurePeriods() {
    state = Store.migratePeriods(state);
  }

  function setPeriodBatch(anchorYmd, count) {
    const n = Math.min(6, Math.max(3, Number(count) || 4));
    const periods = Rules.buildPeriodBatch(anchorYmd, n);
    state.periods = periods;
    state.periodCount = n;
    state.periodAnchor = periods[0].start;
    state.activePeriodId = periods[0].id;
    state.cycleStart = periods[0].start;
    state.month = `${periods[0].start.slice(0, 7)}-01`;
    persist();
    render();
  }

  function setActivePeriod(id) {
    if (!Rules.findPeriod(state.periods, id)) return;
    state.activePeriodId = id;
    const p = currentPeriod();
    state.cycleStart = p.start;
    persist();
    render();
  }

  function staffName(id) {
    const s = state.staff.find((x) => x.id === id);
    return s ? s.name : id;
  }

  function visibleRoles() {
    if (!session) return [];
    if (session.kind === "admin") return Store.ROLES;
    if (session.kind === "manager") {
      return Store.ROLES.filter((r) => r.id === session.role);
    }
    return Store.ROLES.filter((r) => r.id === session.role);
  }

  function scopedStaff(activeOnly) {
    let list = Auth.filterStaffBySession(state.staff, session);
    if (activeOnly) list = list.filter((s) => s.active !== false);
    return list;
  }

  function go(p) {
    const allowed = Auth.allowedPages(session);
    if (!allowed.includes(p)) {
      page = allowed[0] || "home";
    } else {
      page = p;
    }
    render();
  }

  function requireAuth() {
    return !!session;
  }

  function showLogin() {
    $("#loginGate").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
    $("#loginError").textContent = "";
    $("#loginUser").value = "";
    $("#loginPass").value = "";
    const pb = $("#periodBar");
    if (pb) pb.innerHTML = "";
  }

  function showApp() {
    $("#loginGate").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    updateSessionBadge();
    applyChromePermissions();
    const allowed = Auth.allowedPages(session);
    if (!allowed.includes(page)) page = allowed[0] || "home";
    if (session.kind === "manager") roleFilter = session.role;
    if (session.kind === "staff" && session.staffId) {
      state.selfUserId = session.staffId;
    }
    render();
  }

  function updateSessionBadge() {
    const el = $("#sessionBadge");
    if (!session) {
      el.textContent = "";
      return;
    }
    const roleBit =
      session.kind === "manager"
        ? ` · ${Store.roleLabel(session.role)}`
        : session.kind === "staff"
          ? ` · ${Store.roleLabel(session.role)}`
          : "";
    el.innerHTML = `<strong>${session.name}</strong><span>${Auth.kindLabel(session.kind)}${roleBit}</span>`;
  }

  function applyChromePermissions() {
    const isAdmin = session?.kind === "admin";
    const canManage = Auth.can(session, "manageStaff");
    const canComp = Auth.can(session, "compliance");

    $$(".nav button").forEach((b) => {
      const p = b.dataset.page;
      const ok = Auth.allowedPages(session).includes(p);
      b.classList.toggle("hidden", !ok);
    });

    $("#btnImport")?.classList.toggle("hidden", !isAdmin);
    $("#btnReset")?.classList.toggle("hidden", !isAdmin);
    $("#btnExport")?.classList.toggle("hidden", !isAdmin);
    $("#btnExcel")?.classList.toggle("hidden", !Auth.can(session, "exportExcel"));
    // 同仁也可匯出自己看得到的範圍；主管匯出自己職務
    void canManage;
    void canComp;
  }

  function renderNav() {
    $$(".nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.page === page);
    });
  }

  function renderPeriodBar() {
    const el = $("#periodBar");
    if (!el || !session) {
      if (el) el.innerHTML = "";
      return;
    }
    ensurePeriods();
    const periods = state.periods || [];
    const active = currentPeriod();
    const canEditBatch = session.kind === "admin" || session.kind === "manager";

    el.innerHTML = `
      <div class="pb-group">
        <label>目前檢視期別</label>
        <select id="activePeriodSelect" style="min-width:260px">
          ${periods
            .map(
              (p, i) =>
                `<option value="${p.id}" ${p.id === state.activePeriodId ? "selected" : ""}>第 ${i + 1} 期｜${periodLabelOf(p)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${
        canEditBatch
          ? `<div class="pb-group">
        <label>批次起日（對齊週一）</label>
        <input type="date" id="periodAnchor" value="${state.periodAnchor || periods[0]?.start || ""}" />
      </div>
      <div class="pb-group">
        <label>一次排定期數（3～6）</label>
        <select id="periodCount">
          ${[3, 4, 5, 6]
            .map(
              (n) =>
                `<option value="${n}" ${Number(state.periodCount) === n ? "selected" : ""}>${n} 期（${n * 4} 週）</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="pb-group">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-amber" id="btnGenPeriods">產生期別批次</button>
      </div>`
          : ""
      }
      <div class="period-chips" id="periodChips">
        ${periods
          .map(
            (p, i) =>
              `<button type="button" class="period-chip ${p.id === state.activePeriodId ? "on" : ""}" data-pid="${p.id}"><span class="idx">${i + 1}</span>${periodLabelOf(p)}</button>`
          )
          .join("")}
      </div>
      <p class="period-hint">四周變形工時以 28 日為一期，格式 YYYY/MM/DD~YYYY/MM/DD。主管可一次產生並排定 3～6 個連續期別；自排班／排班／合規預設作用於「目前檢視期別」，亦可對整批執行。</p>
    `;

    $("#activePeriodSelect").onchange = (e) => setActivePeriod(e.target.value);
    $$("#periodChips [data-pid]").forEach((b) => {
      b.onclick = () => setActivePeriod(b.dataset.pid);
    });
    const gen = $("#btnGenPeriods");
    if (gen) {
      gen.onclick = () => {
        const anchor = $("#periodAnchor").value;
        const count = Number($("#periodCount").value) || 4;
        if (!anchor) return alert("請選擇批次起日");
        if (!confirm(`將產生 ${count} 個連續四周期別（起日會對齊週一）。既有期別清單會被取代，班表資料仍保留於各日期。繼續？`)) {
          return;
        }
        setPeriodBatch(anchor, count);
      };
    }
  }

  function renderHome() {
    const el = $("#view");
    const n = scopedStaff(true).length;
    const p = currentPeriod();
    const batch = state.periods || [];
    const scopeHint =
      session.kind === "admin"
        ? "您可管理全部職務。"
        : session.kind === "manager"
          ? `您僅能管理「${Store.roleLabel(session.role)}」職務的名單、配班與排班。`
          : "您可填寫自己的希望班，並檢視班表。";

    el.innerHTML = `
      <section class="panel">
        <h2>綜合排班流程</h2>
        <p class="lead">${scopeHint} 工時制度採勞基法<strong>四週變形工時（§30-1）</strong>，排班單位為 28 日期別，而非曆月。</p>
        <div class="flow">
          <div class="flow-step"><b>1. 設定期別</b><span>一次選 3～6 個 YYYY/MM/DD~YYYY/MM/DD</span></div>
          <div class="flow-step"><b>2. 人員／配班</b><span>名冊與每週節數、覆蓋人數</span></div>
          <div class="flow-step"><b>3. 自排班</b><span>同仁填該期希望班</span></div>
          <div class="flow-step"><b>4. 期別排班</b><span>單期或整批自動排＋Excel</span></div>
        </div>
      </section>
      <div class="stat-cards">
        <div class="stat"><div class="k">${session.kind === "admin" ? "在職人數" : "可見人數"}</div><div class="v">${n}</div></div>
        <div class="stat"><div class="k">批次期數</div><div class="v">${batch.length}</div></div>
        <div class="stat"><div class="k">目前期別</div><div class="v" style="font-size:0.95rem;line-height:1.3">${periodLabelOf(p)}</div></div>
        <div class="stat"><div class="k">每節工時</div><div class="v">4h</div></div>
      </div>
      <section class="panel">
        <h2>本期別一覽</h2>
        <div class="scroll-x">
          <table class="data">
            <thead><tr><th>序</th><th>期別期間</th><th>天數</th><th>狀態</th></tr></thead>
            <tbody>
              ${batch
                .map(
                  (x, i) => `<tr>
                <td>${i + 1}</td>
                <td class="name">${periodLabelOf(x)}</td>
                <td>28</td>
                <td>${x.id === state.activePeriodId ? "檢視中" : "—"}</td>
              </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>班別定義</h2>
        <div class="scroll-x">
          <table class="data">
            <thead><tr><th>適用日</th><th>早班</th><th>午班</th><th>晚班</th></tr></thead>
            <tbody>
              <tr><td class="name">週一～週五</td><td>08:00–12:00</td><td>13:30–17:30</td><td>17:30–21:30</td></tr>
              <tr><td class="name">週六（假日班）</td><td>08:00–12:00</td><td>13:30–17:30</td><td>—</td></tr>
              <tr><td class="name">週日</td><td colspan="3">原則排例假／休息日（不排班）</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderStaff() {
    if (!Auth.can(session, "manageStaff")) {
      $("#view").innerHTML = `<section class="panel"><p class="lead">無權限檢視人員名單。</p></section>`;
      return;
    }

    const roles = visibleRoles();
    if (session.kind === "manager" && roleFilter === "all") roleFilter = session.role;

    const list = state.staff.filter((s) => {
      if (session.kind === "manager" && s.role !== session.role) return false;
      if (roleFilter !== "all" && s.role !== roleFilter) return false;
      return true;
    });

    const roleOptions =
      session.kind === "admin"
        ? Store.ROLES
        : Store.ROLES.filter((r) => r.id === session.role);

    $("#view").innerHTML = `
      <section class="panel">
        <h2>各職務基本人員名單</h2>
        <p class="lead">${
          session.kind === "manager"
            ? `僅顯示並可編輯「${Store.roleLabel(session.role)}」。`
            : "由各職務主管維護名冊；系統管理員可管理全部。"
        }</p>
        <div class="role-tabs" id="roleTabs">
          ${
            session.kind === "admin"
              ? `<button data-role="all" class="${roleFilter === "all" ? "on" : ""}">全部</button>`
              : ""
          }
          ${roles
            .map(
              (r) =>
                `<button data-role="${r.id}" class="${roleFilter === r.id ? "on" : ""}">${r.label}</button>`
            )
            .join("")}
        </div>
        <div class="form-row" id="addStaffForm">
          <div><label class="field">姓名</label><input id="newName" type="text" placeholder="姓名" /></div>
          <div><label class="field">職務</label>
            <select id="newRole">${roleOptions
              .map((r) => `<option value="${r.id}">${r.label}</option>`)
              .join("")}</select>
          </div>
          <div><label class="field">分組</label><input id="newGroup" type="text" placeholder="例如 A / 門診" /></div>
          <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" id="btnAddStaff">新增人員</button></div>
        </div>
        <div class="scroll-x">
          <table class="data">
            <thead><tr><th class="name">姓名</th><th>職務</th><th>分組</th><th>帳號</th><th>狀態</th><th></th></tr></thead>
            <tbody>
              ${list
                .map((s) => {
                  const acc = (state.accounts || []).find((a) => a.staffId === s.id);
                  return `<tr>
                  <td class="name">${s.name}</td>
                  <td>${Store.roleLabel(s.role)}</td>
                  <td><input data-edit-group="${s.id}" type="text" value="${s.group || ""}" style="width:110px;padding:4px 6px" /></td>
                  <td><code>${acc ? acc.username : s.id}</code> / demo</td>
                  <td>${s.active === false ? "停用" : "在職"}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost" data-toggle="${s.id}">${s.active === false ? "啟用" : "停用"}</button>
                    <button class="btn btn-sm btn-danger" data-del="${s.id}">刪除</button>
                  </td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;

    $("#roleTabs").onclick = (e) => {
      const b = e.target.closest("button[data-role]");
      if (!b) return;
      if (session.kind === "manager" && b.dataset.role !== session.role) return;
      roleFilter = b.dataset.role;
      render();
    };
    $("#btnAddStaff").onclick = () => {
      const name = $("#newName").value.trim();
      if (!name) return alert("請輸入姓名");
      let role = $("#newRole").value;
      if (session.kind === "manager") role = session.role;
      if (!Auth.can(session, "manageRole", { role })) return alert("不可新增其他職務人員");
      const id = Store.uid("s");
      const group = $("#newGroup").value.trim();
      state.staff.push({ id, name, role, group, active: true });
      state.quotas[id] = { morning: 3, afternoon: 3, evening: 2, holiday: 1 };
      persist();
      render();
    };
    $$("[data-toggle]").forEach((b) => {
      b.onclick = () => {
        const s = state.staff.find((x) => x.id === b.dataset.toggle);
        if (!s || !Auth.can(session, "manageRole", { role: s.role })) return alert("無權限");
        s.active = s.active === false;
        persist();
        render();
      };
    });
    $$("[data-del]").forEach((b) => {
      b.onclick = () => {
        const s = state.staff.find((x) => x.id === b.dataset.del);
        if (!s || !Auth.can(session, "manageRole", { role: s.role })) return alert("無權限");
        if (!confirm("確定刪除？")) return;
        state.staff = state.staff.filter((x) => x.id !== b.dataset.del);
        delete state.quotas[b.dataset.del];
        state.accounts = (state.accounts || []).filter((a) => a.staffId !== b.dataset.del);
        persist();
        render();
      };
    });
    $$("[data-edit-group]").forEach((inp) => {
      inp.onchange = () => {
        const s = state.staff.find((x) => x.id === inp.dataset.editGroup);
        if (!s || !Auth.can(session, "manageRole", { role: s.role })) return;
        s.group = inp.value.trim();
        persist();
      };
    });
  }

  function renderQuotas() {
    if (!Auth.can(session, "manageQuotas")) {
      $("#view").innerHTML = `<section class="panel"><p class="lead">無權限。</p></section>`;
      return;
    }

    const staff = state.staff.filter((s) => {
      if (s.active === false) return false;
      if (session.kind === "manager") return s.role === session.role;
      return true;
    });

    const covRoles =
      session.kind === "manager"
        ? Store.ROLES.filter((r) => r.id === session.role)
        : Store.ROLES;

    $("#view").innerHTML = `
      <section class="panel">
        <h2>分組配班設定表（主管）</h2>
        <p class="lead">設定每人每週早／午／晚／假日目標節數（每節 4 小時）。${
          session.kind === "manager" ? `目前僅「${Store.roleLabel(session.role)}」。` : ""
        }</p>
        <div class="scroll-x">
          <table class="data">
            <thead>
              <tr>
                <th class="name">姓名</th><th>職務</th><th>分組</th>
                <th>早班／週</th><th>午班／週</th><th>晚班／週</th><th>假日班／週</th>
                <th>週工時估</th>
              </tr>
            </thead>
            <tbody>
              ${staff
                .map((s) => {
                  const q = state.quotas[s.id] || { morning: 0, afternoon: 0, evening: 0, holiday: 0 };
                  const hours = (q.morning + q.afternoon + q.evening + q.holiday) * 4;
                  return `<tr>
                  <td class="name">${s.name}</td>
                  <td>${Store.roleLabel(s.role)}</td>
                  <td>${s.group || "—"}</td>
                  <td><input type="number" min="0" max="7" data-q="${s.id}" data-k="morning" value="${q.morning}" /></td>
                  <td><input type="number" min="0" max="7" data-q="${s.id}" data-k="afternoon" value="${q.afternoon}" /></td>
                  <td><input type="number" min="0" max="7" data-q="${s.id}" data-k="evening" value="${q.evening}" /></td>
                  <td><input type="number" min="0" max="4" data-q="${s.id}" data-k="holiday" value="${q.holiday}" /></td>
                  <td>${hours}h</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>各職務每班覆蓋人數</h2>
        <p class="lead">每日各班至少需要幾位該職務人員。</p>
        <div class="scroll-x">
          <table class="data">
            <thead>
              <tr><th class="name">職務</th><th>平日早</th><th>平日午</th><th>平日晚</th><th>週六早</th><th>週六午</th></tr>
            </thead>
            <tbody>
              ${covRoles
                .map((r) => {
                  const c = state.coverage[r.id] || {};
                  const locked = !Auth.can(session, "manageRole", { role: r.id });
                  const dis = locked ? "disabled" : "";
                  return `<tr>
                  <td class="name">${r.label}</td>
                  <td><input type="number" min="0" max="10" data-c="${r.id}" data-k="morning" value="${c.morning ?? 1}" ${dis} /></td>
                  <td><input type="number" min="0" max="10" data-c="${r.id}" data-k="afternoon" value="${c.afternoon ?? 1}" ${dis} /></td>
                  <td><input type="number" min="0" max="10" data-c="${r.id}" data-k="evening" value="${c.evening ?? 0}" ${dis} /></td>
                  <td><input type="number" min="0" max="10" data-c="${r.id}" data-k="holidayMorning" value="${c.holidayMorning ?? 1}" ${dis} /></td>
                  <td><input type="number" min="0" max="10" data-c="${r.id}" data-k="holidayAfternoon" value="${c.holidayAfternoon ?? 1}" ${dis} /></td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;

    $$("input[data-q]").forEach((inp) => {
      inp.onchange = () => {
        const s = state.staff.find((x) => x.id === inp.dataset.q);
        if (!s || !Auth.can(session, "manageRole", { role: s.role })) return alert("無權限");
        if (!state.quotas[s.id]) state.quotas[s.id] = { morning: 0, afternoon: 0, evening: 0, holiday: 0 };
        state.quotas[s.id][inp.dataset.k] = Number(inp.value) || 0;
        persist();
        renderQuotas();
      };
    });
    $$("input[data-c]").forEach((inp) => {
      inp.onchange = () => {
        const rid = inp.dataset.c;
        if (!Auth.can(session, "manageRole", { role: rid })) return alert("無權限");
        if (!state.coverage[rid]) state.coverage[rid] = {};
        state.coverage[rid][inp.dataset.k] = Number(inp.value) || 0;
        persist();
      };
    });
  }

  function prefSelect(val) {
    const v = val || "ok";
    return `<select>
      <option value="want" ${v === "want" ? "selected" : ""}>希望</option>
      <option value="ok" ${v === "ok" ? "selected" : ""}>可</option>
      <option value="no" ${v === "no" ? "selected" : ""}>不要</option>
    </select>`;
  }

  function renderSelf() {
    const el = $("#view");
    let staffOptions = state.staff.filter((s) => s.active !== false);
    if (session.kind === "staff") {
      staffOptions = staffOptions.filter((s) => s.id === session.staffId);
      state.selfUserId = session.staffId;
    } else if (session.kind === "manager") {
      staffOptions = staffOptions.filter((s) => s.role === session.role);
      if (!staffOptions.find((s) => s.id === state.selfUserId)) {
        state.selfUserId = staffOptions[0]?.id;
      }
    }

    if (!staffOptions.length) {
      el.innerHTML = `<section class="panel"><p class="lead">沒有可填的人員。</p></section>`;
      return;
    }
    if (!staffOptions.find((s) => s.id === state.selfUserId)) {
      state.selfUserId = staffOptions[0].id;
    }

    const me = staffOptions.find((s) => s.id === state.selfUserId);
    const canEdit = Auth.can(session, "editSelfFor", { staffId: state.selfUserId, staff: me });
    const period = currentPeriod();
    const dates = periodDates(period);
    const prefs = state.preferences[state.selfUserId] || {};
    const unavail = new Set(state.unavailable[state.selfUserId] || []);
    const lockAttr = canEdit ? "" : "disabled";

    el.innerHTML = `
      <section class="panel">
        <h2>自排班（同仁希望班）</h2>
        <p class="lead">期別：<strong>${periodLabelOf(period)}</strong>。${
          session.kind === "staff"
            ? "請標示本期各日希望程度，並勾選不可上班日。"
            : "主管可代為檢視／填寫所屬職務同仁的希望班。可切換上方期別逐期填寫。"
        }</p>
        <div class="form-row" style="grid-template-columns: 1fr 1fr auto;">
          <div>
            <label class="field">填寫對象</label>
            <select id="selfUser" ${session.kind === "staff" ? "disabled" : ""}>
              ${staffOptions
                .map(
                  (s) =>
                    `<option value="${s.id}" ${s.id === state.selfUserId ? "selected" : ""}>${s.name}（${Store.roleLabel(s.role)}）</option>`
                )
                .join("")}
            </select>
          </div>
          <div>
            <label class="field">每週配額提醒</label>
            <div style="padding:8px 0;font-weight:700;color:var(--teal-deep)">
              ${(() => {
                const q = state.quotas[state.selfUserId] || {};
                return `早${q.morning || 0}／午${q.afternoon || 0}／晚${q.evening || 0}／假日${q.holiday || 0} 節`;
              })()}
            </div>
          </div>
          <div style="display:flex;align-items:flex-end">
            ${canEdit ? `<button class="btn btn-ghost" id="btnFillOk">全部填「可」</button>` : ""}
          </div>
        </div>
        <div class="self-grid scroll-x">
          <table class="data">
            <thead>
              <tr><th>日期</th><th>星期</th><th>不可上班</th><th>早班</th><th>午班</th><th>晚班</th></tr>
            </thead>
            <tbody>
              ${dates
                .map((ymd) => {
                  const dow = Rules.dayOfWeek(ymd);
                  const names = ["日", "一", "二", "三", "四", "五", "六"];
                  const allowed = Rules.allowedShifts(ymd);
                  const p = prefs[ymd] || {};
                  const off = unavail.has(ymd);
                  return `<tr data-ymd="${ymd}">
                  <td>${ymd.slice(5)}</td>
                  <td>${names[dow]}</td>
                  <td><input type="checkbox" data-off="${ymd}" ${off ? "checked" : ""} ${dow === 0 || !canEdit ? "disabled" : ""} /></td>
                  <td data-shift="morning">${allowed.includes("morning") && !off ? prefSelect(p.morning).replace("<select>", `<select ${lockAttr}>`) : "—"}</td>
                  <td data-shift="afternoon">${allowed.includes("afternoon") && !off ? prefSelect(p.afternoon).replace("<select>", `<select ${lockAttr}>`) : "—"}</td>
                  <td data-shift="evening">${allowed.includes("evening") && !off ? prefSelect(p.evening).replace("<select>", `<select ${lockAttr}>`) : "—"}</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        ${
          canEdit
            ? `<div class="btn-row"><button class="btn btn-primary" id="btnSaveSelf">儲存希望班</button></div>`
            : `<p class="lead">唯讀模式</p>`
        }
      </section>
    `;

    const selfSel = $("#selfUser");
    if (selfSel && session.kind !== "staff") {
      selfSel.onchange = (e) => {
        state.selfUserId = e.target.value;
        persist();
        renderSelf();
      };
    }
    const fillBtn = $("#btnFillOk");
    if (fillBtn) {
      fillBtn.onclick = () => {
        if (!state.preferences[state.selfUserId]) state.preferences[state.selfUserId] = {};
        for (const ymd of dates) {
          const allowed = Rules.allowedShifts(ymd);
          if (!allowed.length) continue;
          const obj = {};
          for (const sh of allowed) obj[sh] = "ok";
          state.preferences[state.selfUserId][ymd] = obj;
        }
        persist();
        renderSelf();
      };
    }
    const saveBtn = $("#btnSaveSelf");
    if (saveBtn) {
      saveBtn.onclick = () => {
        const target = state.staff.find((s) => s.id === state.selfUserId);
        if (!Auth.can(session, "editSelfFor", { staffId: state.selfUserId, staff: target })) {
          return alert("無權限");
        }
        if (!state.preferences[state.selfUserId]) state.preferences[state.selfUserId] = {};
        const offList = [];
        $$("tr[data-ymd]").forEach((tr) => {
          const ymd = tr.dataset.ymd;
          const off = tr.querySelector("input[data-off]")?.checked;
          if (off) {
            offList.push(ymd);
            delete state.preferences[state.selfUserId][ymd];
            return;
          }
          const obj = {};
          for (const sh of ["morning", "afternoon", "evening"]) {
            const sel = tr.querySelector(`td[data-shift="${sh}"] select`);
            if (sel) obj[sh] = sel.value;
          }
          if (Object.keys(obj).length) state.preferences[state.selfUserId][ymd] = obj;
        });
        state.unavailable[state.selfUserId] = offList;
        persist();
        alert(`${me?.name || ""} 的希望班已儲存`);
      };
    }
  }

  function renderMonth() {
    const el = $("#view");
    const period = currentPeriod();
    const dates = periodDates(period);
    if (!dates.length) {
      el.innerHTML = `<section class="panel"><p class="lead">請先於上方產生期別批次（3～6 期）。</p></section>`;
      return;
    }
    const lead = Rules.dayOfWeek(dates[0]);
    const canAuto = Auth.can(session, "autoSchedule");
    const canEdit = session.kind === "admin" || session.kind === "manager";
    const viewStaff =
      session.kind === "staff"
        ? state.staff.filter((s) => s.id === session.staffId)
        : session.kind === "manager"
          ? state.staff.filter((s) => s.role === session.role)
          : state.staff;
    const viewIds = new Set(viewStaff.map((s) => s.id));
    const nameMap = Object.fromEntries(state.staff.map((s) => [s.id, s.name]));
    const batchCount = (state.periods || []).length;

    function slotHtml(ymd, key, cls) {
      const ids = ((state.schedule[ymd] || {})[key] || []).filter((id) => viewIds.has(id));
      if (!Rules.allowedShifts(ymd).includes(key)) return "";
      const label = Rules.SHIFTS[key].label;
      const names = ids.map((id) => nameMap[id] || id).join("、") || "—";
      return `<div class="slot ${cls}"><b>${label}</b> ${names}</div>`;
    }

    const editStaffOpts =
      session.kind === "manager"
        ? state.staff.filter((s) => s.active !== false && s.role === session.role)
        : state.staff.filter((s) => s.active !== false);

    el.innerHTML = `
      <section class="panel">
        <h2>期別排班</h2>
        <p class="lead">目前期別：<strong>${periodLabelOf(period)}</strong>（28 日）。批次共 ${batchCount} 期。${
          session.kind === "manager"
            ? `顯示「${Store.roleLabel(session.role)}」；自動排班只改本職務。`
            : session.kind === "staff"
              ? "顯示您的班表（唯讀）。"
              : "可對「本期」或「整批 3～6 期」自動排班並匯出 Excel。"
        }</p>
        <div class="btn-row">
          ${canAuto ? `<button class="btn btn-amber" id="btnAuto">自動排本期</button>` : ""}
          ${canAuto && batchCount >= 3 ? `<button class="btn btn-primary" id="btnAutoBatch">自動排整批 ${batchCount} 期</button>` : ""}
          ${session.kind === "admin" ? `<button class="btn btn-ghost" id="btnClearSched">清空本期班表</button>` : ""}
          ${Auth.can(session, "exportExcel") ? `<button class="btn btn-ghost" id="btnExcelPage">匯出本期 Excel</button>` : ""}
          ${Auth.can(session, "exportExcel") && batchCount >= 2 ? `<button class="btn btn-ghost" id="btnExcelBatch">匯出整批 Excel</button>` : ""}
          ${Auth.can(session, "compliance") ? `<button class="btn btn-ghost" id="btnGotoCompliance">四周合規</button>` : ""}
        </div>
        <div class="cal">
          ${["日", "一", "二", "三", "四", "五", "六"].map((d) => `<div class="hd">${d}</div>`).join("")}
          ${Array.from({ length: lead }, () => `<div></div>`).join("")}
          ${dates
            .map((ymd) => {
              const dow = Rules.dayOfWeek(ymd);
              const cls = dow === 0 ? "sun" : dow === 6 ? "sat" : "";
              return `<div class="day-card ${cls}">
              <div class="dnum">${Rules.toSlashDate(ymd).slice(5)}</div>
              ${slotHtml(ymd, "morning", "m")}
              ${slotHtml(ymd, "afternoon", "a")}
              ${slotHtml(ymd, "evening", "e")}
              ${dow === 0 ? `<div class="slot">例假／休息</div>` : ""}
            </div>`;
            })
            .join("")}
        </div>
      </section>
      ${
        canEdit
          ? `<section class="panel">
        <h2>手動微調（本期）</h2>
        <div class="form-row">
          <div><label class="field">日期</label><input type="date" id="editDate" value="${dates[0]}" min="${dates[0]}" max="${dates[dates.length - 1]}" /></div>
          <div><label class="field">班別</label>
            <select id="editShift">
              <option value="morning">早班</option>
              <option value="afternoon">午班</option>
              <option value="evening">晚班</option>
            </select>
          </div>
          <div><label class="field">人員</label>
            <select id="editStaff">${editStaffOpts
              .map(
                (s) =>
                  `<option value="${s.id}">${s.name}（${Store.roleLabel(s.role)}）</option>`
              )
              .join("")}</select>
          </div>
          <div style="display:flex;align-items:flex-end;gap:8px">
            <button class="btn btn-primary" id="btnAddAssign">加入</button>
            <button class="btn btn-danger" id="btnRemAssign">移除</button>
          </div>
        </div>
        <div id="editPreview" class="lead"></div>
      </section>`
          : ""
      }
    `;

    function applyAutoResult(result, datesScope) {
      if (session.kind === "manager") {
        state.schedule = Scheduler.mergeScheduleByRoleInDates(
          state.schedule,
          result.schedule,
          state.staff,
          session.role,
          datesScope
        );
        const mine = Auth.filterStaffBySession(state.staff, session);
        const suggested = Rules.suggestRestDays(mine, state.schedule, result.cycleStart);
        state.restDays = { ...(state.restDays || {}), ...suggested };
      } else {
        for (const ymd of datesScope) {
          state.schedule[ymd] = result.schedule[ymd];
        }
        state.restDays = { ...(state.restDays || {}), ...result.restDays };
      }
      state.cycleStart = result.cycleStart;
    }

    const autoBtn = $("#btnAuto");
    if (autoBtn) {
      autoBtn.onclick = () => {
        const result = Scheduler.buildSchedule(state, period);
        applyAutoResult(result, result.dates);
        persist();
        alert(`已完成本期自動排班：${periodLabelOf(period)}`);
        renderMonth();
      };
    }
    const batchBtn = $("#btnAutoBatch");
    if (batchBtn) {
      batchBtn.onclick = () => {
        if (!confirm(`將依序自動排定整批 ${batchCount} 個期別，可能需要幾秒。繼續？`)) return;
        let schedule = { ...(state.schedule || {}) };
        let restDays = { ...(state.restDays || {}) };
        for (const per of state.periods) {
          const result = Scheduler.buildSchedule(state, per);
          if (session.kind === "manager") {
            schedule = Scheduler.mergeScheduleByRoleInDates(
              schedule,
              result.schedule,
              state.staff,
              session.role,
              result.dates
            );
            const mine = Auth.filterStaffBySession(state.staff, session);
            const suggested = Rules.suggestRestDays(mine, schedule, result.cycleStart);
            restDays = { ...restDays, ...suggested };
            // merge rest day maps properly
            for (const [sid, days] of Object.entries(suggested)) {
              restDays[sid] = { ...(restDays[sid] || {}), ...days };
            }
          } else {
            for (const ymd of result.dates) schedule[ymd] = result.schedule[ymd];
            for (const [sid, days] of Object.entries(result.restDays || {})) {
              restDays[sid] = { ...(restDays[sid] || {}), ...days };
            }
          }
        }
        state.schedule = schedule;
        state.restDays = restDays;
        persist();
        alert(`已完成整批 ${batchCount} 期自動排班。`);
        renderMonth();
      };
    }
    const clearBtn = $("#btnClearSched");
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (!confirm("清空本期（目前檢視期別）班表？")) return;
        for (const ymd of dates) {
          delete state.schedule[ymd];
        }
        persist();
        renderMonth();
      };
    }
    const excelBtn = $("#btnExcelPage");
    if (excelBtn) excelBtn.onclick = () => doExportExcel(false);
    const excelBatch = $("#btnExcelBatch");
    if (excelBatch) excelBatch.onclick = () => doExportExcel(true);
    const compBtn = $("#btnGotoCompliance");
    if (compBtn) compBtn.onclick = () => go("compliance");

    if (canEdit) {
      const refreshPreview = () => {
        const ymd = $("#editDate").value;
        const shift = $("#editShift").value;
        const ids = ((state.schedule[ymd] || {})[shift] || []).filter((id) => {
          const s = state.staff.find((x) => x.id === id);
          if (session.kind === "manager") return s && s.role === session.role;
          return true;
        });
        $("#editPreview").textContent = `${Rules.toSlashDate(ymd)} ${Rules.SHIFTS[shift]?.label || shift}：${
          ids.map(staffName).join("、") || "尚無"
        }`;
      };
      $("#editDate").onchange = refreshPreview;
      $("#editShift").onchange = refreshPreview;
      refreshPreview();

      $("#btnAddAssign").onclick = () => {
        const ymd = $("#editDate").value;
        const shift = $("#editShift").value;
        const sid = $("#editStaff").value;
        const s = state.staff.find((x) => x.id === sid);
        if (!s || !Auth.can(session, "editSchedule", { role: s.role })) return alert("無權限編輯此職務");
        if (!dates.includes(ymd)) return alert("日期須在本期別範圍內");
        if (!Rules.allowedShifts(ymd).includes(shift)) return alert("該日無此班別");
        if (!state.schedule[ymd]) state.schedule[ymd] = { morning: [], afternoon: [], evening: [] };
        if (!state.schedule[ymd][shift].includes(sid)) state.schedule[ymd][shift].push(sid);
        persist();
        renderMonth();
      };
      $("#btnRemAssign").onclick = () => {
        const ymd = $("#editDate").value;
        const shift = $("#editShift").value;
        const sid = $("#editStaff").value;
        const s = state.staff.find((x) => x.id === sid);
        if (!s || !Auth.can(session, "editSchedule", { role: s.role })) return alert("無權限");
        if (!state.schedule[ymd]) return;
        state.schedule[ymd][shift] = (state.schedule[ymd][shift] || []).filter((id) => id !== sid);
        persist();
        renderMonth();
      };
    }
  }

  function renderCompliance() {
    if (!Auth.can(session, "compliance")) {
      $("#view").innerHTML = `<section class="panel"><p class="lead">無權限。</p></section>`;
      return;
    }
    const period = currentPeriod();
    const cycleStart = period?.start || state.cycleStart || Rules.alignCycleStart(Rules.formatYMD(new Date()));
    let staff = state.staff.filter((s) => s.active !== false);
    if (session.kind === "manager") staff = staff.filter((s) => s.role === session.role);

    const restDays = Object.keys(state.restDays || {}).length
      ? state.restDays
      : Rules.suggestRestDays(staff, state.schedule, cycleStart);
    const report = Rules.validateAll(staff, state.schedule, restDays, cycleStart);
    const errors = report.issues.filter((i) => i.severity === "error");
    const warns = report.issues.filter((i) => i.severity === "warn");

    // 整批各期摘要
    const batchSummaries = (state.periods || []).map((p) => {
      const r = Rules.validateAll(staff, state.schedule, restDays, p.start);
      return {
        period: p,
        errors: r.issues.filter((i) => i.severity === "error").length,
        warns: r.issues.filter((i) => i.severity === "warn").length,
        okPeople: r.reports.filter((x) => x.ok).length,
        total: r.reports.length,
      };
    });

    $("#view").innerHTML = `
      <section class="panel">
        <h2>四周變形工時合規（勞基法 §30-1）</h2>
        <p class="lead">目前期別：<strong>${periodLabelOf(period)}</strong>。每期獨立檢核 160h／例假規則。${
          session.kind === "manager" ? `範圍：${Store.roleLabel(session.role)}。` : ""
        }</p>
        <div class="stat-cards">
          <div class="stat"><div class="k">本期錯誤</div><div class="v" style="color:var(--rose)">${errors.length}</div></div>
          <div class="stat"><div class="k">本期提醒</div><div class="v" style="color:var(--amber)">${warns.length}</div></div>
          <div class="stat"><div class="k">通過人數</div><div class="v">${report.reports.filter((r) => r.ok).length}</div></div>
          <div class="stat"><div class="k">檢查人數</div><div class="v">${report.reports.length}</div></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" id="btnRevalidate">重新檢查本期</button>
          <button class="btn btn-primary" id="btnSuggestRest">重套本期例假／休息日建議</button>
        </div>
      </section>
      <section class="panel">
        <h2>批次各期合規摘要</h2>
        <div class="scroll-x">
          <table class="data">
            <thead><tr><th>序</th><th class="name">期別</th><th>錯誤</th><th>提醒</th><th>通過／總人數</th><th></th></tr></thead>
            <tbody>
              ${batchSummaries
                .map(
                  (b, i) => `<tr>
                <td>${i + 1}</td>
                <td class="name">${periodLabelOf(b.period)}</td>
                <td>${b.errors}</td>
                <td>${b.warns}</td>
                <td>${b.okPeople}/${b.total}</td>
                <td><button class="btn btn-sm btn-ghost" data-goto-period="${b.period.id}">檢視此期</button></td>
              </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>個人四週工時（本期）</h2>
        <div class="scroll-x">
          <table class="data">
            <thead><tr><th class="name">姓名</th><th>職務</th><th>正常工時</th><th>延長估</th><th>未出勤日</th><th>結果</th></tr></thead>
            <tbody>
              ${report.reports
                .map((r) => {
                  const s = staff.find((x) => x.id === r.staffId);
                  return `<tr>
                  <td class="name">${r.staffName}</td>
                  <td>${Store.roleLabel(s?.role)}</td>
                  <td>${r.normalHours}h</td>
                  <td>${r.otHours}h</td>
                  <td>${r.totalOff}</td>
                  <td>${r.ok ? "✓ 通過" : "✗ 需調整"}</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>問題清單（本期）</h2>
        ${
          report.issues.length === 0
            ? `<div class="issue ok">目前無合規問題（或班表尚空）。</div>`
            : report.issues
                .map((i) => `<div class="issue ${i.severity}">[${i.rule}] ${i.message}</div>`)
                .join("")
        }
      </section>
    `;

    $("#btnRevalidate").onclick = () => renderCompliance();
    $("#btnSuggestRest").onclick = () => {
      const suggested = Rules.suggestRestDays(staff, state.schedule, cycleStart);
      if (session.kind === "manager") {
        for (const [sid, days] of Object.entries(suggested)) {
          state.restDays[sid] = { ...(state.restDays[sid] || {}), ...days };
        }
      } else {
        state.restDays = { ...(state.restDays || {}), ...suggested };
        for (const [sid, days] of Object.entries(suggested)) {
          state.restDays[sid] = { ...(state.restDays[sid] || {}), ...days };
        }
      }
      state.cycleStart = cycleStart;
      persist();
      renderCompliance();
    };
    $$("[data-goto-period]").forEach((b) => {
      b.onclick = () => {
        setActivePeriod(b.dataset.gotoPeriod);
        go("compliance");
      };
    });
  }

  function doExportExcel(allBatch) {
    let roleFilterExport = null;
    let staffIds = null;
    if (session.kind === "manager") {
      roleFilterExport = session.role;
    } else if (session.kind === "staff") {
      roleFilterExport = session.role;
      staffIds = [session.staffId];
    }
    if (allBatch) {
      Excel.exportMonthSchedule({
        state,
        Rules,
        Store,
        roleFilter: roleFilterExport,
        staffIds,
        periods: state.periods || [],
        mode: "multi",
      });
    } else {
      Excel.exportMonthSchedule({
        state,
        Rules,
        Store,
        roleFilter: roleFilterExport,
        staffIds,
        period: currentPeriod(),
      });
    }
  }

  function render() {
    if (!requireAuth()) {
      showLogin();
      return;
    }
    ensurePeriods();
    renderNav();
    applyChromePermissions();
    updateSessionBadge();
    renderPeriodBar();
    const map = {
      home: renderHome,
      staff: renderStaff,
      quotas: renderQuotas,
      self: renderSelf,
      month: renderMonth,
      compliance: renderCompliance,
    };
    (map[page] || renderHome)();
  }

  function bindChrome() {
    $$(".nav button").forEach((b) => {
      b.onclick = () => go(b.dataset.page);
    });

    $("#btnExport").onclick = () => {
      if (!Auth.can(session, "importReset")) return alert("僅管理員可匯出 JSON 備份");
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const p = currentPeriod();
      a.download = `roster-${(p?.label || "backup").replace(/[\\/]/g, "-")}.json`;
      a.click();
    };
    $("#btnExcel").onclick = () => {
      const multi = (state.periods || []).length > 1 && confirm("匯出整批所有期別？\n按「確定」＝整批；「取消」＝僅目前期別。");
      doExportExcel(multi);
    };
    $("#btnImport").onclick = () => {
      if (!Auth.can(session, "importReset")) return alert("僅管理員可匯入");
      $("#importFile").click();
    };
    $("#importFile").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        state = Store.migratePeriods({ ...Store.defaultState(), ...JSON.parse(text) });
        Auth.ensureAccounts(state, Store.ROLES);
        persist();
        render();
        alert("匯入完成");
      } catch {
        alert("匯入失敗，請確認 JSON 格式");
      }
      e.target.value = "";
    };
    $("#btnReset").onclick = () => {
      if (!Auth.can(session, "importReset")) return alert("僅管理員可重置");
      if (!confirm("重置為示範資料？")) return;
      state = Store.reset();
      Auth.ensureAccounts(state, Store.ROLES);
      persist();
      render();
    };
    $("#btnLogout").onclick = () => {
      Auth.clearSession();
      session = null;
      showLogin();
    };

    $("#loginForm").onsubmit = (e) => {
      e.preventDefault();
      Auth.ensureAccounts(state, Store.ROLES);
      const result = Auth.login(state.accounts, $("#loginUser").value, $("#loginPass").value);
      if (!result.ok) {
        $("#loginError").textContent = result.error;
        return;
      }
      session = result.session;
      showApp();
    };

    $$("[data-quick-login]").forEach((b) => {
      b.onclick = () => {
        $("#loginUser").value = b.dataset.user;
        $("#loginPass").value = b.dataset.pass;
      };
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindChrome();
    if (session) showApp();
    else showLogin();
  });
})();
