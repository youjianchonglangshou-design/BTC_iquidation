# BTC 清算方向雷達 v0.9.3 — 暫存網頁雲端擷取

重點：使用 Cloudflare Browser Run（不是一般 HTTP Fetch）讓雲端每晚自動開啟 `capture.html`，執行現有 CoinGlass 解密 JS，取出 JSON，寫入 R2；原 Worker 20:02 使用快照凍結，次日 08:10 結算。

- 公開暫存頁：`https://youjianchonglangshou-design.github.io/BTC_liquidation/capture.html`
- 自動擷取 Worker：`btc-liq-browser-capture`
- 保留既有 Worker：`btc-liq-automator`
- 兩者共用 R2：`btc-liq-records`／`BTC_RECORDS`
- 擷取時段：19:55～19:59（台灣時間）
- 凍結、結算：沿用 v0.9.2

操作詳見 `部署步驟_v0.9.3.md`。
