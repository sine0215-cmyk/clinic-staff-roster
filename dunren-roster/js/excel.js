/** Excel 匯出 */
window.DRExcel = (function () {
  var Rules = window.DRRules;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function cell(text, style) { return "<Cell" + (style ? ' ss:StyleID="' + style + '"' : "") + '><Data ss:Type="String">' + esc(text) + "</Data></Cell>"; }
  function row(cells) { return "<Row>" + cells + "</Row>"; }
  function sheet(name, rows) { return '<Worksheet ss:Name="' + esc(name) + '"><Table>' + rows + "</Table></Worksheet>"; }
  function workbook(sheets) { return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#167D82" ss:Pattern="Solid"/></Style><Style ss:ID="Sat"><Interior ss:Color="#FFF8EF" ss:Pattern="Solid"/></Style><Style ss:ID="Sun"><Interior ss:Color="#EEEEEE" ss:Pattern="Solid"/></Style></Styles>' + sheets + "</Workbook>"; }
  function download(filename, xml) { var blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }); var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename.endsWith(".xls") ? filename : filename + ".xls"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }
  function rocShort(ymd) { var p = ymd.split("-"); return String(+p[0] - 1911).padStart(3, "0") + "/" + p[1] + "/" + p[2]; }
  function sheetNameFromPeriod(p) { return (p.start.replace(/-/g, "").slice(2) + "-" + p.end.replace(/-/g, "").slice(4)).slice(0, 31); }
  function buildPeriodSheet(D, period) {
    var dates = period.dates, core = D.staff.filter(DR.isCorePool);
    var rows = row(cell("敦仁診所四週試排班表｜" + rocShort(period.start) + "～" + rocShort(period.end))) + row(cell("每人四週休 1 週六；其餘 3 週六假早；週日例假；每日 1 節。")) + row(cell(""));
    var hdr = cell("員工編號", "Header") + cell("姓名", "Header") + cell("職稱", "Header") + cell("主要院所", "Header") + cell("主要職位", "Header");
    dates.forEach(function (d) { hdr += cell(d.slice(5).replace("-", "/") + "\n週" + Rules.DOW[Rules.dayOfWeek(d)], "Header"); });
    rows += row(hdr);
    core.forEach(function (s) {
      var ps = (D.personSchedule[period.id] || {})[s.id] || {};
      var line = cell(s.id) + cell(s.name) + cell(s.role) + cell(s.primarySite) + cell(s.primaryPosition);
      dates.forEach(function (d) { var dow = Rules.dayOfWeek(d), style = dow === 0 ? "Sun" : dow === 6 ? "Sat" : null; line += cell(Rules.cellLabel(ps[d]), style); });
      rows += row(line);
    });
    return sheet(sheetNameFromPeriod(period), rows);
  }
  function buildInfoSheet(periods) {
    var rows = row(cell("敦仁診所｜四週變形工時試排說明")) + row(cell("項目", "Header") + cell("說明", "Header"));
    periods.forEach(function (p, i) { rows += row(cell("第" + (i + 1) + "期") + cell(rocShort(p.start) + "～" + rocShort(p.end))); });
    return sheet("說明", rows);
  }
  function exportAll(D, periods) { var xml = buildInfoSheet(periods); periods.forEach(function (p) { xml += buildPeriodSheet(D, p); }); download("敦仁診所115年四週試排班表_" + periods.length + "期.xls", workbook(xml)); }
  function exportCurrent(D, period) { download("敦仁診所四週排班_" + period.start.replace(/-/g, "") + ".xls", workbook(buildInfoSheet([period]) + buildPeriodSheet(D, period))); }
  return { exportAll: exportAll, exportCurrent: exportCurrent };
})();
