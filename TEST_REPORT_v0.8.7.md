# v0.8.7 功能／回歸測試報告

測試日期：2026-10-16。使用使用者提供的 `BTC_CoinGlass_Liquidation_Radar_v0.2.3_Full(1).zip` 的 V55/V66/V77 固定種子，套入原 v0.8.6，不改機率模型。

| 項目 | 結果 | 驗證方式 |
|---|---|---|
| V0、V1、V2、V55、V66、V77 | PASS | 六種 AES-128-ECB / GZIP 完整雙層加解密合成密文 round-trip |
| 依回應 V 自動切換 | PASS | 六種版本 HTTP 回應模擬＋瀏覽器連續輪替 |
| 解碼 BTC 上下清算價、名目金額 | PASS | 合成資料依序顯示 83,310.60 / 81,665.85 |
| 未知 V99 拒絕，不造假數據 | PASS | 先前成功數值保留，另顯示解碼錯誤 |
| 缺少 V2 Time、錯誤密文 | PASS | 明確錯誤、不視作成功 |
| V55／66／77 的快取版本白名單 | PASS（靜態） | 確認快取還原正則包含全部六版；未測重開不同 HTTP 原點儲存 |
| 4H／15M 切換 | PASS | Chromium 介面操作 |
| 1366×768 單畫面無捲動 | PASS | Chromium 版面尺寸檢查 |
| 原機率、HA、凍結與派網程式 | PASS（程式未修改） | model_predictor.js、probability_engine.js、pionex-feed.js 等 SHA-256 完全相同 |
| 全部 JavaScript 語法 | PASS | `node --check` |
| ZIP 完整性、覆蓋檔案清單 | PASS | zip CRC + 檔案內容比對 |

**未驗證**：在 CoinGlass 真正伺服器上的 V55／V66／V77 加密回應連續刷新、端點授權／CORS、正式環境長時間穩定性；這次的六版本測試使用模擬協定回應，不保證未來所有未知版本可解。
