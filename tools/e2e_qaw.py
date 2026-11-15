# 端對端：老師主持台＋投影視窗＋學生手機（各自獨立的瀏覽器 context），連正式轉播站的隨機 ASK 房間
# 用法：python tools/e2e_qaw.py <截圖資料夾>（需先開 http://127.0.0.1:8885；可設 QAW_BASE 測線上版）
import sys, io, os, csv
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = os.environ.get('QAW_BASE', 'http://127.0.0.1:8885/')
errs, fails = [], []
def check(c, msg):
    print(('ok   ' if c else 'FAIL ') + msg)
    if not c: fails.append(msg)
def stub(pg, tag):
    pg.route('**/script.google.com/**', lambda r: r.fulfill(status=200, body='{"marquee":["測試公告：跑馬燈正常"]}', headers={'content-type': 'application/json'}))
    pg.route('**/visitor-badge.laobi.icu/**', lambda r: r.fulfill(status=200, body='', headers={'content-type': 'image/svg+xml'}))
    pg.on('pageerror', lambda e: errs.append(tag + ': ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append(tag + ': ' + m.text))
def waitf(pg, js, msg, timeout=25000):
    try:
        pg.wait_for_function(js, timeout=timeout); check(True, msg)
    except Exception:
        check(False, msg + '（逾時）')
def shot(pg, name, full=False): pg.screenshot(path=os.path.join(OUT, name), full_page=full)
def qid(t, text): return t.evaluate("(x => { const q = Object.values(_qaw.G.qs).find(q => q.text.includes(x)); return q ? q.id : 0; })(%r)" % text)

with sync_playwright() as p:
    b = p.chromium.launch()
    tc = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    t = tc.new_page(); stub(t, 'T')
    t.goto(BASE); t.wait_for_timeout(600)
    check(t.is_visible('#modal.show'), '首訪跳出警語')
    shot(t, '01_warn.png')
    t.click('#modal .btn'); shot(t, '02_home.png', True)
    check('還沒有教室' in t.inner_text('#app'), '首頁有教室清單（空）')
    t.click('[data-act=newCls]'); t.fill('#clsName', '三年二班'); t.click('[data-act=newClsYes]'); t.wait_for_timeout(300)
    check('?c=' in t.url and t.evaluate('!!_qaw.G'), '新增教室後進入主持台')
    cid = t.evaluate('_qaw.G.cid')
    waitf(t, '_qaw.NET.status === "on"', '老師連上轉播站')
    code = t.evaluate('_qaw.NET.code'); print('room', code)

    studs = []
    for i in range(3):
        c = b.new_context(viewport={'width': 375, 'height': 760}, has_touch=True, is_mobile=True)
        s = c.new_page(); stub(s, 'S%d' % (i + 1))
        s.goto(BASE + '?join=' + code); studs.append(s)
    for i, s in enumerate(studs):
        waitf(s, '_qaw.S.T && _qaw.S.T.mode === "qa"', '手機 %d 收到老師狀態' % (i + 1))
    waitf(studs[0], 'document.querySelector(".roomline") && document.querySelector(".roomline").textContent.includes("三年二班")', '手機看到教室名稱')
    check(not studs[0].is_visible('#modal.show'), '學生頁不跳警語')
    shot(studs[0], '10_stu_join.png', True)

    # 提問（含不雅字詞）
    studs[0].fill('#askIn', '損益兩平點要怎麼算比較快？'); studs[0].click('[data-act=ask]')
    studs[1].fill('#askIn', '鳳凰貸款一定要有公司嗎'); studs[1].click('[data-act=ask]')
    studs[2].fill('#askIn', '這題很白痴嗎'); studs[2].click('[data-act=ask]')
    check('已送出' in studs[0].inner_text('#app'), '手機顯示已送出')
    waitf(t, 'Object.keys(_qaw.G.qs).length === 3', '老師收到 3 題')
    masked = t.evaluate("Object.values(_qaw.G.qs).some(q => q.text.includes('*') && !q.text.includes('白痴'))")
    check(masked, '不雅字詞被轉播站遮成 *')
    for i, s in enumerate(studs):
        waitf(s, 'Object.values(_qaw.S.wall).filter(q => q.text).length === 3', '手機 %d 牆上有 3 題' % (i + 1))
    q1, q2, q3 = qid(t, '損益兩平'), qid(t, '鳳凰貸款'), qid(t, '這題很')
    waitf(studs[0], 'document.body.innerText.includes("你問的")', '自己的問題標「你問的」')
    waitf(studs[2], 'document.body.innerText.includes("你問的")', '被遮字的問題也認得出是自己問的')

    # 按讚
    studs[0].click('[data-like="%d"]' % q2)
    studs[2].click('[data-like="%d"]' % q2); studs[2].click('[data-like="%d"]' % q1)
    waitf(t, '(() => { const c = _qaw.P.likeCounts(_qaw.G.qs, _qaw.G.likes); return c[%d] === 2 && c[%d] === 1; })()' % (q2, q1), '老師讚數：鳳凰 2、損益 1')
    t.wait_for_timeout(300)
    first = t.inner_text('#qlist .qc .qt')
    check('鳳凰貸款' in first, '最熱門排第一：' + first)
    waitf(studs[1], '_qaw.S.counts[%d] === 2' % q2, '手機收到讚數', 20000)
    studs[0].click('[data-like="%d"]' % q2)
    waitf(t, '_qaw.P.likeCounts(_qaw.G.qs, _qaw.G.likes)[%d] === 1' % q2, '收回讚，老師讚數跟著減')
    shot(t, '11_desk_qa.png', True); shot(studs[1], '12_stu_wall.png', True)

    # 每人題數
    t.click('[data-cfg=qlimit][data-v="1"]')
    waitf(studs[0], '_qaw.S.T.qlimit === 1', '手機收到每人 1 題')
    studs[0].wait_for_timeout(200)
    check('已經問了' in studs[0].inner_text('#app') and not studs[0].is_visible('#askIn'), '題數用完不能再問')

    # 先審核
    t.click('[data-cfg=qlimit][data-v="0"]'); t.click('[data-cfg=review][data-v=true]')
    waitf(studs[1], '_qaw.S.T.review && _qaw.S.T.qlimit === 0', '手機收到先審核')
    studs[1].fill('#askIn', '剛剛那個例子可以再講一次嗎'); studs[1].click('[data-act=ask]')
    waitf(t, 'Object.values(_qaw.G.qs).some(q => q.st === "pending")', '新問題進待審核')
    qp = qid(t, '剛剛那個例子')
    waitf(studs[1], 'document.body.innerText.includes("等老師審核")', '提問者看到等老師審核')
    t.wait_for_timeout(3500)
    check(not studs[0].evaluate('!!_qaw.S.wall[%d]' % qp), '待審核的問題不會傳到其他手機')
    t.click('[data-act=ftab][data-v=pending]'); shot(t, '13_pending.png', True)
    t.click('[data-act=approve][data-id="%d"]' % qp)
    waitf(studs[0], '!!(_qaw.S.wall[%d] && _qaw.S.wall[%d].text)' % (qp, qp), '上牆後手機收到')
    t.click('[data-act=ftab][data-v=open]')

    # 聚焦、回答完換下一題
    t.click('[data-act=spot][data-id="%d"]' % q2)
    waitf(studs[0], '_qaw.S.T.spot === %d' % q2, '手機收到聚焦')
    waitf(studs[0], 'document.body.innerText.includes("老師正在回答")', '手機顯示老師正在回答')
    t.click('.spotbar [data-act=nextHot]')
    t.wait_for_timeout(300)
    check(t.evaluate('_qaw.G.qs[%d].st' % q2) == 'done' and t.evaluate('_qaw.G.spot') not in (0, q2), '回答完自動換下一題')
    waitf(studs[1], '_qaw.S.wall[%d].st === "done"' % q2, '手機收到已回答')

    # 修改
    t.click('[data-act=editQ][data-id="%d"]' % q1); t.fill('#editIn', '損益兩平點要怎麼算比較快？（附公式）'); t.click('[data-act=editQYes]')
    waitf(studs[2], '_qaw.S.wall[%d].text.includes("附公式")' % q1, '修改後手機同步')

    # 投影視窗（另一個分頁，只讀）
    pj = tc.new_page(); stub(pj, 'PROJ')
    pj.goto(BASE + '?c=' + cid + '&proj=1'); pj.wait_for_timeout(1200)
    txt = pj.inner_text('#app')
    check('掃描就能匿名提問' in txt and code in txt, '投影視窗顯示標題與代碼')
    check(pj.locator('.qa').count() == 0 and pj.locator('.pending').count() == 0, '投影沒有操作按鈕與待審核')
    check(t.evaluate('!!_qaw.G') and not t.is_visible('#modal.show'), '投影視窗沒有搶走主持台')
    t.click('[data-act=unspot]'); t.wait_for_timeout(900)
    check(pj.locator('.pgrid .qc').count() >= 2, '投影視窗跟著更新成問題牆')
    shot(pj, '14_proj_window.png')

    # 擋下洗版的人
    t.click('[data-act=block][data-id="%d"]' % q3); t.click('[data-act=blockYes]')
    waitf(studs[2], '_qaw.S.closed === 4005', '被擋下的手機離開教室')
    check(t.evaluate('_qaw.G.qs[%d].st' % q3) == 'hidden', '他的問題被拿下來')
    waitf(studs[0], '_qaw.S.wall[%d].st === "hidden"' % q3, '其他手機上也拿掉')
    studs[2].reload(); studs[2].wait_for_timeout(2500)
    check(studs[2].evaluate('_qaw.S.closed') == 4005, '被擋下的重新整理也進不來')

    # 老師新增
    t.click('[data-act=addQ]'); t.fill('#newQ', '期末報告可以兩人一組嗎'); t.click('[data-act=addQYes]')
    waitf(studs[1], 'Object.values(_qaw.S.wall).some(q => q.text.includes("兩人一組"))', '老師新增的問題直接上牆')

    # 投影畫面（同一個視窗）
    t.click('[data-act=proj]'); t.click('[data-act=projHere]'); t.wait_for_timeout(600)
    check(t.is_visible('.projv') and t.locator('.projv .qa').count() == 0, '同視窗投影畫面')
    shot(t, '15_proj.png')
    t.keyboard.press('Escape'); t.wait_for_timeout(300)
    check(not t.is_visible('.projv'), 'Esc 回主持台')

    # 文字雲
    t.click('[data-act=mode][data-v=cloud]')
    waitf(studs[0], '_qaw.S.T.mode === "cloud"', '手機切到文字雲')
    t.fill('#pIn', '用一個詞形容今天的課'); t.click('[data-act=publishPrompt]')
    waitf(studs[0], '_qaw.S.prompt.text === "用一個詞形容今天的課"', '手機收到題目')
    for w in ['實用', '有趣']:
        studs[0].fill('#wordIn', w); studs[0].click('[data-act=sendWord]')
    for w in ['實用', 'ChatGPT', '好玩']:
        studs[1].fill('#wordIn', w); studs[1].click('[data-act=sendWord]')
    check('送出了 3 個詞' in studs[1].inner_text('#app'), '每人 3 個詞用完')
    waitf(t, '(() => { const r = _qaw.G.rounds[_qaw.G.round]; return Object.values(r.words).flat().length === 5; })()', '老師收到 5 個詞', 30000)
    t.wait_for_timeout(400)
    top = t.evaluate('_qaw.P.tally(_qaw.G.rounds[_qaw.G.round].words, {}, {})[0]')
    check(top['text'] == '實用' and top['n'] == 2, '最多人：實用 2')
    check(t.evaluate('(document.getElementById("cloudCv")._lay || []).length') == 4, '文字雲畫出 4 個詞')
    shot(t, '16_cloud.png', True); shot(studs[1], '17_stu_cloud.png', True)
    t.click('#wlist [data-k="好玩"]'); t.select_option('#mergeTo', '有趣'); t.click('[data-act=wordMerge]')
    check(t.evaluate('_qaw.P.tally(_qaw.G.rounds[_qaw.G.round].words, {}, _qaw.G.rounds[_qaw.G.round].merge).find(x => x.key === "有趣").n') == 2, '合併「好玩」到「有趣」')
    t.click('#wlist [data-k="chatgpt"]'); t.click('[data-act=wordHide]')
    check(t.evaluate('(document.getElementById("cloudCv")._lay || []).length') == 2, '隱藏後剩 2 個詞')
    with t.expect_download() as d: t.click('[data-act=pngCloud]')
    pth = os.path.join(OUT, 'cloud.png'); d.value.save_as(pth)
    check(os.path.getsize(pth) > 5000, '下載文字雲 PNG %d bytes' % os.path.getsize(pth))
    t.click('[data-act=nextRound]'); t.wait_for_timeout(200)
    check(t.evaluate('_qaw.G.round') == 2 and t.locator('.rounds button').count() == 2, '下一題，舊題目留在清單')
    waitf(studs[0], '_qaw.S.T.round === 2', '手機進入第 2 題')
    check(studs[0].is_visible('#wordIn'), '新題目又可以送詞')
    t.click('.rounds [data-r="1"]'); t.wait_for_timeout(200)
    check('之前的題目' in t.inner_text('.panel'), '可以回頭看第 1 題')

    # 下載與列印
    with t.expect_download() as d: t.click('[data-act=csvQ]')
    pth = os.path.join(OUT, 'q.csv'); d.value.save_as(pth)
    rows = list(csv.reader(open(pth, encoding='utf-8-sig')))
    check(rows[0][0] == '編號' and len(rows) == 6, '問題 CSV %d 列' % len(rows))
    with t.expect_download() as d: t.click('[data-act=csvW]')
    pth = os.path.join(OUT, 'w.csv'); d.value.save_as(pth)
    check(any(r[2] == '實用' and r[3] == '2' for r in csv.reader(open(pth, encoding='utf-8-sig'))), '文字雲 CSV')
    t.evaluate('window.print = () => {}')
    t.click('[data-act=printRec]'); t.wait_for_timeout(400)
    check(t.locator('#printArea .psheet').count() == 2 and t.locator('#printArea img.cl').count() == 1, '列印紀錄：問答 1 頁＋文字雲 1 頁')
    t.emulate_media(media='print'); t.pdf(path=os.path.join(OUT, 'record.pdf')); t.emulate_media(media='screen')
    t.evaluate("document.body.classList.remove('print-area')")

    # 版面
    for i, s in enumerate(studs[:2]):
        check(s.evaluate('document.documentElement.scrollWidth') <= 376, '手機 %d 無橫向溢出' % (i + 1))
    t.set_viewport_size({'width': 400, 'height': 800}); t.wait_for_timeout(600)
    check(t.evaluate('document.documentElement.scrollWidth') <= 401, '老師端 400px 無橫向溢出')
    shot(t, '18_desk_400.png', True)
    t.set_viewport_size({'width': 1366, 'height': 900})

    # 重新整理保留
    t.reload(); t.wait_for_timeout(1500)
    check(t.evaluate('_qaw.G && _qaw.G.cid') == cid and t.evaluate('Object.keys(_qaw.G.qs).length') == 5, '重新整理後仍在同一間教室、資料保留')
    waitf(t, '_qaw.NET.status === "on"', '重新整理後重新連線')

    # 新加入的手機會收到整批問題
    t.click('[data-act=mode][data-v=qa]')
    c4 = b.new_context(viewport={'width': 375, 'height': 760}, is_mobile=True); s4 = c4.new_page(); stub(s4, 'S4')
    s4.goto(BASE + '?join=' + code)
    waitf(s4, 'Object.values(_qaw.S.wall).filter(q => q.text && q.st !== "hidden").length >= 4', '後來加入的手機收到所有上牆問題', 40000)

    # 關閉加入
    t.click('[data-act=lock]'); t.wait_for_timeout(500)
    c5 = b.new_context(viewport={'width': 375, 'height': 760}, is_mobile=True); s5 = c5.new_page(); stub(s5, 'S5')
    s5.goto(BASE + '?join=' + code)
    waitf(s5, '_qaw.S.closed === 4005', '關閉加入時新手機被擋')
    check('已關閉加入' in s5.inner_text('#app'), '被擋的手機看到「已關閉加入」')
    s4.reload(); s4.wait_for_timeout(2500)
    check(s4.evaluate('!_qaw.S.closed'), '已在教室的手機重新整理仍能回來')
    t.click('[data-act=unlock]'); t.wait_for_timeout(500)
    s5.click('[data-act=retry]')
    waitf(s5, '!_qaw.S.closed && _qaw.S.T', '開放後再試一次就能進')

    # 新的一場
    t.click('[data-act=newSession]'); t.click('[data-act=newSessionYes]')
    check(t.evaluate('Object.keys(_qaw.G.qs).length') == 0, '新的一場清空問題')
    waitf(studs[0], 'Object.keys(_qaw.S.wall).length === 0', '手機也清空')

    # 刪除保護、關閉教室
    t.click('[data-act=home]'); t.click('[data-act=delCls][data-id="%s"]' % cid); t.wait_for_timeout(200)
    check('不能刪除' in t.inner_text('#modalBox'), '有學生連線時不能刪除')
    t.click('#modal [data-act=close]'); t.click('[data-act=resume]')
    t.click('[data-act=bigQR]'); t.click('#modal [data-act=netOff]'); t.click('[data-act=guardOk]')
    waitf(studs[0], '_qaw.S.closed === 4004', '關閉教室後手機離線')

    print('console 錯誤：', errs[:8])
    check(not errs, '沒有 console 錯誤')
    b.close()
print('\n失敗 %d 項' % len(fails) + ('：' + '；'.join(fails) if fails else ''))
sys.exit(1 if fails else 0)
