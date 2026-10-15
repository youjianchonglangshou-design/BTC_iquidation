# BTC 清算方向雷達 v0.8.4

以 v0.8.3 為基礎，**只更新 CoinGlass V0/V1/V2 自動解碼**。保留 BTC4HBreakoutPulse 風格單頁、可拖曳即時 24H 浮卡、Pionex 4H/15M K 線、39 項訓練特徵、HA 黃紫 ±4.5pt、20:00 凍結與歷史紀錄。

## 使用

下載完整 ZIP 並解壓，在 Chrome 開啟 `index.html`；或把完整檔案部署至 GitHub Pages。已有 v0.8.3 的專案，解壓「覆蓋 ZIP」並覆蓋根目錄中 4 個同名檔案。

CoinGlass 回應的 `V` 自動切換解碼規則，不必手動操作。每 60 秒嘗試更新 CoinGlass 即時上/下界，成功時可以在右上角「⚙ 設定 → 資料狀態」查看最後解碼版本；20:00 的凍結價格及機率不因即時資料而改變。

> `fapi.coinglass.com` 為網站內部端點，不是官方保證提供給第三方的公開 API。是否能直接取得取決於網站權限、瀏覽器 CORS 與服務條款；本程式不具付費授權，也不承諾長期有效。

詳見 `TEST_REPORT_v0.8.4.md`、`OVERWRITE_THESE_v0.8.4.txt`。
