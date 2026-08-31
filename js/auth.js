/**
 * 登入身分與權限
 * kind: admin（全院）| manager（單一職務主管）| staff（同仁）
 */
(function (global) {
  const SESSION_KEY = "clinic-roster-session-v1";

  const DEMO_PASSWORD = "demo";

  function defaultAccounts(staffList, ROLES) {
    const accounts = [
      {
        id: "acc_admin",
        username: "admin",
        password: "admin",
        name: "系統管理員",
        kind: "admin",
        role: null,
        staffId: null,
      },
    ];

    for (const r of ROLES) {
      accounts.push({
        id: `acc_mgr_${r.id}`,
        username: r.id,
        password: DEMO_PASSWORD,
        name: `${r.label}主管`,
        kind: "manager",
        role: r.id,
        staffId: null,
      });
    }

    for (const s of staffList) {
      accounts.push({
        id: `acc_${s.id}`,
        username: s.id,
        password: DEMO_PASSWORD,
        name: s.name,
        kind: "staff",
        role: s.role,
        staffId: s.id,
      });
    }

    return accounts;
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function login(accounts, username, password) {
    const u = String(username || "").trim().toLowerCase();
    const p = String(password || "");
    const acc = accounts.find(
      (a) => a.username.toLowerCase() === u && a.password === p
    );
    if (!acc) return { ok: false, error: "帳號或密碼錯誤" };
    const session = {
      accountId: acc.id,
      username: acc.username,
      name: acc.name,
      kind: acc.kind,
      role: acc.role,
      staffId: acc.staffId,
      loginAt: new Date().toISOString(),
    };
    saveSession(session);
    return { ok: true, session };
  }

  function ensureAccounts(state, ROLES) {
    if (!Array.isArray(state.accounts) || !state.accounts.length) {
      state.accounts = defaultAccounts(state.staff || [], ROLES);
      return;
    }
    // 補齊新增人員的同仁帳號
    const have = new Set(
      state.accounts.filter((a) => a.staffId).map((a) => a.staffId)
    );
    for (const s of state.staff || []) {
      if (have.has(s.id)) continue;
      state.accounts.push({
        id: `acc_${s.id}`,
        username: s.id,
        password: DEMO_PASSWORD,
        name: s.name,
        kind: "staff",
        role: s.role,
        staffId: s.id,
      });
    }
  }

  /** 權限 */
  function can(session, action, ctx) {
    if (!session) return false;
    const { kind, role, staffId } = session;

    switch (action) {
      case "viewHome":
      case "viewMonth":
      case "exportExcel":
        return true;
      case "manageStaff":
      case "manageQuotas":
        return kind === "admin" || kind === "manager";
      case "manageRole":
        if (kind === "admin") return true;
        if (kind === "manager") return ctx?.role === role;
        return false;
      case "autoSchedule":
        return kind === "admin" || kind === "manager";
      case "editSchedule":
        if (kind === "admin") return true;
        if (kind === "manager") return ctx?.role === role;
        return false;
      case "selfSchedule":
        return true;
      case "editSelfFor":
        if (kind === "admin") return true;
        if (kind === "manager") {
          const target = ctx?.staff;
          return target && target.role === role;
        }
        if (kind === "staff") return ctx?.staffId === staffId;
        return false;
      case "compliance":
        return kind === "admin" || kind === "manager";
      case "importReset":
        return kind === "admin";
      case "viewAllRoles":
        return kind === "admin";
      default:
        return false;
    }
  }

  function allowedPages(session) {
    if (!session) return [];
    if (session.kind === "admin") {
      return ["home", "staff", "quotas", "self", "month", "compliance"];
    }
    if (session.kind === "manager") {
      return ["home", "staff", "quotas", "self", "month", "compliance"];
    }
    // staff
    return ["home", "self", "month"];
  }

  function managedRoleIds(session) {
    if (!session) return [];
    if (session.kind === "admin") return null; // null = all
    if (session.kind === "manager") return [session.role];
    return session.role ? [session.role] : [];
  }

  function filterStaffBySession(staff, session) {
    if (!session) return [];
    if (session.kind === "admin") return staff;
    if (session.kind === "manager") {
      return staff.filter((s) => s.role === session.role);
    }
    return staff.filter((s) => s.id === session.staffId);
  }

  function kindLabel(kind) {
    return { admin: "系統管理員", manager: "職務主管", staff: "同仁" }[kind] || kind;
  }

  global.RosterAuth = {
    SESSION_KEY,
    DEMO_PASSWORD,
    defaultAccounts,
    loadSession,
    saveSession,
    clearSession,
    login,
    ensureAccounts,
    can,
    allowedPages,
    managedRoleIds,
    filterStaffBySession,
    kindLabel,
  };
})(window);
