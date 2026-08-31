/**
 * 匯出 Excel 相容檔（SpreadsheetML .xls，免外部套件、可離線）
 */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cell(text, style) {
    const t = esc(text);
    const ss = style ? ` ss:StyleID="${style}"` : "";
    return `<Cell${ss}><Data ss:Type="String">${t}</Data></Cell>`;
  }

  function row(cellsXml) {
    return `<Row>${cellsXml}</Row>`;
  }

  function sheet(name, rowsXml) {
    return `<Worksheet ss:Name="${esc(name)}"><Table>${rowsXml}</Table></Worksheet>`;
  }

  function workbook(sheetsXml) {
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EBE8" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Sat"><Interior ss:Color="#FFF3D6" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Sun"><Interior ss:Color="#EEEEEE" ss:Pattern="Solid"/></Style>
</Styles>
${sheetsXml}
</Workbook>`;
  }

  function downloadXls(filename, xml) {
    const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /**
   * 匯出單一或多個期別班表
   * opts.period — 單一期別；未傳則用 active
   * opts.periods — 多期別（各期各一組工作表，或合併日曆）
   */
  function exportMonthSchedule(opts) {
    const { state, Rules, Store, roleFilter, staffIds, period, periods, mode } = opts;
    const list =
      periods && periods.length
        ? periods
        : [
            period ||
              Rules.findPeriod(state.periods, state.activePeriodId) ||
              state.periods?.[0] ||
              Rules.makePeriod(Rules.formatYMD(new Date())),
          ];

    if (mode === "multi" || list.length > 1) {
      exportMultiPeriods({ ...opts, periods: list });
      return;
    }

    exportOnePeriod({ ...opts, period: list[0] });
  }

  function resolveScopedStaff(state, Store, roleFilter, staffIds) {
    const staff = state.staff.filter((s) => s.active !== false);
    let scoped =
      roleFilter == null ? staff : staff.filter((s) => s.role === roleFilter);
    if (staffIds && staffIds.length) {
      const set = new Set(staffIds);
      scoped = scoped.filter((s) => set.has(s.id));
    }
    return scoped;
  }

  function buildPeriodSheets(state, Rules, Store, period, roleFilter, staffIds) {
    const dates = period.dates || Rules.dateRange(period.start, 28);
    const label = period.label || Rules.periodLabel(dates[0], dates[dates.length - 1]);
    const scoped = resolveScopedStaff(state, Store, roleFilter, staffIds);
    const nameOf = (id) => {
      const s = state.staff.find((x) => x.id === id);
      return s ? s.name : id;
    };
    const namesInShift = (ymd, shift) => {
      const ids = (state.schedule[ymd] || {})[shift] || [];
      return ids
        .filter((id) => scoped.some((s) => s.id === id))
        .map(nameOf)
        .join("、");
    };

    const dowNames = ["日", "一", "二", "三", "四", "五", "六"];
    const titleRole =
      roleFilter == null ? "全部職務" : Store.roleLabel(roleFilter);

    let calRows = row(
      cell("日期", "Header") +
        cell("星期", "Header") +
        cell("早班 08:00-12:00", "Header") +
        cell("午班 13:30-17:30", "Header") +
        cell("晚班 17:30-21:30", "Header") +
        cell("備註", "Header")
    );
    for (const ymd of dates) {
      const dow = Rules.dayOfWeek(ymd);
      const style = dow === 0 ? "Sun" : dow === 6 ? "Sat" : null;
      const note =
        dow === 0 ? "例假／休息" : dow === 6 ? "假日班（無晚班）" : "";
      const allowed = Rules.allowedShifts(ymd);
      calRows += row(
        cell(Rules.toSlashDate(ymd), style) +
          cell(dowNames[dow], style) +
          cell(allowed.includes("morning") ? namesInShift(ymd, "morning") : "—", style) +
          cell(allowed.includes("afternoon") ? namesInShift(ymd, "afternoon") : "—", style) +
          cell(allowed.includes("evening") ? namesInShift(ymd, "evening") : "—", style) +
          cell(note, style)
      );
    }

    let matrixHeader =
      cell("姓名", "Header") + cell("職務", "Header") + cell("分組", "Header");
    for (const ymd of dates) {
      matrixHeader += cell(ymd.slice(5), "Header");
    }
    matrixHeader +=
      cell("早", "Header") +
      cell("午", "Header") +
      cell("晚", "Header") +
      cell("假日", "Header") +
      cell("總節", "Header") +
      cell("工時", "Header");
    let matrixRows = row(matrixHeader);

    for (const s of scoped) {
      let m = 0,
        a = 0,
        e = 0,
        h = 0;
      let cells =
        cell(s.name) + cell(Store.roleLabel(s.role)) + cell(s.group || "");
      for (const ymd of dates) {
        const day = state.schedule[ymd] || {};
        const marks = [];
        if ((day.morning || []).includes(s.id)) {
          marks.push("早");
          if (Rules.isHolidayShiftDay(ymd)) h += 1;
          else m += 1;
        }
        if ((day.afternoon || []).includes(s.id)) {
          marks.push("午");
          if (Rules.isHolidayShiftDay(ymd)) h += 1;
          else a += 1;
        }
        if ((day.evening || []).includes(s.id)) {
          marks.push("晚");
          e += 1;
        }
        const dow = Rules.dayOfWeek(ymd);
        const style = dow === 0 ? "Sun" : dow === 6 ? "Sat" : null;
        cells += cell(marks.join("") || (dow === 0 ? "休" : ""), style);
      }
      const total = m + a + e + h;
      cells +=
        cell(String(m)) +
        cell(String(a)) +
        cell(String(e)) +
        cell(String(h)) +
        cell(String(total)) +
        cell(String(total * 4));
      matrixRows += row(cells);
    }

    const infoRows =
      row(cell("機構／系統", "Header") + cell(state.orgName || "醫療人員綜合排班")) +
      row(cell("期別", "Header") + cell(label)) +
      row(cell("範圍", "Header") + cell(titleRole)) +
      row(cell("匯出時間", "Header") + cell(new Date().toLocaleString("zh-TW"))) +
      row(
        cell("班別說明", "Header") +
          cell("一～五：早8-12／午13:30-17:30／晚17:30-21:30；六：早午；日：休｜四週變形工時")
      );

    const safeName = label.replace(/[\\/:*?[\]]/g, "-").slice(0, 28);
    return {
      label,
      safeName,
      sheetsXml:
        sheet(`說明-${safeName}`.slice(0, 31), infoRows) +
        sheet(`日曆-${safeName}`.slice(0, 31), calRows) +
        sheet(`人員-${safeName}`.slice(0, 31), matrixRows),
    };
  }

  function exportOnePeriod(opts) {
    const { state, Rules, Store, roleFilter, staffIds, period } = opts;
    const built = buildPeriodSheets(state, Rules, Store, period, roleFilter, staffIds);
    const suffix = roleFilter ? `-${roleFilter}` : "-all";
    const fileLabel = built.label.replace(/[\\/]/g, "-");
    downloadXls(`排班表-${fileLabel}${suffix}`, workbook(built.sheetsXml));
  }

  function exportMultiPeriods(opts) {
    const { state, Rules, Store, roleFilter, staffIds, periods } = opts;
    let sheetsXml = "";
    // 總覽
    let overview =
      row(cell("序", "Header") + cell("期別", "Header") + cell("起日", "Header") + cell("迄日", "Header"));
    periods.forEach((p, i) => {
      overview += row(
        cell(String(i + 1)) +
          cell(p.label) +
          cell(Rules.toSlashDate(p.start)) +
          cell(Rules.toSlashDate(p.end))
      );
    });
    sheetsXml += sheet("期別總覽", overview);

    for (const p of periods) {
      sheetsXml += buildPeriodSheets(state, Rules, Store, p, roleFilter, staffIds).sheetsXml;
    }

    const first = periods[0].label.replace(/[\\/]/g, "-");
    const last = periods[periods.length - 1].label.replace(/[\\/]/g, "-");
    const suffix = roleFilter ? `-${roleFilter}` : "-all";
    downloadXls(`排班表-${periods.length}期-${first}_至_${last}${suffix}`.slice(0, 120), workbook(sheetsXml));
  }

  global.RosterExcel = { exportMonthSchedule, downloadXls };
})(window);
