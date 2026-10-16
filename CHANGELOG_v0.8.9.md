# v0.8.9 — CoinGlass 優先／Binance L2 備援

- 預設 `CoinGlass 優先`：當次 CoinGlass 24H 讀取、解碼成功且未過期才使用。若解碼失敗、授權或 CORS 失敗、資料為空或最後成功資料已過期，切換 Binance L2；後續 CoinGlass 恢復就自動切回。
- 可在「⚙ 設定 → 清算價資料來源」手動選擇 `Binance L2` 或 `人工標記`。選擇 Binance L2 時，即使 CoinGlass 成功也維持 Binance；切回「CoinGlass 優先」才恢復優先判斷。
- Binance 模型完全採用上傳的最初 v0.1.0 價帶方法：BTCUSDT 最近 288 根 15M K 線、quote asset 成交額、25/50/75/100 倍槓桿代理、預設 ±6% 搜尋、0.18% 價帶分箱；各側由近到遠排序後 **只取 L2（第二近）**。
- Binance K 線先試 U 本位合約 `fapi.binance.com`，再試 `fapi1.binance.com`；都無法使用時才嘗試 Binance 現貨 `data-api.binance.vision`，並記錄來源。此價位是「清算價代理估算」，不是 Binance 交易所官方揭露的真實強平價格。
- 只更動清算上下界，不更換 Pionex 即時現價、4H/15M 圖、日線平均K，或 39 特徵機率模型。
- 20:00 凍結：當下使用 CoinGlass 則存 CoinGlass；當下 Binance 備援／人工選 Binance 則存 Binance L2，並保存來源。07:59 前圖上以凍結值優先；08:00 回到即時可用來源。拖曳小面板依目前選擇持續更新、不受凍結影響。
- 因錯過 20:00 而沒有有效現場歷史快照時，不拿 22:00 才算到的 Binance/CoinGlass 價位偽裝成 20:00 凍結值。
- CoinGlass / Binance 每 60 秒嘗試刷新，資料來源可在拖曳小面板和設定詳情辨別，三分鐘無新成功更新視為過期。
