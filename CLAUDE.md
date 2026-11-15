# classroom-qa-wall — 課堂提問牆：匿名提問＋文字雲

課堂用。學生掃 QR code 用手機匿名提問、幫別人的問題按讚（最多人想問的排最前面）；老師可先審核再上牆、🎯 聚焦正在回答的題目、✅ 已回答、擋下洗版的人（不顯示是誰）。另一個分頁 ☁ 文字雲：老師出題，學生每人送 1～5 個詞，即時長成文字雲，可隱藏、合併同義詞、下載 PNG。

2026-11-15 建立。使用者從「還有那些軟體的方向」清單中挑了第 1 項（課堂系列：匿名提問牆＋文字雲）。骨架（教室、分頁鎖、管理密碼、關閉加入、轉播站連線、標準配備）複製自 `peer-review-board`，**畫面改成軟木布告欄＋便條紙＋紅圖釘、文字雲是深綠毛氈板**。

- 純靜態：`index.html`（CSS）＋`data.js`（訊息編解碼、讚數統計、文字雲斷詞合併與螺線排版；node 可 require，瀏覽器 `window.QAW`）＋`app.js`（老師 `T`、學生 `S`、連線 `NET`、投影畫面）＋`watermark.js`（列印浮水印，從同儕互評複製）＋`manual.html`＋PWA。
- 本機預覽 port **8885**（`.claude/launch.json` 的 `classroom-qa-wall`；程式牆 `LOCAL_APPS`）。visitor-badge `m255525.classroomqawall`。預定線上網址 <https://m255525.github.io/classroom-qa-wall/>（寫死在 `app.js` 的 `ONLINE`，非 github.io 網址時 QR code 一律指向它）。**2026-11-15 已上線**（repo 由使用者自己 `gh repo create`；push 之後才開 Pages，`build_type=workflow`，分支規則已是 master，第一次部署直接成功）。程式牆在 `REPO_META`（不在 LOCAL_APPS），github-dashboard 已補。

## 手機連線（借用創業島轉播站教室模式，Worker 沒改）
- `room=ASK<6碼>&cls=1`，老師帶 `tkey`（存 `qaw.tkey.<碼>`）。學生只看得到老師；學生的聊天只有老師收到。
- presence name（≤24 字、只用數字＋`T/S/|`，會被不雅字詞過濾）：老師 `T|<gid2><模式1：1提問 2文字雲><開放1><旗標1：1按讚+2記名+4關閉加入><先審核1><每人題數1><回合2><每人詞數1><聚焦題3><上牆題數3>`；學生 `S|<gid2>|<按讚題號3…>`（**最多 6 個讚**，就是 24 字限制來的）。
- 聊天（≤60 字、2.7 秒佇列，`queueChats(list, tag, first)`，first＝插隊）：老師 `R:教室名`、`A<id3>:問題¦<id3>:問題…`（新增／修改／重送，好幾題塞一則）、`X:<id3><0待回答1已回答2拿下來>,…`、`L:<id3>=<讚>,…`（讚數，節流 6 秒，最熱門 16 題）、`P<回合2>:題目`；學生 `Q<gid2>:問題`（≤50 字）、`W<gid2><回合2>:詞`（≤12 字）、`N:名字`（記名時）。
- **有人加入／老師重連 → `sendSync()` 整批重送**（教室名、題目、所有上牆問題、已回答狀態、讚數，tag `sync`），因為轉播站只留 20 則歷史。
- 老師端用 `m.id|m.at` 去重（`G.seen`），重連時轉播站重播的舊聊天不會重複收題。
- 學生自己的問題：送出時記原文 `S.mine`，轉播站回傳（可能被遮字）的記在 `S.echo`，依順序對應；用來標「你問的」與「等老師審核」。
- 關閉教室：主持台右側教室卡（含關閉加入狀態時）直接有紅色「🚪 關閉教室」按鈕（2026-11-15 使用者要求放明顯），走 `guard`（有管理密碼要輸入）→ 轉播站 `close`，全部學生 4004、換新代碼、`G.netOff`；學生端若之前在教室裡（`S.T` 有值）顯示「👋 老師已經關閉教室」。
- 擋下：`G.banned` → 轉播站 `kick`（4005、黑名單），他的問題全部 `hidden`；「全部解除」逐一 `unkick`。關閉加入用的是另一組 `G.kicked`／`G.allow`（同同儕互評）。

