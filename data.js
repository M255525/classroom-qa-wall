/* 課堂提問牆：轉播站訊息編解碼、文字雲斷詞與排版、統計（瀏覽器 window.QAW；node 可 require） */
(function(root){
'use strict';

var MAX_Q = 50;          // 一題最多幾個字
var MAX_WORD = 12;       // 文字雲一個詞最多幾個字
var MAX_LIKES = 6;       // 每人同時最多按幾個讚（受 presence 名稱 24 字限制）
var MAX_ID = 999;        // 一場最多幾題
var PALETTE = ['#FFD166', '#EF476F', '#06D6A0', '#4CC9F0', '#F78C6B', '#B5E48C', '#F4A261', '#C77DFF', '#FFFFFF', '#90E0EF'];

/* 文字雲預設題目（自行撰寫） */
var PROMPTS = [
  '用一個詞形容今天的課',
  '聽到「創業」，你第一個想到什麼？',
  '你最想學會的 AI 工具',
  '今天最有收穫的一件事',
  '還不太懂的地方（一個關鍵字）',
  '你覺得好老闆需要什麼特質？',
  '下次上課想聽什麼主題？',
  '用一個詞形容你現在的心情'
];

/* ---------- 亂數、代碼 ---------- */
var CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function cryptoInt(n){
  try{ var a = new Uint32Array(1); (root.crypto || require('crypto').webcrypto).getRandomValues(a); return a[0] % n; }catch(e){ return Math.floor(Math.random() * n); }
}
function newRoom(){ var s = ''; for(var i = 0; i < 6; i++) s += CODE_ABC[cryptoInt(CODE_ABC.length)]; return s; }
function newGid(){ return 10 + cryptoInt(90); } // 兩位數，每開一場換一次
function pad2(n){ n = Math.max(0, Math.min(99, n | 0)); return (n < 10 ? '0' : '') + n; }
function pad3(n){ n = Math.max(0, Math.min(999, n | 0)); return ('00' + n).slice(-3); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

/* ---------- 文字清理 ---------- */
// 問題：拿掉控制字元與分隔用的 ¦，空白收成一格
function cleanQ(s, n){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069¦]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, n || MAX_Q).join(''); }
function cleanWord(s){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069¦,，、。.!！?？;；:："'「」『』()（）<>]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, MAX_WORD).join(''); }
function cleanWho(s){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f<>|,:¦]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 8).join(''); }
function cleanRoomName(s){ return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>|:¦]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 20).join(''); }
// 文字雲合併用的鍵：全形轉半形、英文小寫、去掉空白（「ChatGPT」「chat gpt」「ＣｈａｔＧＰＴ」算同一個）
function wordKey(s){
  var t = String(s == null ? '' : s);
  try{ t = t.normalize('NFKC'); }catch(e){}
  return t.toLowerCase().replace(/[\s　]+/g, '').replace(/[~～\-－_＿*＊#＃]+$/g, '');
}

/* ---------- 轉播站訊息 ----------
   presence 的 name（≤24 字，會被不雅字詞過濾，所以只用數字＋T/S/|）：
   老師 T|<gid2><模式1：1提問 2文字雲><開放1><旗標1：1可按讚 2記名 4關閉加入><先審核1><每人題數1：0不限><回合2><每人詞數1><聚焦題3><題數3>
   學生 S|<gid2>|<按讚的題號3…>（最多 6 題）
   聊天（≤60 字）：
   老師 R:<教室名稱>
        A<題號3>:<問題>¦<題號3>:<問題>…   上牆的問題（新增、修改、重送都用這個；可以好幾題塞一則）
        X:<題號3><狀態1>,…                 狀態 0 待回答、1 已回答、2 拿下來
        L:<題號3>=<讚數>,…                 目前讚數（最熱門的幾題）
        P<回合2>:<題目>                    文字雲題目
   學生 Q<gid2>:<問題>
        W<gid2><回合2>:<詞>
        N:<名字>                            老師開「記名」時才送
*/
function encT(t){
  return 'T|' + pad2(t.gid) + (t.mode === 'cloud' ? 2 : 1) + (t.open ? 1 : 0) + ((t.likes ? 1 : 0) + (t.named ? 2 : 0) + (t.locked ? 4 : 0)) + (t.review ? 1 : 0) +
    clamp(t.qlimit | 0, 0, 9) + pad2(t.round || 0) + clamp(t.wmax | 0, 1, 9) + pad3(t.spot || 0) + pad3(t.total || 0);
}
function decT(s){
  var m = /^T\|(\d\d)([12])([01])([0-7])([01])(\d)(\d\d)([1-9])(\d{3})(\d{3})$/.exec(String(s || ''));
  if(!m) return null;
  var f = +m[4];
  return {gid:+m[1], mode:m[2] === '2' ? 'cloud' : 'qa', open:m[3] === '1', likes:!!(f & 1), named:!!(f & 2), locked:!!(f & 4), review:m[5] === '1', qlimit:+m[6], round:+m[7], wmax:+m[8], spot:+m[9], total:+m[10]};
}
function encS(gid, likes){
  var ids = (likes || []).filter(function(x){ return x >= 1 && x <= MAX_ID; }).slice(0, MAX_LIKES);
  return 'S|' + pad2(gid) + '|' + ids.map(pad3).join('');
}
function decS(s){
  var m = /^S\|(\d\d)\|((?:\d{3}){0,6})$/.exec(String(s || ''));
  if(!m) return null;
  var ids = [], seen = {};
  for(var i = 0; i < m[2].length; i += 3){ var id = +m[2].slice(i, i + 3); if(id >= 1 && !seen[id]){ seen[id] = 1; ids.push(id); } }
  return {gid:+m[1], likes:ids};
}
function encRoomName(name){ return 'R:' + (cleanRoomName(name) || '教室'); }
function decRoomName(s){ var m = /^R:(.{1,20})$/.exec(String(s || '')); return m ? m[1] : null; }
function encWho(who){ return 'N:' + cleanWho(who); }
function decWho(s){ var m = /^N:(.{1,8})$/.exec(String(s || '')); return m ? m[1] : null; }
function encQ(gid, text){ return 'Q' + pad2(gid) + ':' + cleanQ(text); }
function decQ(s){ var m = /^Q(\d\d):(.+)$/.exec(String(s || '')); if(!m) return null; var t = cleanQ(m[2]); return t ? {gid:+m[1], text:t} : null; }
function encW(gid, round, word){ return 'W' + pad2(gid) + pad2(round) + ':' + cleanWord(word); }
function decW(s){ var m = /^W(\d\d)(\d\d):(.+)$/.exec(String(s || '')); if(!m) return null; var w = cleanWord(m[3]); return w ? {gid:+m[1], round:+m[2], word:w} : null; }
function encPrompt(round, text){ return 'P' + pad2(round) + ':' + cleanQ(text, 54); }
function decPrompt(s){ var m = /^P(\d\d):(.*)$/.exec(String(s || '')); return m ? {round:+m[1], text:m[2]} : null; }
// 好幾題塞進同一則（每則 ≤60 字），太長的自己一則
function encA(list){
  var out = [], cur = '';
  list.forEach(function(q){
    var piece = pad3(q.id) + ':' + cleanQ(q.text);
    if(!cur){ cur = 'A' + piece; return; }
    if(cur.length + 1 + piece.length <= 60) cur += '¦' + piece; else { out.push(cur); cur = 'A' + piece; }
  });
  if(cur) out.push(cur);
  return out;
}
function decA(s){
  s = String(s || '');
  if(!/^A\d{3}:/.test(s)) return null;
  var out = [];
  s.slice(1).split('¦').forEach(function(p){ var m = /^(\d{3}):(.+)$/.exec(p); if(m && +m[1] >= 1) out.push({id:+m[1], text:m[2]}); });
  return out.length ? out : null;
}
function packList(head, items, w){
  var out = [], cur = [];
  items.forEach(function(it){ if(cur.length && head.length + (cur.length + 1) * (w + 1) - 1 > 60){ out.push(head + cur.join(',')); cur = []; } cur.push(it); });
  if(cur.length) out.push(head + cur.join(','));
  return out;
}
var ST = {open:0, done:1, hidden:2};
function encX(list){ return packList('X:', list.map(function(x){ return pad3(x.id) + (ST[x.st] != null ? ST[x.st] : 0); }), 4); }
function decX(s){
  var m = /^X:((?:\d{4})(?:,\d{4})*)$/.exec(String(s || '')); if(!m) return null;
  return m[1].split(',').map(function(p){ return {id:+p.slice(0, 3), st:['open', 'done', 'hidden'][+p[3]] || 'open'}; }).filter(function(x){ return x.id >= 1; });
}
function encL(list){
  var items = list.map(function(x){ return pad3(x.id) + '=' + clamp(x.n | 0, 0, 999); }), out = [], cur = [];
  items.forEach(function(it){ var t = 'L:' + cur.concat([it]).join(','); if(t.length > 60 && cur.length){ out.push('L:' + cur.join(',')); cur = [it]; } else cur.push(it); });
  if(cur.length) out.push('L:' + cur.join(','));
  return out;
}
function decL(s){
  var m = /^L:(\d{3}=\d{1,3}(?:,\d{3}=\d{1,3})*)$/.exec(String(s || '')); if(!m) return null;
  return m[1].split(',').map(function(p){ var a = p.split('='); return {id:+a[0], n:+a[1]}; });
}

/* ---------- 提問牆統計 ---------- */
// 每題的讚數：依每位學生目前按讚的題號（只算待回答的；已回答的用當時記下來的數字）
function likeCounts(qs, likes){
  var n = {};
  Object.keys(likes || {}).forEach(function(sid){ (likes[sid] || []).forEach(function(id){ n[id] = (n[id] || 0) + 1; }); });
  var out = {};
  Object.keys(qs || {}).forEach(function(id){ var q = qs[id]; out[id] = q.st === 'done' && q.final != null ? q.final : (n[id] || 0); });
  return out;
}
// 排序：hot＝讚數多的在前（同讚數較早的在前），new＝最新在前
function sortQs(list, counts, how){
  return list.slice().sort(function(a, b){
    if(how === 'new') return b.at - a.at || b.id - a.id;
    var d = (counts[b.id] || 0) - (counts[a.id] || 0);
    return d || a.at - b.at || a.id - b.id;
  });
}
// 同一個人重複送一樣的問題就不收
function dupQ(qs, sid, text){
  var k = wordKey(text);
  return Object.keys(qs).some(function(id){ var q = qs[id]; return q.sid === sid && wordKey(q.text) === k; });
}

/* ---------- 文字雲 ---------- */
// words: {sid: [詞,…]}；hidden: {key:1}；merge: {key: 併入的key}
function tally(words, hidden, merge){
  var map = {};
  hidden = hidden || {}; merge = merge || {};
  Object.keys(words || {}).forEach(function(sid){
    var seen = {};
    (words[sid] || []).forEach(function(w){
      var k = wordKey(w), guard = 0;
      while(merge[k] && guard++ < 20) k = merge[k];
      if(!k || hidden[k] || seen[k]) return;   // 同一個人同一個詞只算一次
      seen[k] = 1;
      var e = map[k] = map[k] || {key:k, n:0, forms:{}};
      e.n++; e.forms[w] = (e.forms[w] || 0) + 1;
    });
  });
  return Object.keys(map).map(function(k){
    var e = map[k], best = Object.keys(e.forms).sort(function(a, b){ return e.forms[b] - e.forms[a] || a.length - b.length || (a < b ? -1 : 1); })[0];
    return {key:k, text:best, n:e.n, forms:Object.keys(e.forms).length};
  }).sort(function(a, b){ return b.n - a.n || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0); });
}
// 排版：阿基米德螺線由中心往外找空位，不重疊、不超出邊界。measure(text, px) → 文字寬度（px）
function layoutCloud(items, W, H, measure, opt){
  opt = opt || {};
  var maxN = items.length ? items[0].n : 1, minN = items.length ? items[items.length - 1].n : 1;
  var big = opt.big || Math.min(W / 5, H / 3.2, 200), small = opt.small || Math.max(14, big / (items.length <= 8 ? 2.6 : items.length <= 25 ? 4 : 5.5));
  var placed = [], pad = opt.pad == null ? 4 : opt.pad, out = [];
  function hit(r){ for(var i = 0; i < placed.length; i++){ var p = placed[i]; if(r.x < p.x + p.w + pad && r.x + r.w + pad > p.x && r.y < p.y + p.h + pad && r.y + r.h + pad > p.y) return true; } return false; }
  items.slice(0, opt.max || 120).forEach(function(it, idx){
    var f = maxN === minN ? (items.length === 1 ? 1 : .55) : Math.sqrt((it.n - minN) / (maxN - minN));
    var size = small + (big - small) * f;
    for(var tryN = 0; tryN < 4; tryN++){
      var w = measure(it.text, size), h = size * 1.12;
      if(w > W - 8){ size *= (W - 8) / w * .98; continue; }
      var found = null, step = 0, a = idx * 2.39996, ratio = W / H;
      for(step = 0; step < 2600; step++){
        var t = step * .32, r = 1.6 * t;
        var cx = W / 2 + Math.cos(t + a) * r * Math.max(1, ratio * .8), cy = H / 2 + Math.sin(t + a) * r;
        var rect = {x:cx - w / 2, y:cy - h / 2, w:w, h:h};
        if(rect.x < 4 || rect.y < 4 || rect.x + w > W - 4 || rect.y + h > H - 4){ if(r > Math.max(W, H)) break; continue; }
        if(!hit(rect)){ found = rect; break; }
      }
      if(found){ placed.push(found); out.push({key:it.key, text:it.text, n:it.n, size:size, x:found.x, y:found.y, w:found.w, h:found.h, color:PALETTE[idx % PALETTE.length]}); return; }
      size *= .8;
      if(size < 10) return;
    }
  });
  return out;
}

/* ---------- 時間 ---------- */
function ago(ms){
  var s = Math.max(0, Math.round(ms / 1000));
  if(s < 50) return '剛剛';
  if(s < 3600) return Math.round(s / 60) + ' 分鐘前';
  if(s < 86400) return Math.round(s / 3600) + ' 小時前';
  return Math.round(s / 86400) + ' 天前';
}
function hhmm(t){ var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

var API = {
  MAX_Q:MAX_Q, MAX_WORD:MAX_WORD, MAX_LIKES:MAX_LIKES, MAX_ID:MAX_ID, PALETTE:PALETTE, PROMPTS:PROMPTS,
  cryptoInt:cryptoInt, newRoom:newRoom, newGid:newGid, pad2:pad2, pad3:pad3, clamp:clamp,
  cleanQ:cleanQ, cleanWord:cleanWord, cleanWho:cleanWho, cleanRoomName:cleanRoomName, wordKey:wordKey,
  encT:encT, decT:decT, encS:encS, decS:decS, encRoomName:encRoomName, decRoomName:decRoomName, encWho:encWho, decWho:decWho,
  encQ:encQ, decQ:decQ, encW:encW, decW:decW, encPrompt:encPrompt, decPrompt:decPrompt, encA:encA, decA:decA, encX:encX, decX:decX, encL:encL, decL:decL,
  likeCounts:likeCounts, sortQs:sortQs, dupQ:dupQ, tally:tally, layoutCloud:layoutCloud, ago:ago, hhmm:hhmm
};
if(typeof module !== 'undefined' && module.exports) module.exports = API; else root.QAW = API;
})(typeof window !== 'undefined' ? window : globalThis);
