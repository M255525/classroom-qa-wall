// 引擎測試：node tools/test_engine.mjs
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const P = require(path.join(here, '..', 'data.js'));

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; if (fail < 30) console.log('FAIL', msg); } };

// 轉播站的不雅字詞過濾（有工作區時用 Worker 同一份）
const bwPath = path.join(here, '..', '..', '..', '互動遊戲', 'startup-island', 'presence-worker', 'badwords.js');
let hasBad = null, maskBad = null;
if (existsSync(bwPath)) { const m = await import(pathToFileURL(bwPath).href); hasBad = m.hasBadWord; maskBad = m.maskBadWords; }
const BAD = /[a-ru-z]/;   // 狀態碼只允許 T、S、|、數字
const safe = (s, what) => { ok(s.length <= 24, what + ' 太長 ' + s); ok(!BAD.test(s.toLowerCase().replace(/^[ts]\|/, '')), what + ' 含字母 ' + s); if (hasBad) ok(!hasBad(s), what + ' 被過濾 ' + s); };
const chatOk = (s, what) => { ok(Array.from(s).length <= 60, what + ' 超過 60 字 ' + s); };

// 1. 老師狀態：所有欄位組合
let nT = 0;
for (const mode of ['qa', 'cloud']) for (const open of [0, 1]) for (let f = 0; f < 8; f++) for (const review of [0, 1]) for (const qlimit of [0, 1, 3, 5, 9])
  for (const round of [0, 1, 7, 42, 99]) for (const wmax of [1, 3, 5]) for (const spot of [0, 1, 123, 999]) for (const total of [0, 5, 999]) {
    const t = { gid: 10 + (nT % 90), mode, open: !!open, likes: !!(f & 1), named: !!(f & 2), locked: !!(f & 4), review: !!review, qlimit, round, wmax, spot, total };
    const s = P.encT(t); safe(s, 'T'); const d = P.decT(s); nT++;
    ok(d && Object.keys(t).every(k => d[k] === t[k]), 'T 還原 ' + s + ' ' + JSON.stringify(d));
  }
// 2. 學生狀態：按讚 0～6 題、題號 1～999（隨機＋邊界）
for (let gid = 10; gid < 100; gid++) {
  for (let k = 0; k <= 6; k++) for (let r = 0; r < 60; r++) {
    const ids = []; const edge = [1, 999, 2, 998, 500, 10, 100];
    while (ids.length < k) { const v = r === 0 ? edge[ids.length] : 1 + P.cryptoInt(999); if (!ids.includes(v)) ids.push(v); }
    const s = P.encS(gid, ids); safe(s, 'S');
    const d = P.decS(s); ok(d && d.gid === gid && d.likes.join() === ids.join(), 'S 還原 ' + s);
  }
}
ok(P.decS(P.encS(20, [1, 2, 3, 4, 5, 6, 7, 8])).likes.length === P.MAX_LIKES, '超過 6 個讚只送 6 個');
ok(P.decS('S|20|000') && P.decS('S|20|000').likes.length === 0, '題號 0 不算');
ok(P.decS('S|20|001001').likes.length === 1, '重複題號只算一次');
ok(P.decS('S|20|12') === null && P.decT('T|abc') === null, '格式不對回 null');

// 3. 聊天訊息
const samples = ['為什麼損益兩平點要用邊際貢獻？', 'a'.repeat(80), '有 | 跟 ¦ 跟 , 的問題', '  空白   很多  ', 'emoji 😀😀😀 也可以嗎？', '短'];
samples.forEach(t => {
  const q = P.encQ(42, t); chatOk(q, 'Q'); const d = P.decQ(q);
  ok(d && d.gid === 42 && d.text === P.cleanQ(t) && !d.text.includes('¦') && Array.from(d.text).length <= P.MAX_Q, 'Q 還原 ' + t);
});
ok(P.decQ('Q42:   ') === null, '空白問題不收');
for (let n = 1; n <= 40; n++) {
  const list = Array.from({ length: n }, (_, i) => ({ id: i * 25 + 1, text: samples[i % samples.length] + (i % 3 ? '' : '再多一點字讓它變長一些') }));
  const msgs = P.encA(list); msgs.forEach(m => chatOk(m, 'A'));
  const back = msgs.flatMap(m => P.decA(m));
  ok(back.length === n && back.every((x, i) => x.id === list[i].id && x.text === P.cleanQ(list[i].text)), 'A 打包還原 n=' + n);
}
const xs = Array.from({ length: 37 }, (_, i) => ({ id: i * 27 + 1, st: ['open', 'done', 'hidden'][i % 3] }));
const xm = P.encX(xs); xm.forEach(m => chatOk(m, 'X'));
ok(xm.flatMap(m => P.decX(m)).map(x => x.id + x.st).join() === xs.map(x => x.id + x.st).join(), 'X 還原');
const ls = Array.from({ length: 16 }, (_, i) => ({ id: 999 - i * 13, n: [0, 1, 9, 10, 99, 100, 999][i % 7] }));
const lm = P.encL(ls); lm.forEach(m => chatOk(m, 'L'));
ok(lm.flatMap(m => P.decL(m)).map(x => x.id + '=' + x.n).join() === ls.map(x => x.id + '=' + x.n).join(), 'L 還原');
ok(P.decW(P.encW(42, 7, '  ChatGPT！ ')).word === 'ChatGPT' && P.decW(P.encW(42, 7, '一個很長很長很長很長很長的詞彙')).word.length === P.MAX_WORD, 'W 清理與長度');
ok(P.decPrompt(P.encPrompt(3, '用一個詞形容今天的課')).text === '用一個詞形容今天的課', 'P 還原');
P.PROMPTS.forEach(p => { chatOk(P.encPrompt(99, p), '預設題目'); ok(P.decPrompt(P.encPrompt(99, p)).text === p, '預設題目不被截斷 ' + p); });
ok(P.decRoomName(P.encRoomName('三年二班')) === '三年二班' && P.decWho(P.encWho('A1234567890')) === 'A1234567', 'R、N');
// 轉播站遮字後，¦ 分隔仍能還原
if (maskBad) {
  const m = maskBad(P.encA([{ id: 1, text: '這題很白痴嗎' }, { id: 2, text: '正常問題' }])[0]);
  const d = P.decA(m); ok(d && d.length === 2 && d[1].text === '正常問題', '遮字後仍可拆開 ' + m);
}

