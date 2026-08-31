# 敦仁診所四週排班系統

離線模組化排班程式：三院所、22 人核心池週六早班優先試排、四週變形工時檢核、Excel 匯出。

## 開啟方式

雙擊 **`開啟敦仁排班系統.cmd`**，或以瀏覽器開啟 **`index.html`**。

## 結構

```
dunren-roster/
  index.html
  css/app.css
  js/data.js      人員主檔、儲存
  js/rules.js     期別、合規
  js/scheduler.js 週六早班優先／職位草案
  js/excel.js     Excel 匯出
  js/app.js       介面
```

## 預設設定

- 第一期：2026/08/30（115/08/30）
- 期數：2 期
- 模式：週六早班優先（22 人）

## 操作流程

1. 確認期別與人員主檔
2. 員工填寫「預畫休」
3. 總覽 → **產生排班草案**
4. 「期別班表」檢視 22 人矩陣
5. 「工時檢核」確認 160h
6. **匯出 Excel** 存檔

## 資料

- localStorage 鍵：`dunren-four-week-roster-v7`
- 可匯出／載入 JSON 備份
- 相容舊版 v6 JSON（自動遷移）
