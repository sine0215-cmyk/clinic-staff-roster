/** 期別、班別、合規檢核 */
window.DRRules = (function () {
  var DOW = ["日", "一", "二", "三", "四", "五", "六"];
  function parseYMD(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function formatYMD(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function toSlash(ymd) { return ymd.replace(/-/g, "/"); }
  function periodLabel(start, end) { return toSlash(start) + "~" + toSlash(end); }
  function dayOfWeek(ymd) { return parseYMD(ymd).getDay(); }
  function shiftKeys(ymd) { var dow = dayOfWeek(ymd); if (dow === 0) return []; if (dow === 6) return ["HE", "HA"]; return ["E", "A", "N"]; }
  function datesForPeriod(startYmd, endYmd) {
    var out = [], d = parseYMD(startYmd);
    while (formatYMD(d) <= endYmd) { out.push(formatYMD(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function buildPeriods(startYmd, count) {
    var n = Math.min(6, Math.max(1, +count || 1)), out = [], start = parseYMD(startYmd);
    for (var i = 0; i < n; i++) {
      var s = new Date(start); s.setDate(s.getDate() + i * 28);
      var e = new Date(s); e.setDate(e.getDate() + 27);
      var startStr = formatYMD(s), endStr = formatYMD(e);
      out.push({ id: "P" + (i + 1), start: startStr, end: endStr, label: periodLabel(startStr, endStr), dates: datesForPeriod(startStr, endStr) });
    }
    return out;
  }
  function findPeriod(periods, id) { return periods.filter(function (p) { return p.id === id; })[0] || periods[0]; }
  function isOff(D, staffId, date, shift) {
    return D.leaves.some(function (x) { return x.staffId === staffId && x.date === date && (x.shift === "ALL" || x.shift === shift); });
  }
  function cellLabel(entry) {
    if (!entry || entry.kind === "例假") return "例假";
    if (entry.kind === "休息日") return "休息日";
    if (entry.kind === "work") {
      var sn = DR.SHIFT[entry.shift] ? DR.SHIFT[entry.shift].n.replace("班", "") : entry.shift;
      return entry.site + "／" + entry.position + "／" + sn;
    }
    return "";
  }
  function staffHoursInPeriod(D, staffId, periodId) {
    var ps = (D.personSchedule[periodId] || {})[staffId] || {}, h = 0;
    Object.keys(ps).forEach(function (d) { if (ps[d] && ps[d].kind === "work") h += DR.SLOT_HOURS; });
    return h;
  }
  function staffCompliance(D, s, period) {
    var ps = (D.personSchedule[period.id] || {})[s.id] || {}, hours = 0, offDays = 0, satWorked = 0, satOff = 0, nightRisk = 0, prevNight = false;
    period.dates.forEach(function (d) {
      var e = ps[d], dow = dayOfWeek(d);
      if (!e || e.kind === "例假" || e.kind === "休息日") {
        offDays += 1; if (dow === 6 && e && e.kind === "休息日") satOff += 1; prevNight = false; return;
      }
      if (e.kind === "work") {
        hours += DR.SLOT_HOURS; if (dow === 6) satWorked += 1;
        if (e.shift === "N") prevNight = true;
        else if (e.shift === "E" && prevNight) nightRisk += 1;
        else prevNight = e.shift === "N";
      }
    });
    var issues = [];
    if (hours > DR.MAX_HOURS) issues.push("四週工時 " + hours + "h 超過 160h");
    if (offDays < 8) issues.push("例假＋休息日不足 8 日（" + offDays + "）");
    if (satOff !== 1) issues.push("週六休應 1 日（" + satOff + "）");
    if (satWorked !== 3) issues.push("週六假早應 3 日（" + satWorked + "）");
    if (nightRisk) issues.push("晚接早 " + nightRisk + " 次");
    return { hours: hours, offDays: offDays, satOff: satOff, satWorked: satWorked, nightRisk: nightRisk, issues: issues, ok: !issues.length };
  }
  return { DOW: DOW, parseYMD: parseYMD, formatYMD: formatYMD, toSlash: toSlash, periodLabel: periodLabel, dayOfWeek: dayOfWeek, shiftKeys: shiftKeys, datesForPeriod: datesForPeriod, buildPeriods: buildPeriods, findPeriod: findPeriod, isOff: isOff, cellLabel: cellLabel, staffHoursInPeriod: staffHoursInPeriod, staffCompliance: staffCompliance };
})();
