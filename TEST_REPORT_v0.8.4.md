# BTC Liquidity Radar v0.8.4 — 測試報告

## 解密方案

- V0：用每次請求的 Cache-Ts-V2 當第一層種子。
- V1：用固定 API path `/api/liqHeatMap/list` 當第一層種子。
- V2：用當次回應 `Time` 標頭當第一層種子。
- 每次依 `V` 自動判斷，兩層 AES-128-ECB + GZIP 還原 JSON，僅比對 BTC 的 `maxLongLiquidationPrice`、`maxShortLiquidationPrice` 及對應金額。
- 若回應 `V3` 未知版本、空資料、無法取得 `User/V/Time`、網路失敗或解密失敗，不會捏造新價；舊價只依既有逾時/快取規則標註。

## 完成測試

| 項目 | 結果 |
|---|---|
| Node AES/GZIP 人工加密樣本：V0→V1→V2→V0→V2→V1 | 六次通過，還原 BTC 82685.87／80981.05 |
| 兩側金額還原 | 通過 |
| 未支援 V3 應報錯 | 通過 |
| `data:null` 必須報錯 | 通過 |
| Chromium 模擬實際頁面請求：V0→V1→V2→V0 | 四次通過；浮卡價格與 V 版號同步 |
| Chromium 1024×768／1366×768／1920×1080 | 無水平/垂直捲動 |
| Chromium 4H／15M 切換不改 CoinGlass/機率 | 通過 |
| 所有 JS `node --check` | 通過 |
| v0.8.3 派網資料模組、模型權重、版面樣式、凍結程式 | 保留；重要模組 bytes 比對一致 |

## 未完成的驗證

- 無法從測試執行環境確認 CoinGlass 真實線上端點在此刻是否容許跨域直接讀取（授權、CORS、服務端改版等仍可能導致讀取失敗）。
- 未對 CoinGlass 真實 V0 和 V1 密文逐筆驗證；人工等價密文測試通過。用戶上傳的 v0.2.2 說明 V2 曾使用真實密文驗證，但本次包內不含密文原始檔。
- 本次無法進行真實派網及 CoinGlass 長時間連線測試。

**測試價位均為人工樣本，不是實時 BTC。**
