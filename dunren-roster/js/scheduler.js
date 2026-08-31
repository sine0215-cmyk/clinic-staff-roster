/** 自動排班 */
window.DRScheduler = (function () {
  var Rules = window.DRRules;
  function assignKey(period, date, shift, site, position, n) { return [period, date, shift, site, position, n].join("|"); }
  function syncAssignmentsFromPersonSchedule(D, period) {
    Object.keys(D.assignments || {}).forEach(function (k) { if (D.assignments[k].period === period.id) delete D.assignments[k]; });
    var ps = D.personSchedule[period.id] || {};
    Object.keys(ps).forEach(function (staffId) {
      Object.keys(ps[staffId]).forEach(function (date) {
        var e = ps[staffId][date];
        if (!e || e.kind !== "work") return;
        var k = assignKey(period.id, date, e.shift, e.site, e.position, 0);
        D.assignments[k] = { period: period.id, date: date, shift: e.shift, site: e.site, position: e.position, role: DR.staffById(D, staffId).role, staffId: staffId };
      });
    });
  }
  function generateSatAmPriority(D, periods) {
    D.personSchedule = D.personSchedule || {};
    periods.forEach(function (period) {
      D.personSchedule[period.id] = {};
      var dates = period.dates;
      var saturdays = dates.filter(function (d) { return Rules.dayOfWeek(d) === 6; });
      D.staff.filter(DR.isCorePool).forEach(function (s, si) {
        D.personSchedule[period.id][s.id] = {};
        var site = s.primarySite, pos = s.primaryPosition, satOffIdx = si % 4, counts = { E: 0, A: 0, N: 0, H: 0 }, hours = 0;
        dates.forEach(function (date, di) {
          var dow = Rules.dayOfWeek(date);
          if (dow === 0) { D.personSchedule[period.id][s.id][date] = { kind: "例假" }; return; }
          if (Rules.isOff(D, s.id, date, "ALL")) { D.personSchedule[period.id][s.id][date] = { kind: "休息日" }; return; }
          if (dow === 6) {
            if (saturdays.indexOf(date) === satOffIdx || Rules.isOff(D, s.id, date, "HE")) {
              D.personSchedule[period.id][s.id][date] = { kind: "休息日" }; return;
            }
            D.personSchedule[period.id][s.id][date] = { kind: "work", shift: "HE", site: site, position: pos };
            counts.H += 1; hours += DR.SLOT_HOURS; return;
          }
          if ((dow - 1) === ((si + Math.floor(di / 7)) % 5)) { D.personSchedule[period.id][s.id][date] = { kind: "休息日" }; return; }
          if (hours >= DR.MAX_HOURS) { D.personSchedule[period.id][s.id][date] = { kind: "休息日" }; return; }
          var order = ["A", "E", "N"].sort(function (a, b) { return (counts[a] / (s.target[a] || 1)) - (counts[b] / (s.target[b] || 1)); });
          var shift = order[(di + si) % 3];
          if (Rules.isOff(D, s.id, date, shift)) { D.personSchedule[period.id][s.id][date] = { kind: "休息日" }; return; }
          D.personSchedule[period.id][s.id][date] = { kind: "work", shift: shift, site: site, position: pos };
          counts[shift] += 1; hours += DR.SLOT_HOURS;
        });
      });
      syncAssignmentsFromPersonSchedule(D, period);
    });
  }
  function candidateScore(D, s, date, shift, site, position, assigns) {
    if (s.sites.indexOf(site) < 0 || s.positions.indexOf(position) < 0) return -99999;
    if (Rules.isOff(D, s.id, date, shift) || Rules.isOff(D, s.id, date, "ALL")) return -99999;
    if (assigns.some(function (a) { return a.staffId === s.id && a.date === date; })) return -99999;
    var prev = Rules.parseYMD(date); prev.setDate(prev.getDate() - 1);
    if (shift === "E" && assigns.some(function (a) { return a.staffId === s.id && a.date === Rules.formatYMD(prev) && a.shift === "N"; })) return -99999;
    var target = (shift === "HE" || shift === "HA") ? s.target.H : s.target[shift];
    return 100 - (target || 1) * 4 - (s.employment === "兼職" ? 50 : 0);
  }
  function generateDemandDraft(D, periods) {
    D.assignments = {};
    periods.forEach(function (period) {
      var assigns = [];
      period.dates.forEach(function (date) {
        Rules.shiftKeys(date).forEach(function (sh) {
          D.demands.forEach(function (d) {
            for (var n = 0; n < (d.needs[sh] || 0); n++) {
              var c = D.staff.filter(function (s) { return s.role === d.role; }).map(function (s) { return { s: s, score: candidateScore(D, s, date, sh, d.site, d.position, assigns) }; }).filter(function (x) { return x.score > -99999; }).sort(function (a, b) { return b.score - a.score; });
              var a = { period: period.id, date: date, shift: sh, site: d.site, position: d.position, role: d.role, staffId: c.length ? c[0].s.id : "" };
              D.assignments[assignKey(period.id, date, sh, d.site, d.position, n)] = a; assigns.push(a);
            }
          });
        });
      });
    });
  }
  function generate(D, periods) {
    if (D.scheduleMode === "sat-am-priority") generateSatAmPriority(D, periods);
    else generateDemandDraft(D, periods);
  }
  return { generate: generate };
})();
