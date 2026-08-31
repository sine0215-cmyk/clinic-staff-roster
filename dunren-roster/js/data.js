/** 敦仁診所排班：常數、人員主檔、儲存 */
window.DR = window.DR || {};

DR.SITES = ["青埔敦仁", "內壢敦仁", "內壢新代"];
DR.ROLES = ["醫師", "營養師", "衛教師", "藥師", "醫務管理師", "護理師", "檢驗師", "待確認職務"];
DR.POS = [
  "一診醫師", "二診醫師", "三診醫師", "四診醫師", "五診醫師",
  "藥局前", "藥局後", "營養師室1", "營養師室2", "營養師室3",
  "胃鏡1", "胃鏡2", "胃鏡3",
  "檢驗室1", "檢驗室2", "檢驗室3", "檢驗室4", "檢驗室5",
  "衛教師室1", "衛教師室2",
  "一診跟診", "二診跟診", "三診跟診", "四診跟診", "五診跟診",
  "櫃檯1", "櫃檯2", "櫃檯3",
];
DR.SHIFT = {
  E: { n: "早班", h: 4, short: "早" },
  A: { n: "午班", h: 4, short: "午" },
  N: { n: "晚班", h: 4, short: "晚" },
  HE: { n: "假日早班", h: 4, short: "假日早" },
  HA: { n: "假日午班", h: 4, short: "假日午" },
};
DR.STORAGE_KEY = "dunren-four-week-roster-v7";
DR.MAX_HOURS = 160;
DR.SLOT_HOURS = 4;

DR.initialStaff = [
  ["NUR001", "黃惠珊", "護理師", "內壢敦仁", "一診跟診", 3, 3, 1, 1],
  ["NUR002", "葉文伶", "護理師", "內壢敦仁", "二診跟診", 3, 3, 1, 1],
  ["NUR003", "王禹涵", "護理師", "內壢敦仁", "三診跟診", 3, 3, 1, 1],
  ["NUR004", "劉淑櫻", "護理師", "內壢敦仁", "四診跟診", 3, 3, 1, 1],
  ["NUR005", "黃士柔", "護理師", "內壢敦仁", "五診跟診", 3, 3, 1, 1],
  ["NUR006", "林詩婷", "護理師", "內壢敦仁", "胃鏡1", 3, 3, 1, 1],
  ["NUR007", "蕭妤珊", "護理師", "內壢敦仁", "胃鏡2", 3, 3, 1, 1],
  ["NUR008", "黃美翔", "護理師", "內壢敦仁", "胃鏡3", 3, 3, 1, 1],
  ["NUR009", "林育如", "護理師", "內壢敦仁", "檢驗室1", 3, 3, 1, 1],
  ["NUR010", "李青霞", "護理師", "內壢敦仁", "檢驗室2", 3, 3, 1, 1],
  ["NUR011", "吳淑暄", "護理師", "內壢敦仁", "檢驗室3", 3, 3, 1, 1],
  ["NUR012", "蔡祁妘", "護理師", "內壢敦仁", "檢驗室4", 3, 3, 1, 1],
  ["NUR013", "黃品慈", "護理師", "內壢敦仁", "檢驗室5", 3, 3, 1, 1],
  ["DESK001", "李佳馨", "醫務管理師", "內壢敦仁", "櫃檯1", 3, 3, 1, 1],
  ["DESK002", "聶孝卿", "醫務管理師", "內壢敦仁", "櫃檯2", 3, 3, 1, 1],
  ["DESK003", "葉韻鈴", "醫務管理師", "內壢敦仁", "櫃檯3", 3, 3, 1, 1],
  ["DESK004", "王倢妤", "醫務管理師", "青埔敦仁", "櫃檯1", 3, 3, 1, 1],
  ["DESK005", "黃竑慈", "醫務管理師", "青埔敦仁", "櫃檯2", 3, 3, 1, 1],
  ["DESK006", "沈羿慈", "醫務管理師", "青埔敦仁", "櫃檯3", 3, 3, 1, 1],
  ["DESK007", "黃羽瑄", "醫務管理師", "內壢新代", "櫃檯1", 3, 3, 1, 1],
  ["DESK008", "劉毓慈", "醫務管理師", "內壢新代", "櫃檯2", 3, 3, 1, 1],
  ["DESK009", "林郁淇", "醫務管理師", "內壢新代", "櫃檯3", 3, 3, 1, 1],
  ["NUT001", "Rita", "營養師", "內壢敦仁", "營養師室1", 0, 0, 0, 0],
  ["NUT002", "琬芸", "營養師", "內壢敦仁", "營養師室2", 0, 0, 0, 0],
  ["NUT003", "宇晴（Apple）", "營養師", "內壢敦仁", "營養師室3", 0, 0, 0, 0],
  ["NUT004", "Judy", "營養師", "內壢敦仁", "營養師室1", 0, 0, 0, 0],
  ["PH001", "蘇芳誼", "藥師", "內壢敦仁", "藥局前", 0, 0, 0, 0],
  ["PH002", "何正德", "藥師", "內壢敦仁", "藥局前", 0, 0, 0, 0],
  ["PH003", "郭秀本", "藥師", "內壢敦仁", "藥局前", 0, 0, 0, 0],
  ["PH004", "阮紹權", "藥師", "內壢敦仁", "藥局前", 0, 0, 0, 0],
  ["PH005", "王超賢", "藥師", "內壢敦仁", "藥局前", 0, 0, 0, 0],
  ["HE001", "賴佩萱", "衛教師", "內壢敦仁", "衛教師室1", 0, 0, 0, 0],
  ["HE002", "卿美芳", "衛教師", "內壢敦仁", "衛教師室1", 0, 0, 0, 0],
  ["HE003", "呂英瑱", "衛教師", "內壢敦仁", "衛教師室2", 0, 0, 0, 0],
  ["HE004", "邱承琳", "衛教師", "內壢敦仁", "衛教師室2", 0, 0, 0, 0],
  ["DESK010", "黃家慈", "醫務管理師", "內壢敦仁", "櫃檯1", 0, 0, 0, 0, "兼職"],
].map(function (x) {
  var pool = x[9] === "兼職" ? "backup" : ["營養師", "藥師", "衛教師"].indexOf(x[2]) >= 0 ? "pro" : "core";
  return {
    id: x[0], name: x[1], role: x[2], primarySite: x[3], primaryPosition: x[4],
    sites: DR.SITES.slice(), positions: [x[4]],
    target: { E: x[5], A: x[6], N: x[7], H: x[8] },
    employment: x[9] || "正職", pool: pool,
  };
});

