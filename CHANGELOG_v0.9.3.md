# v0.9.3

新增專門執行 CoinGlass 已解析 JSON 的 `capture.html` 暫存頁，以及 `btc-liq-browser-capture` Cloudflare Browser Run Worker。

19:55～19:59（台灣）雲端瀏覽器定時執行暫存頁，等待上下界 JSON，驗證後保存到既有 R2 分鐘快照鍵。現有 `btc-liq-automator` 20:02 凍結、次日08:10 結算流程不變。圖表/派網/機率/HA/20:00 凍結規則都不改。

CoinGlass 未授權或拒絕存取時會記錄失敗，不會偽裝擷取成功；既有 Binance L2 備援仍然可用。
