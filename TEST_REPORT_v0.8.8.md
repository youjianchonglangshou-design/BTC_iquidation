# v0.8.8 測試報告

測試使用 Chromium + 模擬符合 PIONEX 格式的 15M、4H、日 K 與現價，並非正式 PIONEX 外網長時間測試。

| 台灣時間 | 模擬 HA | 平均 K 膠囊 | 機率 | 結果 |
|---|---|---|---|---|
| 08:23 | 黃 | 黃（前日黃） | --（未公布） | PASS |
| 08:23 | 紫 | 紫（前日黃） | --（未公布） | PASS |
| 15:59 | 紫 | 紫（前日黃） | --（未公布） | PASS |
| 16:05 | 黃 | 黃（前日黃） | 54.61%／45.39% | PASS |
| 20:05 | 紫 | 紫（前日黃） | 45.31%／54.69%，凍結 | PASS |

5 組案例均無 JS exception，1366×768 無頁面捲動。測試用的價格和機率為模擬行情，不能當作即時 BTC 預測。

修改範圍：`app.js` 的平均 K 獨立顯示與日 K 更新容錯、`index.html` 版本文字及 `VERSION.json`。`probability_engine.js`、`model_predictor.js`、`coinglass-decrypt.js`、`pionex-feed.js` 完全不變。
