# v0.9.7 雲端歷史全自動讀取

- 參考 SStateMarketTerminal：固定 Cloudflare Worker URL，網頁開啟即讀歷史。
- 移除「輸入 Worker 網址／同步金鑰／連線」UI，保留一鍵重新讀取。
- Worker 新增公開唯讀 `GET /api/btc-liq/public/records` 與 `GET /api/btc-liq/public/status`；舊 `PUT` 接口仍需 Bearer Secret。
- 網頁不再送 CoinGlass 寫入或自行推送凍結結果；R2 真正寫入由現有雲端 Cron 負責。
- 保留雲端排程合併版本的時段判斷（v0.9.3a），不可用舊版 Worker 覆蓋。
- 前端斷線保留本機離線快取並顯示失敗，不將本機測試或未結算結果假裝成雲端已結算。
- CoinGlass / Binance / Pionex 資料來源、機率運算、20:00 凍結時間、08:10 結算不變。

## 注意：公開唯讀
任何知道 GET URL 的人都能取得這個交易研究頁面公開的凍結結果；不包含 Secret，也無寫入權限。如果不想公開戰績，應另加 Cloudflare Access 驗證（將需要登入）。
