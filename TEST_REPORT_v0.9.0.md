# v0.9.0 測試結果

### 已通過

- Worker JS 語法檢查（Node v22）。
- 缺少授權金鑰 → HTTP 401。
- 非允許來源 → HTTP 403；本機 `Origin: null`（允許時）CORS 預檢通過。
- `2026-10-15-20:00` 首次 PUT 保存；GET 列出每日紀錄。
- 重複 PUT 試圖更改凍結上下界及 55%/45% → 伺服器保留原凍結值。
- 次日結算 PUT 填入 `result/firstHitTpe/correct`；機率及上下界不改。
- 錯誤日期或 ID → HTTP 400。
- Chromium（本地載入 HTML + 模擬 HTTP 回應）：歷史小卡顯示、Worker URL／金鑰設定、連線、首次匯入舊本機紀錄、雲端讀取及 UI 狀態更新成功；無頁面 JS 例外。
- 單畫面交易主頁保留原排版；僅在「▤ 紀錄」小卡內新增 R2 設定，行情、模型與清算程式維持原版。

### 尚未驗證（不能聲稱完成部署）

- 你的 Cloudflare 帳戶中的 Bucket 名稱／R2 Binding、Worker Secret 尚未提供，未實際部署。
- 真正的 R2 讀寫延遲、跨裝置網際網路連線及 GitHub Pages 端到端測試待部署後驗證。
- 網頁完全關閉時不會自動產生新快照（沿用原版設計）。
- 兩台設備毫秒級同時結算更新會使用 R2 Conditional Put 避免不一致；此競態尚未在真實 Cloudflare 執行環境壓測。

### 測試檔案

`worker/test-worker.mjs` 使用假 R2 實作；Chromium UI 截圖為 `PREVIEW_R2_HISTORY.png`，裡面的金鑰和網址是測試用虛構資料。