// 4. 讚數與排序
const qs = { 1: { id: 1, st: 'open', at: 100 }, 2: { id: 2, st: 'open', at: 200 }, 3: { id: 3, st: 'done', at: 50, final: 7 }, 4: { id: 4, st: 'hidden', at: 10 } };
const likes = { a: [1, 2], b: [2], c: [2, 3], d: [4] };
const c = P.likeCounts(qs, likes);
ok(c[1] === 1 && c[2] === 3 && c[3] === 7 && c[4] === 1, '讚數 ' + JSON.stringify(c));
const list = Object.values(qs);
ok(P.sortQs(list, c, 'hot').map(q => q.id).join() === '3,2,4,1', '熱門排序（同讚數較早的在前）');
ok(P.sortQs(list, c, 'new').map(q => q.id).join() === '2,1,3,4', '最新排序');
ok(P.sortQs([{ id: 5, at: 300 }, { id: 6, at: 100 }], {}, 'hot').map(q => q.id).join() === '6,5', '同讚數較早的在前');
ok(P.dupQ({ 1: { sid: 'x', text: 'ChatGPT 是什麼' } }, 'x', 'chatgpt是什麼') && !P.dupQ({ 1: { sid: 'x', text: 'A' } }, 'y', 'A'), '重複問題');

// 5. 文字雲統計
ok(P.wordKey('ＣｈａｔＧＰＴ') === P.wordKey('chat gpt') && P.wordKey('實用～') === '實用', 'wordKey 正規化');
const words = { a: ['實用', '有趣'], b: ['實用', 'ChatGPT'], c: ['chatgpt', '實用', '實用'], d: ['好玩'], e: ['有趣'] };
let t = P.tally(words, {}, {});
ok(t[0].text === '實用' && t[0].n === 3, '最多人：實用 3（同一人重複只算一次）');
ok(t.find(x => x.key === 'chatgpt').n === 2, 'ChatGPT 大小寫合併');
t = P.tally(words, { '實用': 1 }, { '好玩': '有趣' });
ok(!t.find(x => x.key === '實用') && t.find(x => x.key === '有趣').n === 3, '隱藏與合併');
ok(P.tally({ a: ['A', 'B'] }, {}, { a: 'b', b: 'a' }).length >= 1, '循環合併不會當掉');

// 6. 排版：不重疊、不超出邊界、最大的詞在最前面
const measure = (txt, px) => Array.from(txt).length * px * 0.95;
for (const [W, H] of [[1600, 790], [900, 450], [340, 240], [1200, 600]]) for (const n of [1, 5, 30, 80]) {
  const items = Array.from({ length: n }, (_, i) => ({ key: 'k' + i, text: ['實用', '有趣', 'ChatGPT', '很燒腦', '收穫滿滿', '想再上一次', 'AI'][i % 7] + (i >= 7 ? i : ''), n: Math.max(1, n - i) }));
  const lay = P.layoutCloud(items, W, H, measure);
  ok(lay.length >= Math.min(n, 5), `至少排進前幾個 ${W}x${H} n=${n} → ${lay.length}`);
  ok(lay.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H), `不超出邊界 ${W}x${H} n=${n}`);
  let overlap = 0; for (let i = 0; i < lay.length; i++) for (let j = i + 1; j < lay.length; j++) { const a = lay[i], b = lay[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlap++; }
  ok(overlap === 0, `不重疊 ${W}x${H} n=${n}`);
  ok(lay[0].key === 'k0' && lay.every(r => r.size <= lay[0].size + 1e-9), '最多人的字最大');
}

// 7. 時間
ok(P.ago(5000) === '剛剛' && P.ago(5 * 60000) === '5 分鐘前' && P.ago(2 * 3600000) === '2 小時前', 'ago');

console.log(`T 組合 ${nT}，通過 ${pass}，失敗 ${fail}` + (hasBad ? '（含不雅字詞過濾檢查）' : '（找不到 badwords.js，略過過濾檢查）'));
process.exit(fail ? 1 : 0);
