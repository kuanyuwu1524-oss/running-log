# 跑步訓練紀錄

個人跑步訓練儀表板，介面為繁體中文。在瀏覽器打開根目錄的 `index.html` 即可查看每週跑量、ACWR 急慢性負荷比，以及訓練紀錄。可匯入 Garmin Connect 匯出的 CSV、在表格中修改 RPE 與天氣，並把瀏覽器裡的修改匯出成 JSON 備份。活動資料與 Chart.js 都已內嵌在 `index.html`，不需要另外的伺服器。

GitHub Pages：<https://kuanyuwu1524-oss.github.io/running-log/>

## 檔案

- `index.html`：發佈用的單檔網站
- `src/`：版面與程式來源（`template.html`、`style.css`、`structure.js`、`app.js`）
- `activities.json`：活動資料
- `vendor/chart.umd.min.js`：Chart.js
- `build.py`：把上述來源重組成 `index.html`
- `.nojekyll`：讓 GitHub Pages 直接提供檔案，不經 Jekyll 處理

## 重新建置

`build.py` 會讀取 `src/`、`activities.json` 與 `vendor/chart.umd.min.js`，並覆寫同目錄的 `index.html`。腳本裡的專案路徑目前寫死為 `/workspace/garmin/site`，請在該目錄執行：

```bash
python3 build.py
```

成功時會印出產生的 HTML 字元數。