DR.initialDemand = [
  ["內壢敦仁", "櫃檯1", "醫務管理師", 1, 1, 1, 1, 1],
  ["內壢敦仁", "櫃檯2", "醫務管理師", 1, 1, 0, 0, 0],
  ["內壢敦仁", "一診跟診", "護理師", 1, 1, 1, 0, 0],
  ["內壢敦仁", "二診跟診", "護理師", 1, 1, 0, 0, 0],
  ["內壢敦仁", "藥局前", "藥師", 1, 1, 1, 1, 1],
  ["內壢敦仁", "藥局後", "藥師", 1, 1, 0, 0, 0],
  ["內壢敦仁", "胃鏡1", "護理師", 1, 1, 0, 0, 0],
  ["青埔敦仁", "櫃檯1", "醫務管理師", 1, 1, 1, 0, 0],
  ["內壢新代", "櫃檯1", "醫務管理師", 1, 1, 1, 0, 0],
].map(function (x) {
  return { site: x[0], position: x[1], role: x[2], needs: { E: x[3], A: x[4], N: x[5], HE: x[6], HA: x[7] } };
});

DR.defaultState = function () {
  return {
    staff: JSON.parse(JSON.stringify(DR.initialStaff)),
    demands: JSON.parse(JSON.stringify(DR.initialDemand)),
    leaves: [], assignments: {}, personSchedule: {},
    scheduleMode: "sat-am-priority",
    periodStart: "2026-08-30", periodCount: 2, activePeriodId: "P1", siteFilter: "全部院所",
  };
};

DR.loadState = function () {
  try {
    var raw = localStorage.getItem(DR.STORAGE_KEY);
    if (!raw) {
      var legacy = localStorage.getItem("dunren-four-week-roster-v6");
      if (legacy) {
        var old = JSON.parse(legacy);
        var base = DR.defaultState();
        base.staff = old.staff || base.staff;
        base.demands = old.demands || base.demands;
        base.leaves = old.leaves || [];
        base.assignments = old.assignments || {};
        return base;
      }
      return DR.defaultState();
    }
    return Object.assign(DR.defaultState(), JSON.parse(raw));
  } catch (e) { return DR.defaultState(); }
};

DR.saveState = function (D) { localStorage.setItem(DR.STORAGE_KEY, JSON.stringify(D)); };
DR.isCorePool = function (s) { return s.pool === "core"; };
DR.staffById = function (D, id) { return D.staff.filter(function (x) { return x.id === id; })[0]; };
