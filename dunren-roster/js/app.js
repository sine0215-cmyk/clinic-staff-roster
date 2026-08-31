/** UI */
(function () {
  var Rules = window.DRRules, D = DR.loadState(), periods = [];
  function $(id) { return document.getElementById(id); }
  function esc(x) { return String(x || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function opts(arr, current) { return arr.map(function (x) { var v = x.v != null ? x.v : x, l = x.l != null ? x.l : x; return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(l) + "</option>"; }).join(""); }
  function refreshPeriods() { periods = Rules.buildPeriods(D.periodStart, D.periodCount); if (!periods.some(function (p) { return p.id === D.activePeriodId; })) D.activePeriodId = periods[0].id; }
  function activePeriod() { return Rules.findPeriod(periods, D.activePeriodId); }
  function siteMatch(site) { return D.siteFilter === "全部院所" || site === D.siteFilter; }
  function save() { DR.saveState(D); $("saveState").textContent = "已儲存"; setTimeout(function () { $("saveState").textContent = ""; }, 1800); renderAll(); }
  function showPage(id) { document.querySelectorAll(".page").forEach(function (x) { x.classList.toggle("hidden", x.id !== id); }); document.querySelectorAll("[data-page]").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-page") === id); }); renderAll(); }
  function renderTop() {
    $("siteFilter").innerHTML = opts(["全部院所"].concat(DR.SITES), D.siteFilter);
    $("periodStart").value = D.periodStart; $("periodCount").value = String(D.periodCount); $("scheduleMode").value = D.scheduleMode;
    $("periodChips").innerHTML = periods.map(function (p) { return '<button type="button" class="period-chip' + (p.id === D.activePeriodId ? " on" : "") + '" data-period="' + esc(p.id) + '">' + esc(p.label) + "</button>"; }).join("");
    $("periodChips").querySelectorAll(".period-chip").forEach(function (btn) { btn.onclick = function () { D.activePeriodId = btn.getAttribute("data-period"); save(); }; });
    var cur = $("draftPeriod").value; $("draftPeriod").innerHTML = opts(periods.map(function (p) { return { v: p.label, l: p.label }; }), cur); if (cur) $("draftPeriod").value = cur;
  }
  function renderSummary() {
    var p = activePeriod(), slots = 0, gaps = 0;
    p.dates.forEach(function (d) { Rules.shiftKeys(d).forEach(function (sh) { D.demands.forEach(function (x) { if (siteMatch(x.site)) slots += x.needs[sh] || 0; }); }); });
    Object.keys(D.assignments || {}).forEach(function (k) { var a = D.assignments[k]; if (a.period === p.id && siteMatch(a.site) && !a.staffId) gaps += 1; });
    $("staffKpi").textContent = D.staff.length + " 人（核心 " + D.staff.filter(DR.isCorePool).length + "）";
    $("slotsKpi").textContent = slots + " 班位"; $("gapsKpi").textContent = gaps + " 缺額"; $("activePeriodLabel").textContent = p.label;
  }
  function renderStaff() {
    var term = ($("staffSearch").value || "").toLowerCase();
    $("staffRows").innerHTML = D.staff.filter(function (s) { return !term || [s.id, s.name, s.role, s.primarySite].join(" ").toLowerCase().indexOf(term) >= 0; }).map(function (s) {
      return "<tr><td>" + esc(s.id) + "</td><td>" + esc(s.name) + "</td><td>" + esc(s.role) + "</td><td>" + esc(s.primarySite) + "</td><td>" + esc(s.primaryPosition) + "</td><td>" + s.target.E + "／" + s.target.A + "／" + s.target.N + "／" + s.target.H + "</td></tr>";
    }).join("");
  }
  function renderDemand() {
    $("demandRows").innerHTML = D.demands.filter(function (x) { return siteMatch(x.site); }).map(function (x, idx) {
      return "<tr><td>" + esc(x.site) + "</td><td>" + esc(x.position) + "</td><td>" + esc(x.role) + "</td>" + ["E", "A", "N", "HE", "HA"].map(function (sh) {
        return '<td><input type="number" min="0" style="width:55px" value="' + (x.needs[sh] || 0) + '" onchange="DRApp.editNeed(' + D.demands.indexOf(x) + ',\'' + sh + '\',this.value)"></td>';
      }).join("") + "</tr>";
    }).join("");
  }
  function renderLeave() {
    var cur = $("leaveStaff").value; $("leaveStaff").innerHTML = opts(D.staff.map(function (x) { return { v: x.id, l: x.id + "｜" + x.name }; }), cur); if (cur) $("leaveStaff").value = cur;
    $("leaveRows").innerHTML = D.leaves.map(function (x, i) { var s = DR.staffById(D, x.staffId); return "<tr><td>" + esc(s ? s.name : x.staffId) + "</td><td>" + x.date + "</td><td>" + (x.shift === "ALL" ? "全天" : DR.SHIFT[x.shift].n) + '</td><td><button type="button" class="danger" onclick="DRApp.deleteLeave(' + i + ')">刪除</button></td></tr>'; }).join("");
  }
  function renderMatrix() {
    var p = activePeriod(), core = D.staff.filter(DR.isCorePool);
    $("matrixHead").innerHTML = "<tr><th>姓名</th><th>職稱</th>" + p.dates.map(function (d) { return "<th>" + d.slice(5).replace("-", "/") + "<br>週" + Rules.DOW[Rules.dayOfWeek(d)] + "</th>"; }).join("") + "<th>工時</th></tr>";
    $("matrixBody").innerHTML = core.map(function (s) {
      var ps = (D.personSchedule[p.id] || {})[s.id] || {}, h = Rules.staffHoursInPeriod(D, s.id, p.id);
      return "<tr><td class=\"name\">" + esc(s.name) + "</td><td>" + esc(s.role) + "</td>" + p.dates.map(function (d) {
        return '<td class="' + (Rules.dayOfWeek(d) === 6 ? "weekend" : "") + '">' + esc(Rules.cellLabel(ps[d])) + "</td>";
      }).join("") + '<td class="' + (h > DR.MAX_HOURS ? "bad" : "ok") + '">' + h + "h</td></tr>";
    }).join("");
  }
  function renderDraft() {
    var sel = $("draftPeriod").value || periods[0].label, p = periods.filter(function (x) { return x.label === sel; })[0] || periods[0];
    var list = Object.keys(D.assignments || {}).map(function (k) { return D.assignments[k]; }).filter(function (x) { return x.period === p.id && siteMatch(x.site); }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var gaps = list.filter(function (x) { return !x.staffId; }).length;
    $("draftAlerts").innerHTML = gaps ? '<p class="bad">缺額 ' + gaps + " 筆</p>" : '<p class="ok">已排 ' + list.length + " 筆</p>";
    $("draftRows").innerHTML = list.map(function (a) { var s = DR.staffById(D, a.staffId); return "<tr><td>" + a.date + "</td><td>" + DR.SHIFT[a.shift].n + "</td><td>" + esc(a.site) + "</td><td>" + esc(a.position) + "</td><td>" + esc(s ? s.name : "") + "</td><td class=\"" + (s ? "ok" : "bad") + "\">" + (s ? "已排" : "缺額") + "</td></tr>"; }).join("");
  }
  function renderCompliance() {
    var p = activePeriod();
    $("complianceRows").innerHTML = D.staff.filter(DR.isCorePool).map(function (s) {
      var c = Rules.staffCompliance(D, s, p);
      return "<tr><td>" + esc(s.name) + "</td><td>" + c.hours + "h</td><td>" + c.offDays + "</td><td>" + c.satOff + "／" + c.satWorked + "</td><td class=\"" + (c.nightRisk ? "bad" : "ok") + "\">" + c.nightRisk + "</td><td class=\"" + (c.ok ? "ok" : "bad") + "\">" + (c.ok ? "符合" : esc(c.issues.join("；"))) + "</td></tr>";
    }).join("");
  }
  function renderAll() { refreshPeriods(); renderTop(); renderSummary(); renderStaff(); renderDemand(); renderLeave(); renderMatrix(); renderDraft(); renderCompliance(); }
  function onSettingsChange() { D.periodStart = $("periodStart").value; D.periodCount = +$("periodCount").value || 1; D.siteFilter = $("siteFilter").value; D.scheduleMode = $("scheduleMode").value; save(); }
  window.DRApp = {
    showPage: showPage, save: save, onSettingsChange: onSettingsChange,
    generateDraft: function () { refreshPeriods(); DRScheduler.generate(D, periods); save(); alert("已產生 " + periods.length + " 期草案"); },
    exportJson: function () { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(D, null, 2)], { type: "application/json" })); a.download = "敦仁診所排班備份.json"; a.click(); },
    importJson: function (ev) { var f = ev.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { try { D = Object.assign(DR.defaultState(), JSON.parse(r.result)); save(); } catch (e) { alert("格式錯誤"); } }; r.readAsText(f); },
    addLeave: function () { var id = $("leaveStaff").value, date = $("leaveDate").value; if (!id || !date) return alert("請選員工與日期"); D.leaves.push({ staffId: id, date: date, shift: $("leaveShift").value }); save(); },
    deleteLeave: function (i) { D.leaves.splice(i, 1); save(); },
    editNeed: function (i, sh, v) { D.demands[i].needs[sh] = +v || 0; save(); },
    exportExcel: function () { refreshPeriods(); DRExcel.exportAll(D, periods); },
    exportExcelCurrent: function () { refreshPeriods(); DRExcel.exportCurrent(D, activePeriod()); },
  };
  ["siteFilter", "periodStart", "periodCount", "scheduleMode"].forEach(function (id) { $(id).onchange = onSettingsChange; });
  renderAll(); showPage("summary");
})();