## 老師資料（localStorage 前綴 `qaw.`）
- `rooms`、`event.<id>`（G：cfg、qs、seq、likes{sid:[id]}、members、spot、round、rounds{n:{prompt, words{sid:[詞]}, hidden, merge}}、banned…）、`lock.<id>`、`cfg`（上次的規則）、`rulesOpen`、`fs`、`mute`、`fold`、`warnSeen`、`marquee`。學生：`who`、`sid.<碼>`、`room.<碼>`、`st.<碼>`（牆、讚、送出的問題與詞）。
- 問題狀態 `pending`（待審核，不會送到手機）→ `open` → `done`（記下當時讚數 `final`）／`hidden`。`q.sent` 表示已經送過 A，之後改狀態才用 X。
- 文字雲 `P.tally`：`wordKey`（NFKC、小寫、去空白）合併，同一人同一個詞只算一次；`merge` 可鏈結（防循環）。`P.layoutCloud(items, W, H, measure)` 螺線排版、不重疊不出界。主持台 canvas 寬 100%（**不要設固定 px 寬**，踩過：縮窄視窗時外框被 canvas 撐住，400px 橫向溢出），點擊用 `cv._W/_H` 換算；投影視窗用 `{px:true}`。
- 投影畫面：同視窗 `V.proj`（Esc 回主持台），或新視窗 `?c=<id>&proj=1`（只讀、不搶分頁鎖、不連線，聽 `storage` 事件更新）。投影不顯示待審核與操作按鈕。
- 測試掛鉤 `window._qaw`（G、T、S、NET、ACT、V、P）。

## 驗證
- **改 data.js 後跑 `node tools/test_engine.mjs`**（約 38 萬項；會 import 創業島 `presence-worker/badwords.js` 檢查狀態碼不被過濾、遮字後 `¦` 仍能拆開）。
- `python tools/e2e_qaw.py <截圖資料夾>`（需先開 8885；連**正式轉播站**隨機 ASK 房間；`QAW_BASE` 可測線上版）：老師＋投影視窗＋5 支手機：提問、不雅字詞遮罩、牆同步、按讚與收回、熱門排序、每人題數、先審核（待審不外流）、聚焦與回答完換下一題、修改同步、只讀投影視窗、擋下（4005、重新整理也進不來、問題拿下）、老師新增、同視窗投影、文字雲（題目、每人 3 詞、合併、隱藏、PNG、下一題、回看舊題）、CSV、列印紀錄、375／400px 無溢出、重新整理保留、後加入的手機收到整批、關閉加入、新的一場、使用中不能刪、關閉教室 4004。2026-11-15 本機全過、無 console 錯誤；上線後設 `QAW_BASE=https://m255525.github.io/classroom-qa-wall/` 對線上版再跑一輪全過。
- **真手機掃 QR、投影機、30 人以上同時送出未實測。**

## 標準配備
跑馬燈（工作區公告 GAS，滑鼠移入暫停）、⚙ 常用設定（收合式＋關於本工具）、首訪警語（學生頁不跳，頁尾有連結）、`manual.html#creator`（改 `tools/manual_body.html` 後跑 `python tools/build_manual.py`）、PWA（`tools/make_icons.py`；上線改版升 `service-worker.js` 的 `CACHE_NAME`）、訪客計數器、列印浮水印。無序號、無 AI。警語強調「匿名是對同學與投影匿名，老師可以擋人、記名時看得到名字」。
