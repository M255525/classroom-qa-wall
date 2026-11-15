/* 課堂提問牆：畫面（老師主持台＋投影畫面＋學生手機端） */
(function(){
'use strict';
var P = window.QAW, $ = function(id){ return document.getElementById(id); };
var QS = new URLSearchParams(location.search);
var JOIN = QS.has('join');
var PROJ = !JOIN && QS.get('proj') === '1';     // 只讀的投影視窗（延伸螢幕用）
var PFX = 'qaw.';
var ONLINE = 'https://m255525.github.io/classroom-qa-wall/';
var PRESENCE = QS.get('presence') || 'wss://startup-island-presence.content-workflow.workers.dev/ws';
var ROOM_PREFIX = 'ASK';
var BADGE = 'https://visitor-badge.laobi.icu/badge?page_id=m255525.classroomqawall';
var FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif';

function lsGet(k){ try{ return localStorage.getItem(PFX + k); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(PFX + k, v); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(PFX + k); }catch(e){} }
function lsJson(k, d){ try{ var v = JSON.parse(lsGet(k)); return v == null ? d : v; }catch(e){ return d; } }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; }); }
function randId(){ var s = ''; while(s.length < 12) s += P.cryptoInt(36).toString(36); return s; }
function csvCell(v){ v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function today(){ var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;

/* ---------- 音效（WebAudio 合成） ---------- */
var AC = null;
function snd(kind){
  if(lsGet('mute') === '1' || PROJ) return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    var notes = {open:[660, 880], close:[880, 523], ok:[784, 1047], tick:[1320], pop:[988, 1319]}[kind] || [440];
    notes.forEach(function(f, i){
      var t = AC.currentTime + i * .1, o = AC.createOscillator(), g = AC.createGain();
      o.type = kind === 'tick' ? 'sine' : 'triangle'; o.frequency.value = f; o.connect(g); g.connect(AC.destination);
      g.gain.setValueAtTime(kind === 'tick' ? .06 : .14, t); g.gain.exponentialRampToValueAtTime(.001, t + .22);
      o.start(t); o.stop(t + .26);
    });
  }catch(e){}
}

/* ---------- 共用：彈窗、提示、下載 ---------- */
function openModal(h, wide){ $('modalBox').innerHTML = h; $('modalBox').className = wide ? 'wide' : ''; $('modal').classList.add('show'); }
function closeModal(){ $('modal').classList.remove('show'); }
function modalOpen(){ return $('modal').classList.contains('show'); }
var toastT;
function toast(s){ var t = document.querySelector('.toast'); if(!t){ t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function(){ t.hidden = true; }, 2800); }
function copyText(s, ok){ var done = function(){ toast(ok || '已複製'); }; if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, function(){ fallbackCopy(s); done(); }); else { fallbackCopy(s); done(); } }
function fallbackCopy(s){ var t = document.createElement('textarea'); t.value = s; document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); }catch(e){} t.remove(); }
function saveBlob(name, blob){
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function downloadCsv(name, text){ saveBlob(name, new Blob(['﻿' + text], {type:'text/csv;charset=utf-8'})); }
function keepFocus(fn){
  var a = document.activeElement, id = a && a.id, sel = null;
  if(id) try{ sel = [a.selectionStart, a.selectionEnd]; }catch(e){}
  fn();
  if(id){ var b = $(id); if(b && b !== a){ b.focus(); if(sel && sel[0] != null) try{ b.setSelectionRange(sel[0], sel[1]); }catch(e){} } }
}
function fileBase(){ return (clsName() + '_').replace(/[\\/:*?"<>|]/g, '') ; }

/* ---------- 連線（老師與學生共用；借用創業島轉播站的教室模式） ---------- */
var NET = {ws:null, want:false, status:'off', code:'', role:JOIN ? 'S' : 'T', myId:randId(), peers:{}, retry:0, ping:0, q:[], qBusy:false, last:null, state:'T|0', tkey:''};
function roomUrl(code){
  var here = location.protocol === 'https:' && location.hostname === 'm255525.github.io';
  return (here ? location.origin + location.pathname : ONLINE) + '?join=' + code;
}
function netStart(code){
  NET.want = true; NET.code = code; NET.retry = 0;
  if(NET.role === 'T'){
    NET.tkey = lsGet('tkey.' + code); if(!NET.tkey){ NET.tkey = randId() + randId(); lsSet('tkey.' + code, NET.tkey); }
  } else { NET.myId = lsGet('sid.' + code) || randId(); lsSet('sid.' + code, NET.myId); }
  netConnect();
}
function netStop(closeRoom){
  var ws0 = NET.ws;
  if(closeRoom && NET.role === 'T' && ws0 && ws0.readyState === 1) try{ ws0.send('{"t":"close"}'); }catch(e){}
  NET.want = false; clearTimeout(NET.rt); clearInterval(NET.ping); NET.ws = null; NET.status = 'off'; NET.peers = {}; NET.q = [];
  if(ws0) try{ ws0.close(); }catch(e){}
  netPaint();
}
function netConnect(){
  if(!NET.want) return;
  var q = 'room=' + ROOM_PREFIX + NET.code + '&cls=1' + (NET.role === 'T' ? '&tkey=' + NET.tkey : ''), ws;
  try{ ws = new WebSocket(PRESENCE + '?' + q); }catch(e){ netRetry(); return; }
  NET.ws = ws; NET.status = 'wait'; netPaint();
  ws.onopen = function(){
    if(NET.ws !== ws) return;
    NET.status = 'on'; NET.retry = 0;
    ws.send(JSON.stringify({t:'hello', id:NET.myId, name:NET.role === 'T' ? NET.state : S.myName(), gx:0, gy:0}));
    clearInterval(NET.ping); NET.ping = setInterval(function(){ if(NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"ping"}'); }, 25000);
    if(NET.role === 'T') syncSoon(600); else S.whoSent = false;
    netPaint(); pump();
  };
  ws.onmessage = function(ev){ if(NET.ws !== ws) return; var m; try{ m = JSON.parse(ev.data); }catch(e){ return; } onNet(m); };
  ws.onclose = function(ev){
    if(NET.ws !== ws) return; NET.status = 'off'; NET.ws = null; clearInterval(NET.ping); NET.qBusy = false;
    var code = ev.code;
    if(NET.role === 'S' && (code === 4004 || code === 4005)){ S.closed = code; NET.want = false; renderStu(); return; }
    if(code === 4001 && NET.role === 'T'){ toast('這個代碼正由另一台電腦當主持人，已改用新代碼'); netStop(); G.room = P.newRoom(); saveG(); netStart(G.room); T.push(); render(); return; }
    if(code === 4002){ NET.myId = randId(); if(NET.role === 'S') lsSet('sid.' + NET.code, NET.myId); }
    netPaint(); netRetry();
  };
  ws.onerror = function(){};
}
function netRetry(){ if(!NET.want) return; NET.retry++; clearTimeout(NET.rt); NET.rt = setTimeout(netConnect, Math.min(30000, 1500 * Math.pow(2, NET.retry - 1))); }
function send(o){ if(NET.ws && NET.ws.readyState === 1){ NET.ws.send(JSON.stringify(o)); return true; } return false; }
function setName(name){ if(NET.state === name) return; NET.state = name; send({t:'look', name:name}); }
// 聊天佇列：轉播站限制同一人兩則至少隔 2.5 秒。tag 相同的舊訊息（還沒送出）會被取代；first＝插隊到最前面
function queueChats(list, tag, first){
  if(tag) NET.q = NET.q.filter(function(x){ return x.tag !== tag; });
  var items = list.map(function(t){ return {t:t, tag:tag}; });
  NET.q = first ? items.concat(NET.q) : NET.q.concat(items);
  pump();
}
function pump(){
  if(NET.qBusy || !NET.q.length || NET.status !== 'on') return;
  var it = NET.q.shift(); NET.last = it;
  if(!send({t:'chat', text:it.t})){ NET.q.unshift(it); return; }
  NET.qBusy = true; setTimeout(function(){ NET.qBusy = false; pump(); }, 2700);
}
function onNet(m){
  if(m.t === 'snapshot'){
    NET.peers = {}; (m.peers || []).forEach(function(p){ NET.peers[p.id] = String(p.name || ''); });
    if(NET.role === 'T'){ Object.keys(NET.peers).forEach(function(id){ T.onPeer(id, NET.peers[id]); }); (m.chat || []).forEach(function(c){ T.onChat(c); }); T.paintSoon(); }
    else { Object.keys(NET.peers).forEach(function(id){ S.onPeer(id, NET.peers[id]); }); (m.chat || []).forEach(function(c){ S.onChat(c); }); renderStu(); }
  } else if(m.t === 'join' && m.peer){ NET.peers[m.peer.id] = String(m.peer.name || ''); if(NET.role === 'T'){ T.onPeer(m.peer.id, m.peer.name); if(!/^T\|/.test(String(m.peer.name || ''))) syncSoon(3500); T.paintSoon(); } else S.onPeer(m.peer.id, m.peer.name); }
  else if(m.t === 'look'){ NET.peers[m.id] = String(m.name || ''); if(NET.role === 'T'){ T.onPeer(m.id, m.name); T.paintSoon(); } else S.onPeer(m.id, m.name); }
  else if(m.t === 'leave'){ delete NET.peers[m.id]; if(NET.role === 'T') T.paintSoon(); }
  else if(m.t === 'chat'){ if(NET.role === 'T') T.onChat(m); else S.onChat(m); }
  else if(m.t === 'chatSlow'){ if(NET.last) NET.q.unshift(NET.last); NET.qBusy = true; setTimeout(function(){ NET.qBusy = false; pump(); }, (m.wait || 1000) + 300); }
  netPaint();
}
function netPaint(){ var el = $('netChip'); if(el) el.innerHTML = netChipHtml(); }
function netChipHtml(){
  var n = NET.role === 'T' ? onlineIds().length : 0;
  var st = NET.status === 'on' ? 'on' : NET.status === 'wait' ? 'wait' : '';
  return '<span class="dot ' + st + '"></span>' + (NET.role === 'T' ? (NET.want ? '📱 ' + esc(NET.code) + '・' + n + ' 人' : '📱 手機連線關閉') : (NET.status === 'on' ? '已連線' : NET.status === 'wait' ? '連線中…' : '未連線'));
}
function onlineIds(){ return Object.keys(NET.peers).filter(function(id){ return id !== NET.myId && !/^T\|/.test(NET.peers[id]); }); }
var qrLib = null;
function loadQR(){
  if(window.QRCode) return Promise.resolve();
  if(!qrLib) qrLib = new Promise(function(ok, no){ var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = ok; s.onerror = function(){ qrLib = null; no(); }; document.head.appendChild(s); });
  return qrLib;
}
function drawQR(id, size, code){ var el = $(id); if(!el) return; loadQR().then(function(){ el = $(id); if(!el) return; el.innerHTML = ''; new window.QRCode(el, {text:roomUrl(code || NET.code), width:size, height:size, colorDark:'#111', colorLight:'#fff', correctLevel:window.QRCode.CorrectLevel.M}); }).catch(function(){ el.innerHTML = '<p class="small">QR code 載入失敗，請用代碼加入</p>'; }); }

/* =====================================================================
   老師端
   ===================================================================== */
var DEF_CFG = {mode:'qa', open:true, review:false, likes:true, named:false, qlimit:3, wmax:3, sort:'hot'};
var G = null, V = {home:true, filter:'open', proj:false, vr:0};
/* ---------- 教室：每間教室有自己的名稱、代碼與資料；一個分頁開一間 ---------- */
var TAB = randId();
function clsList(){ var l = lsJson('rooms', []); return Array.isArray(l) ? l : []; }
function clsSave(l){ lsSet('rooms', JSON.stringify(l)); }
function clsGet(id){ return clsList().filter(function(c){ return c.id === id; })[0] || null; }
function clsName(id){ var c = clsGet(id || (G && G.cid)); return c ? c.name : '教室'; }
function evKey(id){ return 'event.' + id; }
function loadEvent(id){ var g = lsJson(evKey(id), null); return g && g.v === 1 && g.cfg && g.qs ? g : null; }
function newClsId(){ return randId().slice(0, 8); }
function lockOf(id){ return lsJson('lock.' + id, null); }
function lockBusy(id){ var l = lockOf(id); return !!(l && l.tab !== TAB && Date.now() - l.t < 6000); }
function lockTake(id){ lsSet('lock.' + id, JSON.stringify({tab:TAB, t:Date.now()})); }
function lockFree(id){ var l = lockOf(id); if(l && l.tab === TAB) lsDel('lock.' + id); }
function setUrl(id){ try{ history.replaceState(null, '', location.pathname + (id ? '?c=' + id : '')); }catch(e){} }
function enterCls(id, force){
  if(!clsGet(id)){ toast('找不到這間教室'); setUrl(null); render(); return; }
  if(lockBusy(id) && !force){
    openModal('<h2>🏫 「' + esc(clsName(id)) + '」已在另一個分頁開啟</h2><p>同一間教室一次只能在一個分頁操作，請切換到那個分頁。</p><p class="small">如果那個分頁已經關掉或當掉，可以改在這裡開，另一個分頁會自動退出。要投影到另一個螢幕，請用教室裡的「📺 投影畫面 → 在新視窗開」，那個視窗只顯示、不會搶教室。</p><div class="stack"><button class="btn red" data-act="enterForce" data-id="' + esc(id) + '">改在這個分頁開</button><button class="btn alt" data-act="close">取消</button></div>');
    return;
  }
  closeModal();
  if(G && G.cid !== id){ saveG(); lockFree(G.cid); if(NET.want) netStop(); }
  if(!G || G.cid !== id) G = loadEvent(id) || newEvent({}, null, id);
  G.cid = id;
  lockTake(id); V.home = false; V.proj = false; V.vr = 0; setUrl(id); saveG();
  ensureNet(); T.push(); render(); window.scrollTo(0, 0);
}
function leaveCls(closeRoom){ if(!G) return; saveG(); lockFree(G.cid); if(NET.want) netStop(closeRoom); G = null; V.home = true; V.proj = false; setUrl(null); }
function clsInUse(id){
  if(lockBusy(id)) return '這間教室正在另一個分頁使用';
  if(G && G.cid === id && NET.want && onlineIds().length) return '這間教室還有 ' + onlineIds().length + ' 位學生連線中';
  return '';
}
// 管理密碼：只存加鹽雜湊（SHA-256），不存明碼
function hasPin(id){ var c = clsGet(id); return !!(c && c.pin && c.pin.hash); }
function hex(buf){ return Array.from(new Uint8Array(buf)).map(function(b){ return ('0' + b.toString(16)).slice(-2); }).join(''); }
function pinHash(salt, pin){
  var txt = 'qaw|' + salt + '|' + pin;
  if(window.crypto && crypto.subtle && window.TextEncoder) return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(hex);
  var h = 2166136261; for(var i = 0; i < txt.length; i++){ h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return Promise.resolve('f' + h.toString(16));
}
function pinOk(pin){ return /^\d{4,6}$/.test(pin); }
function makePin(pin){ var salt = randId(); return pinHash(salt, pin).then(function(h){ return {salt:salt, hash:h}; }); }
function setPin(id, pinObj){ var l = clsList(); l.forEach(function(c){ if(c.id === id){ if(pinObj) c.pin = pinObj; else delete c.pin; } }); clsSave(l); }
function checkPin(id, pin){
  var c = clsGet(id); if(!c || !c.pin) return Promise.resolve(true);
  if(V.pinUntil && Date.now() < V.pinUntil) return Promise.reject('密碼錯太多次，請 ' + Math.ceil((V.pinUntil - Date.now()) / 1000) + ' 秒後再試');
  return pinHash(c.pin.salt, String(pin || '')).then(function(h){
    if(h === c.pin.hash){ V.pinFail = 0; return true; }
    V.pinFail = (V.pinFail || 0) + 1; if(V.pinFail >= 5){ V.pinFail = 0; V.pinUntil = Date.now() + 60000; }
    return false;
  });
}
function guard(id, o, fn){
  V.guard = {id:id, fn:fn, read:o.read};
  openModal('<h2>' + o.title + '</h2>' + (o.body || '') + (hasPin(id) ? '<label class="fld" style="margin-top:.6rem">🔐 這間教室的管理密碼<input id="pinIn" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="開教室時設定的 4～6 位數字"><small>只有開這間教室的人知道密碼。</small></label>' : '') +
    '<div class="stack"><button class="btn ' + (o.danger ? 'red' : '') + '" data-act="guardOk">' + o.btn + '</button><button class="btn alt" data-act="close">取消</button></div>');
  setTimeout(function(){ var i = $('pinIn') || $('clsName'); if(i) i.focus(); }, 50);
}
function pinFields(withOld){
  return (withOld ? '<label class="fld">目前的密碼<input id="pinOld" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>' : '') +
    '<div class="form" style="margin-top:.4rem"><label class="fld">' + (withOld ? '新密碼' : '管理密碼（選填）') + '<input id="clsPin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="4～6 位數字"></label><label class="fld">再輸入一次<input id="clsPin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label></div>';
}
function readNewPin(){
  var a = String(($('clsPin') || {}).value || '').trim(), b = String(($('clsPin2') || {}).value || '').trim();
  if(!a && !b) return {none:true};
  if(!pinOk(a)) return {err:'管理密碼要 4～6 位數字'};
  if(a !== b) return {err:'兩次輸入的密碼不一樣'};
  return {pin:a};
}
var saveT;
function saveG(){ if(G && G.cid && !PROJ){ G.at = Date.now(); lsSet(evKey(G.cid), JSON.stringify(G)); } }
function saveSoon(){ clearTimeout(saveT); saveT = setTimeout(saveG, 400); }
function newRound(){ return {prompt:'', words:{}, hidden:{}, merge:{}, at:Date.now()}; }
function newEvent(cfg, room, cid){
  var c = Object.assign({}, DEF_CFG, lsJson('cfg', {}), cfg || {});
  c.open = true;
  return {v:1, cid:cid || (G && G.cid) || '', room:room || P.newRoom(), gid:P.newGid(), cfg:c, qs:{}, seq:0, likes:{}, members:{}, spot:0, seen:[],
    round:1, rounds:{'1':newRound()}, closedAt:0, startAt:Date.now(), banned:{}, kicked:{}, allow:{}, locked:false};
}
function saveCfgPref(){ var c = G.cfg; lsSet('cfg', JSON.stringify({mode:c.mode, review:c.review, likes:c.likes, named:c.named, qlimit:c.qlimit, wmax:c.wmax, sort:c.sort})); }
function qArr(){ return Object.keys(G.qs).map(function(k){ return G.qs[k]; }); }
function counts(){ return P.likeCounts(G.qs, G.likes); }
function byState(st){ return qArr().filter(function(q){ return q.st === st; }); }
function curRound(){ return G.rounds[G.round] || (G.rounds[G.round] = newRound()); }
function viewRound(){ var r = V.vr && G.rounds[V.vr] ? V.vr : G.round; return {no:r, r:G.rounds[r]}; }
function accepting(){ return G.cfg.open || Date.now() - G.closedAt < 5000; }
function publicTotal(){ return qArr().filter(function(q){ return q.sent && q.st !== 'hidden' && q.st !== 'pending'; }).length; }

/* ---------- 老師：送給手機的訊息 ---------- */
var syncT, likeT, likeAt = 0;
function syncSoon(ms){ clearTimeout(syncT); syncT = setTimeout(sendSync, ms || 0); }
// 有人加入／重新連上：把教室名稱、題目、上牆問題、狀態、讚數整批重送（轉播站只留最近 20 則）
function sendSync(){
  if(!G || NET.role !== 'T' || !NET.want) return;
  var list = [P.encRoomName(clsName())], r = curRound();
  if(r.prompt) list.push(P.encPrompt(G.round, r.prompt));
  var pub = qArr().filter(function(q){ return q.sent && (q.st === 'open' || q.st === 'done'); }).sort(function(a, b){ return a.id - b.id; });
  list = list.concat(P.encA(pub));
  var done = pub.filter(function(q){ return q.st === 'done'; });
  if(done.length) list = list.concat(P.encX(done));
  list = list.concat(likeMsgs());
  queueChats(list, 'sync');
}
function likeMsgs(){
  var c = counts(), top = byState('open').filter(function(q){ return c[q.id] > 0; }).sort(function(a, b){ return c[b.id] - c[a.id] || a.id - b.id; }).slice(0, 16);
  return top.length ? P.encL(top.map(function(q){ return {id:q.id, n:c[q.id]}; })).slice(0, 2) : [];
}
function likesSoon(){
  if(!G || !G.cfg.likes) return;
  clearTimeout(likeT);
  likeT = setTimeout(function(){ likeAt = Date.now(); var l = likeMsgs(); if(l.length) queueChats(l, 'likes'); }, Math.max(1500, 6000 - (Date.now() - likeAt)));
}
function sendA(q){ q.sent = true; queueChats(P.encA([q]), null, true); }
function sendX(list){ if(list.length) queueChats(P.encX(list), null, true); }

var T = {
  push:function(){
    if(!G) return;
    setName(P.encT({gid:G.gid, mode:G.cfg.mode, open:G.cfg.open, likes:G.cfg.likes, named:G.cfg.named, locked:!!G.locked, review:G.cfg.review, qlimit:G.cfg.qlimit, round:G.round, wmax:G.cfg.wmax, spot:G.spot, total:publicTotal()}));
  },
  gate:function(id, name){
    if(!G || id === NET.myId || /^T\|/.test(String(name || ''))) return false;
    if(G.banned[id]){ delete NET.peers[id]; return true; }
    if(!G.locked) return false;
    if(G.members[id] || (G.allow || {})[id]) return false;
    if(!G.kicked[id]){ G.kicked[id] = 1; send({t:'kick', id:id}); saveSoon(); }
    delete NET.peers[id];
    return true;
  },
  setLock:function(on){
    if(!G) return;
    if(on){
      G.locked = true; G.allow = {};
      Object.keys(G.members).forEach(function(id){ G.allow[id] = 1; });
      onlineIds().forEach(function(id){ G.allow[id] = 1; });
    } else {
      G.locked = false; G.allow = {};
      var left = {};
      Object.keys(G.kicked || {}).forEach(function(id){ if(!send({t:'unkick', id:id})) left[id] = 1; });
      G.kicked = left;
    }
    T.push(); saveG();
  },
  onPeer:function(id, name){
    if(!G || id === NET.myId) return;
    if(T.gate(id, name)) return;
    var d = P.decS(name); if(!d || d.gid !== G.gid) return;
    G.members[id] = G.members[id] || {who:'', at:Date.now()};
    var ok = G.cfg.likes ? d.likes.filter(function(x){ var q = G.qs[x]; return q && q.st === 'open'; }) : [];
    var old = (G.likes[id] || []).join(',');
    if(ok.length) G.likes[id] = ok; else delete G.likes[id];
    if(old !== ok.join(',')){ likesSoon(); saveSoon(); }
  },
  onChat:function(m){
    if(!G || !m || m.id === NET.myId || G.banned[m.id] || (G.kicked || {})[m.id]) return;
    var key = m.id + '|' + (m.at || ''), now = Date.now();
    if(G.seen.indexOf(key) >= 0) return;
    G.seen.push(key); if(G.seen.length > 400) G.seen = G.seen.slice(-300);
    var who = P.decWho(m.text);
    if(who){ (G.members[m.id] = G.members[m.id] || {who:'', at:now}).who = who; saveSoon(); T.paintSoon(); return; }
    var q = P.decQ(m.text);
    if(q){
      if(q.gid !== G.gid || G.cfg.mode !== 'qa' || !accepting()) return;
      var mine = qArr().filter(function(x){ return x.sid === m.id; }).length;
      if(G.cfg.qlimit && mine >= G.cfg.qlimit) return;
      if(P.dupQ(G.qs, m.id, q.text) || G.seq >= P.MAX_ID) return;
      T.addQ(q.text, m.id, m.at);
      snd('tick'); return;
    }
    var w = P.decW(m.text);
    if(w){
      if(w.gid !== G.gid || w.round !== G.round || G.cfg.mode !== 'cloud' || !accepting()) return;
      var r = curRound(), list = r.words[m.id] = r.words[m.id] || [];
      if(list.length >= G.cfg.wmax || list.some(function(x){ return P.wordKey(x) === P.wordKey(w.word); })) return;
      list.push(w.word); saveSoon(); T.paintSoon(); snd('tick');
    }
  },
  addQ:function(text, sid, at){
    var id = ++G.seq, review = G.cfg.review && sid !== 'T';
    var q = G.qs[id] = {id:id, text:P.cleanQ(text), sid:sid, at:at || Date.now(), st:review ? 'pending' : 'open', sent:false};
    if(!review) sendA(q);
    T.push(); saveSoon(); T.paintSoon();
    return q;
  },
  setSt:function(q, st){
    var was = q.st;
    if(st === 'done'){ q.final = counts()[q.id] || 0; q.doneAt = Date.now(); }
    if(st === 'open') delete q.final;
    q.st = st;
    if(G.spot === q.id && st !== 'open') G.spot = 0;
    if(st === 'open' && !q.sent) sendA(q);
    else if(q.sent && was !== st) sendX([q]);
    if(st !== 'open') Object.keys(G.likes).forEach(function(sid){ G.likes[sid] = G.likes[sid].filter(function(x){ return x !== q.id; }); if(!G.likes[sid].length) delete G.likes[sid]; });
    likesSoon(); T.push(); saveG(); T.paintSoon();
  },
  pt:0,
  paintSoon:function(){ if(T.pt) return; T.pt = setTimeout(function(){ T.pt = 0; T.paint(); }, 120); },
  // 局部更新：不重畫整頁（避免打斷老師正在輸入的欄位）
  paint:function(){
    netPaint();
    if(!G || JOIN || V.home) return;
    if(V.proj){ paintProj(); return; }
    var el = $('qlist'); if(el) el.innerHTML = qlistHtml();
    el = $('ftabs'); if(el) el.innerHTML = ftabsHtml();
    el = $('kpis'); if(el) el.innerHTML = kpiHtml();
    el = $('spotWrap'); if(el) el.innerHTML = spotHtml();
    el = $('wlist'); if(el) el.innerHTML = wlistHtml();
    el = $('cstat'); if(el) el.innerHTML = cloudStatHtml();
    var lb = document.querySelector('.lockbox'); if(lb && G.locked){ var t = document.createElement('div'); t.innerHTML = lockPanel(); lb.replaceWith(t.firstChild); }
    drawHostCloud();
  }
};

/* ---------- 老師：畫面片段 ---------- */
function topBar(){
  return '<div class="top noprint"><h1>📌 課堂提問牆 <small>匿名提問＋文字雲</small></h1>' +
    (G && !V.home ? '<button class="ibtn" data-act="home">🏠 首頁</button><button class="ibtn" data-act="renameCls" data-id="' + esc(G.cid) + '" title="改教室名稱">🏫 ' + esc(clsName()) + '</button><button class="ibtn" id="netChip" data-act="room">' + netChipHtml() + '</button><button class="ibtn" data-act="proj">📺 投影畫面</button>' : '') +
    '<a class="ibtn" href="manual.html">📖 操作手冊</a><button class="ibtn" data-act="settings" aria-label="常用設定">⚙</button></div>' +
    '<p class="warn-line noprint">學生問題經轉播站過濾不雅字詞，仍建議先開「先審核再上牆」再投影。<button data-act="warn">⚠ 使用警語</button></p>';
}
function footer(){
  return '<footer class="foot noprint">👤 創作者 Mark Tsai（蔡豐全）<a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a><br><a href="manual.html">📖 操作手冊</a><a href="#" data-act="warn">⚠ 使用警語</a>' +
    (standalone ? '' : '<a href="#" data-act="install">📲 加入主畫面</a>') + '<a href="?join">📱 我是學生</a><a href="https://m255525.github.io/startup-island/" target="_blank" rel="noopener">🏝 創業島</a>' +
    '<br><img src="' + BADGE + '" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle;margin-top:.4rem"></footer>';
}
function feat(ic, h, p){ return '<div class="feat"><div class="fi">' + ic + '</div><h3>' + h + '</h3><p>' + p + '</p></div>'; }
function homeView(){
  return topBar() +
    '<section class="hero"><div class="intro"><h2 class="ttl">不敢舉手的問題，<br><em>貼上來就好</em></h2>' +
    '<p>學生用手機掃 QR code 匿名提問，再幫想知道的問題按讚，最多人想問的自動排到最前面。也能出一題「用一個詞回答」，全班的答案即時長成文字雲。</p>' +
    '<div class="go"><button class="btn big red" data-act="newCls">＋ 新增教室</button>' + (G ? '<button class="btn alt big" data-act="resume">▶ 回到「' + esc(clsName()) + '」</button>' : '') + '</div>' +
    '<p class="small">學生不用下載 App、不用登入，同學之間看不到是誰問的。　<a href="?join">📱 我是學生，輸入代碼</a></p></div>' +
    '<div class="demo" aria-hidden="true"><div class="dn">損益兩平點要怎麼算比較快？<b>👍 14</b></div><div class="dn">剛剛那個例子可以再講一次嗎<b>👍 9</b></div><div class="dn">鳳凰貸款一定要有公司嗎？<b>👍 7</b></div><div class="dn">期末報告可以兩人一組嗎<b>👍 3</b></div></div></section>' +
    clsListHtml() +
    '<section class="feats">' +
    feat('🙋', '匿名提問', '同學之間看不到是誰問的，投影上也不會出現名字。需要時可以改成記名（只有老師看得到）。') +
    feat('👍', '按讚排序', '每人最多按 ' + P.MAX_LIKES + ' 個讚，大家最想知道的問題自動排在最前面，先回答最多人卡住的地方。') +
    feat('🛡', '先審核再上牆', '可以先看過再放上投影；不適合的拿下來，一直洗版的人可以擋下，不會顯示是誰。') +
    feat('🎯', '聚焦回答', '點一題放大到整個投影畫面，回答完按「已回答」，再換下一題最熱門的。') +
    feat('☁', '文字雲', '出一題「用一個詞回答」，每人 1～5 個詞，相同的詞越多字越大；可以隱藏、合併同義詞。') +
    feat('🖨', '課後紀錄', '問答紀錄與每一題文字雲一鍵列印，或下載 CSV、文字雲圖片，下次備課用得上。') +
    '</section>' +
    '<section class="card pin"><h2>怎麼進行</h2><ol class="steps"><li>新增教室（例如「三年二班」），投影「📺 投影畫面」上的 QR code。</li><li>學生用手機加入，打字提問、幫別人的問題按讚。</li><li>老師點最熱門的一題「🎯 聚焦」，回答完按「✅ 已回答」。</li><li>切到「☁ 文字雲」出一題，全班用一個詞回答。結束後列印紀錄。</li></ol></section>' +
    footer();
}
function clsStatus(g){
  if(!g) return ['尚未使用', ''];
  var n = Object.keys(g.qs || {}).length;
  return [(g.cfg.mode === 'cloud' ? '☁ 文字雲' : '💬 提問牆') + (g.cfg.open ? '・收集中' : '・暫停'), g.cfg.open ? 'live' : '', n];
}
function clsListHtml(){
  var list = clsList().slice().sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  var h = '<section class="card pin" id="clsList"><div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center"><h2 style="flex:1 1 12rem">🏫 我的教室' + (list.length ? '（' + list.length + ' 間）' : '') + '</h2><button class="btn red sm" data-act="newCls">＋ 新增教室</button></div>' +
    '<p class="lead">每間教室有自己的代碼、問題和文字雲。<b>一個分頁開一間</b>，開好幾個分頁就能讓好幾班同時使用。</p>';
  if(!list.length) return h + '<p class="alert warn">還沒有教室。按「＋ 新增教室」，取個名字（例如「三年二班」「週六創業班」）就能開始。</p></section>';
  h += '<div class="clsgrid">' + list.map(function(c){
    var g = loadEvent(c.id), st = clsStatus(g), here = G && G.cid === c.id, busy = !here && lockBusy(c.id);
    return '<div class="clscard' + (here ? ' here' : '') + '"><div class="cn">🏫 ' + esc(c.name) + '</div>' +
      '<div class="cm">' + (g ? Object.keys(g.qs).length + ' 個問題・' + Object.keys(g.rounds || {}).length + ' 題文字雲' : '還沒開始') + '</div>' +
      '<div class="cs"><span class="tag ' + (st[1] === 'live' ? 'green' : 'amber') + '">' + st[0] + '</span>' + (g ? '<span class="tag">代碼 ' + esc(g.room) + '</span>' : '') + (g && g.locked ? '<span class="tag red">🔒 關閉加入</span>' : '') +
      (here ? '<span class="tag red">這個分頁</span>' : busy ? '<span class="tag red">在其他分頁開啟中</span>' : '') + (hasPin(c.id) ? '<span class="tag">🔐 有管理密碼</span>' : '') + '</div>' +
      '<div class="go">' + (here ? '<button class="btn sm" data-act="resume">▶ 回到教室</button>' : '<button class="btn sm" data-act="enterCls" data-id="' + esc(c.id) + '">' + (busy ? '改在這裡開' : '▶ 進入') + '</button>' + (busy ? '' : '<a class="btn alt sm" href="?c=' + esc(c.id) + '" target="_blank" rel="noopener">↗ 新分頁</a>')) +
      '<button class="btn alt sm" data-act="renameCls" data-id="' + esc(c.id) + '">✏ 改名</button><button class="btn alt sm" data-act="pinCls" data-id="' + esc(c.id) + '">🔐 ' + (hasPin(c.id) ? '改密碼' : '設密碼') + '</button><button class="btn alt sm' + (clsInUse(c.id) ? ' inuse' : '') + '" data-act="delCls" data-id="' + esc(c.id) + '" aria-label="刪除教室" title="' + esc(clsInUse(c.id) || '刪除教室') + '">🗑</button></div></div>';
  }).join('') + '</div></section>';
  return h;
}
function seg(key, opts, cur){ return '<span class="seg">' + opts.map(function(o){ return '<button data-cfg="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</span>'; }
function deskView(){
  var c = G.cfg, h = topBar() +
    '<div class="modes noprint"><button data-act="mode" data-v="qa" aria-pressed="' + (c.mode === 'qa') + '">💬 提問牆' + (c.mode === 'qa' && c.open ? '<span class="live"></span>' : '') + '</button><button data-act="mode" data-v="cloud" aria-pressed="' + (c.mode === 'cloud') + '">☁ 文字雲' + (c.mode === 'cloud' && c.open ? '<span class="live"></span>' : '') + '</button></div>' +
    '<div class="desk"><div class="panel">' + (c.mode === 'qa' ? qaPanel() : cloudPanel()) + '</div><aside class="side">' + sideHtml() + '</aside></div>' + footer();
  return h;
}
function openBtn(){
  var c = G.cfg, what = c.mode === 'qa' ? '提問' : '收集';
  return '<span class="status ' + (c.open ? 'on' : 'off') + '">' + (c.open ? (c.mode === 'qa' ? '收問題中' : '收集答案中') : '暫停中') + '</span>' +
    (c.open ? '<button class="btn alt sm" data-act="toggleOpen">⏸ 暫停' + what + '</button>' : '<button class="btn green sm" data-act="toggleOpen">▶ 開放' + what + '</button>');
}
function qaPanel(){
  var c = G.cfg;
  return '<div class="ctlbar">' + openBtn() + '<button class="btn alt sm" data-act="addQ">＋ 老師新增問題</button><button class="btn sun sm" data-act="nextHot">🎯 聚焦最熱門</button></div>' +
    '<details class="noprint" style="margin-top:.7rem"' + (lsGet('rulesOpen') === '0' ? '' : ' open') + ' data-keep="rulesOpen"><summary style="cursor:pointer;font-weight:900">⚙ 提問規則</summary><div class="ctlbar" style="margin-top:.5rem">' +
    '<span class="grp">上牆 ' + seg('review', [[false, '直接上牆'], [true, '先審核']], c.review) + '</span>' +
    '<span class="grp">每人最多 ' + seg('qlimit', [[1, '1 題'], [3, '3 題'], [5, '5 題'], [0, '不限']], c.qlimit) + '</span>' +
    '<span class="grp">按讚 ' + seg('likes', [[true, '開'], [false, '關']], c.likes) + '</span>' +
    '<span class="grp">提問者 ' + seg('named', [[false, '匿名'], [true, '記名（只有老師看到）']], c.named) + '</span></div></details>' +
    '<div id="spotWrap">' + spotHtml() + '</div>' +
    '<div class="ftabs" id="ftabs">' + ftabsHtml() + '</div>' +
    '<div class="qlist" id="qlist">' + qlistHtml() + '</div>';
}
function ftabsHtml(){
  var n = {pending:0, open:0, done:0, hidden:0}; qArr().forEach(function(q){ n[q.st]++; });
  if(V.filter === 'pending' && !n.pending && !G.cfg.review) V.filter = 'open';
  var tabs = [['open', '💬 待回答'], ['done', '✅ 已回答'], ['hidden', '🙈 拿下來']];
  if(G.cfg.review || n.pending) tabs.unshift(['pending', '🕒 待審核']);
  return tabs.map(function(t){ return '<button data-act="ftab" data-v="' + t[0] + '" aria-pressed="' + (V.filter === t[0]) + '">' + t[1] + '<b>' + n[t[0]] + '</b></button>'; }).join('') +
    '<span class="sp"></span><span class="seg"><button data-act="sortBy" data-v="hot" aria-pressed="' + (G.cfg.sort === 'hot') + '">👍 最熱門</button><button data-act="sortBy" data-v="new" aria-pressed="' + (G.cfg.sort === 'new') + '">🕒 最新</button></span>' +
    (V.filter === 'pending' && n.pending > 1 ? '<button class="btn green sm" data-act="approveAll">✅ 全部上牆</button>' : '');
}
function qlistHtml(){
  var c = counts(), list = P.sortQs(byState(V.filter), c, V.filter === 'done' ? 'new' : G.cfg.sort);
  if(!list.length) return '<div class="empty">' + ({pending:'沒有待審核的問題', open:G.cfg.open ? '還沒有問題。請學生掃 QR code 匿名提問 🙋' : '目前暫停收問題', done:'還沒有回答完的問題', hidden:'沒有拿下來的問題'}[V.filter]) + '</div>';
  return list.map(function(q){ return qcard(q, c, true); }).join('');
}
function whoOf(q){ if(q.sid === 'T') return '老師新增'; var m = G.members[q.sid]; return G.cfg.named && m && m.who ? m.who : ''; }
function qcard(q, c, host){
  var n = c[q.id] || 0, who = host ? whoOf(q) : '', acts = '';
  if(host){
    var b = function(act, label, main){ return '<button data-act="' + act + '" data-id="' + q.id + '"' + (main ? ' class="main"' : '') + '>' + label + '</button>'; };
    if(q.st === 'pending') acts = b('approve', '✅ 上牆', true) + b('editQ', '✏️ 修改') + b('hideQ', '🙈 不上牆');
    else if(q.st === 'open') acts = (G.spot === q.id ? b('unspot', '取消聚焦') : b('spot', '🎯 聚焦', true)) + b('doneQ', '✅ 已回答') + b('editQ', '✏️ 修改') + b('hideQ', '🙈 拿下來');
    else if(q.st === 'done') acts = b('reopenQ', '↩ 改回待回答') + b('hideQ', '🙈');
    else acts = b('restoreQ', '↩ 放回牆上');
    if(q.sid !== 'T' && q.st !== 'hidden') acts += b('block', '🚫 擋下');
  }
  return '<div class="qc c' + (q.id % 5) + ' ' + q.st + (G.spot === q.id ? ' spot' : '') + '"><div class="qt">' + esc(q.text) + '</div>' +
    '<div class="qm"><span>#' + q.id + '</span><span>' + P.ago(Date.now() - q.at) + '</span>' + (who ? '<span class="tag blue">' + esc(who) + '</span>' : '') + (q.st === 'pending' ? '<span class="tag amber">待審核</span>' : '') +
    (G.cfg.likes || n ? '<span class="likes">👍 ' + n + '</span>' : '') + '</div>' + (acts ? '<div class="qa noprint">' + acts + '</div>' : '') + '</div>';
}
function spotHtml(){
  var q = G.spot && G.qs[G.spot]; if(!q) return '';
  return '<div class="spotbar"><div><div class="sl">🎯 正在回答（投影上放大顯示）・👍 ' + (counts()[q.id] || 0) + '</div><div class="st">' + esc(q.text) + '</div></div><div class="go"><button class="btn green" data-act="doneQ" data-id="' + q.id + '">✅ 回答完</button><button class="btn sun sm" data-act="nextHot" data-done="1">✅ 回答完，換下一題</button><button class="btn alt sm" data-act="unspot">取消聚焦</button></div></div>';
}
function kpiHtml(){
  var c = G.cfg.mode === 'qa', likes = 0; Object.keys(G.likes).forEach(function(k){ likes += G.likes[k].length; });
  var r = curRound(), wn = 0; Object.keys(r.words).forEach(function(k){ wn += r.words[k].length; });
  return '<div><b>' + onlineIds().length + '</b>線上</div>' + (c ? '<div><b>' + qArr().length + '</b>問題</div><div><b>' + likes + '</b>讚</div>' : '<div><b>' + Object.keys(r.words).length + '</b>人回答</div><div><b>' + wn + '</b>個詞</div>');
}
function lockPanel(){
  var n = Object.keys(G.kicked || {}).length;
  return '<div class="lockbox"><div class="li">🔒</div><div><div style="font-weight:900">已關閉加入</div><p class="small" style="margin:.2rem 0">已在教室的同學不受影響（斷線也能回來）；新同學掃碼會被擋下' + (n ? '，目前已擋下 <b>' + n + '</b> 位' : '') + '。</p><button class="btn green sm" data-act="unlock">🔓 開放加入</button></div></div>';
}
function sideHtml(){
  var h = '<div class="card pin roomcard noprint"><div style="font-weight:900">🏫 ' + esc(clsName()) + '</div>';
  if(!NET.want) h += '<p class="small">學生用手機掃 QR code 加入。</p><button class="btn red" data-act="netOn">📱 開放手機加入</button>';
  else if(G.locked) h += lockPanel();
  else h += '<div class="small">手機掃描，或到 ' + esc(ONLINE.replace('https://', '')) + '?join 輸入代碼</div><div class="qr" id="qrJoin"></div><div class="code">' + esc(NET.code) + '</div><div class="go" style="justify-content:center;margin-top:.4rem"><button class="btn alt sm" data-act="bigQR">🔍 放大</button><button class="btn alt sm" data-act="copyJoin">📋 連結</button><button class="btn alt sm" data-act="lock">🔒 關閉加入</button></div>' +
    (location.protocol === 'https:' && location.hostname === 'm255525.github.io' ? '' : '<p class="small">目前不是線上版網址，QR code 指向線上版。</p>');
  h += '<div class="kpis" id="kpis">' + kpiHtml() + '</div></div>';
  var nb = Object.keys(G.banned || {}).length;
  h += '<div class="card pin noprint"><h3 style="margin:0 0 .4rem">📋 紀錄與整理</h3><div class="stack"><button class="btn alt sm" data-act="printRec">🖨 列印問答與文字雲紀錄</button><button class="btn alt sm" data-act="csvQ">⬇ 問題 CSV</button><button class="btn alt sm" data-act="csvW">⬇ 文字雲 CSV</button><button class="btn alt sm" data-act="newSession">🔄 新的一場（清空）</button>' +
    (nb ? '<button class="btn alt sm" data-act="unblockAll">🚫 已擋下 ' + nb + ' 人・全部解除</button>' : '') + '</div><p class="small" style="margin:.5rem 0 0">資料只存在這台電腦的瀏覽器。</p></div>';
  return h;
}

/* ---------- 文字雲 ---------- */
function cloudPanel(){
  var c = G.cfg, vr = viewRound(), cur = vr.no === G.round, r = vr.r;
  var h = '';
  if(cur){
    h += '<div class="ctlbar">' + openBtn() + '<span class="grp">每人最多 ' + seg('wmax', [[1, '1 個詞'], [3, '3 個'], [5, '5 個']], c.wmax) + '</span><button class="btn alt sm" data-act="nextRound">➕ 下一題（換新題目）</button></div>' +
      '<label class="fld" style="margin-top:.8rem">第 ' + vr.no + ' 題的題目' +
      '<span class="inrow"><input id="pIn" maxlength="54" value="' + esc(r.prompt) + '" placeholder="例如：用一個詞形容今天的課"><button class="btn red" data-act="publishPrompt">📣 發布題目</button></span></label>' +
      '<div class="presets">' + P.PROMPTS.map(function(p, i){ return '<button data-act="pickPrompt" data-i="' + i + '" aria-pressed="' + (p === r.prompt) + '">' + esc(p) + '</button>'; }).join('') + '</div>';
  } else {
    h += '<div class="alert warn">📜 正在看第 ' + vr.no + ' 題（之前的題目，只能看、不再收集）<button class="btn alt sm" data-act="viewRound" data-r="0" style="margin-left:.5rem">回到目前第 ' + G.round + ' 題</button></div>';
  }
  h += '<div class="prompt" style="margin-top:.9rem">' + (r.prompt ? '☁ ' + esc(r.prompt) : '<span class="small">（還沒有題目。學生仍可以送詞，但建議先發布題目）</span>') + '</div>' +
    '<div class="cloudbox" id="cloudBox"><canvas id="cloudCv" aria-label="文字雲"></canvas><div class="ph" id="cloudPh">等大家送出答案…<br>點文字雲上的詞可以隱藏或合併</div></div>' +
    '<div class="small" id="cstat" style="margin-top:.4rem">' + cloudStatHtml() + '</div>' +
    '<div class="wlist" id="wlist">' + wlistHtml() + '</div>' +
    '<div class="go"><button class="btn alt sm" data-act="pngCloud">🖼 下載文字雲圖片</button></div>';
  var keys = Object.keys(G.rounds).map(Number).sort(function(a, b){ return a - b; });
  if(keys.length > 1) h += '<h3>📜 之前的題目</h3><div class="rounds">' + keys.map(function(k){ return '<button data-act="viewRound" data-r="' + k + '" aria-pressed="' + (k === vr.no) + '">' + k + '. ' + esc(G.rounds[k].prompt || '（沒有題目）') + '</button>'; }).join('') + '</div>';
  return h;
}
function cloudItems(r){ return P.tally(r.words, r.hidden, r.merge); }
function cloudStatHtml(){
  var r = viewRound().r, items = cloudItems(r), nh = Object.keys(r.hidden).length, nm = Object.keys(r.merge).length;
  return Object.keys(r.words).length + ' 人回答・' + items.length + ' 個不同的詞' + (nh ? '・已隱藏 ' + nh + ' 個 <button class="btn alt sm" data-act="unhideAll">全部顯示</button>' : '') + (nm ? '・已合併 ' + nm + ' 組 <button class="btn alt sm" data-act="unmergeAll">取消合併</button>' : '');
}
function wlistHtml(){ return cloudItems(viewRound().r).slice(0, 60).map(function(it){ return '<button data-act="wordMenu" data-k="' + esc(it.key) + '">' + esc(it.text) + '<b>' + it.n + '</b></button>'; }).join(''); }
// 把排版畫到 canvas（只有內容或大小改變才重排）
function drawCloud(cv, items, W, H, opt){
  opt = opt || {};
  var dpr = Math.min(2, window.devicePixelRatio || 1), key = JSON.stringify(items.map(function(i){ return [i.key, i.text, i.n]; })) + '|' + W + 'x' + H + (opt.title || '');
  if(cv._key === key) return cv._lay;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv._W = W; cv._H = H;
  if(opt.px){ cv.style.width = W + 'px'; cv.style.height = H + 'px'; } else if(!opt.fixed){ cv.style.width = '100%'; cv.style.height = 'auto'; }
  var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  var top = 0;
  if(opt.bg){ ctx.fillStyle = '#1F2B2A'; ctx.fillRect(0, 0, W, H); }
  if(opt.title){
    ctx.fillStyle = '#3B2A1E'; ctx.fillRect(0, 0, W, 110); ctx.fillStyle = '#FFF6E6'; ctx.font = '900 46px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var t = opt.title; while(ctx.measureText(t).width > W - 80 && t.length > 4) t = t.slice(0, -2) + '…';
    ctx.fillText(t, W / 2, 56); top = 110;
    ctx.fillStyle = '#9FB3AE'; ctx.font = '700 22px ' + FONT; ctx.fillText(opt.foot || '', W / 2, H - 24);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  var measure = function(t, px){ ctx.font = '900 ' + px + 'px ' + FONT; return ctx.measureText(t).width; };
  var lay = P.layoutCloud(items, W, H - top - (opt.title ? 50 : 0), measure);
  lay.forEach(function(it){ ctx.font = '900 ' + it.size + 'px ' + FONT; ctx.fillStyle = it.color; ctx.fillText(it.text, it.x, top + it.y + it.h / 2); });
  cv._key = key; cv._lay = lay;
  return lay;
}
function drawHostCloud(){
  var cv = $('cloudCv'), box = $('cloudBox'); if(!cv || !box) return;
  var items = cloudItems(viewRound().r), W = Math.max(280, box.clientWidth), H = Math.max(240, Math.round(W * .5));
  drawCloud(cv, items, W, H);
  var ph = $('cloudPh'); if(ph) ph.hidden = items.length > 0;
}
function exportCloud(r, no){
  var cv = document.createElement('canvas');
  drawCloud(cv, cloudItems(r), 1600, 900, {bg:true, fixed:true, title:r.prompt || ('第 ' + no + ' 題'), foot:'課堂提問牆・' + clsName() + '・' + today() + '・' + Object.keys(r.words).length + ' 人回答'});
  return cv;
}

/* ---------- 投影畫面 ---------- */
function projHtml(){
  var c = G.cfg, r = curRound();
  var head = '<div class="ph1"><h1>' + (c.mode === 'qa' ? '🙋 有問題嗎？掃描就能匿名提問' : '☁ ' + esc(r.prompt || '用一個詞回答')) + '</h1>' +
    (G.room && (NET.want || PROJ) && !G.locked && !G.netOff ? '<div class="jc">🏫 ' + esc(clsName()) + '<b>' + esc(G.room) + '</b></div><div class="pqr" id="qrProj"></div>' : '<div class="jc">🏫 ' + esc(clsName()) + '</div>') + '</div>';
  return '<div class="projv">' + head + '<div class="pbody" id="pbody">' + projBody() + '</div>' +
    '<div class="pfoot" id="pfoot">' + projFoot() + '</div>' +
    (PROJ ? '' : '<button class="ibtn exit" data-act="projExit">✕ 回主持台（Esc）</button>') + '</div>';
}
function projFoot(){
  var c = G.cfg;
  if(!c.open) return '⏸ 老師暫停收集中';
  return c.mode === 'qa' ? '👍 幫你也想知道的問題按讚，最多人想問的排最前面' : '每人最多 ' + c.wmax + ' 個詞・相同的詞越多，字越大';
}
function projBody(){
  var c = G.cfg;
  if(c.mode === 'cloud') return '<div class="pcloud"><div class="cloudbox" id="projBox"><canvas id="projCv"></canvas><div class="ph" id="projPh">等大家送出答案…</div></div></div>';
  var cnt = counts(), q = G.spot && G.qs[G.spot];
  if(q) return '<div class="bigq"><span class="lab">🎯 正在回答</span>' + qcard(q, cnt, false) + '</div>';
  var list = P.sortQs(byState('open'), cnt, c.likes ? 'hot' : 'new').slice(0, 12);
  if(!list.length) return '<div class="bigq"><div class="qc c1"><div class="qt" style="text-align:center">還沒有問題<br>掃右上角 QR code，匿名問問看 🙋</div></div></div>';
  return '<div class="pgrid">' + list.map(function(x){ return qcard(x, cnt, false); }).join('') + '</div>';
}
function paintProj(){
  var b = $('pbody'); if(!b) return;
  var mode = G.cfg.mode + '|' + G.spot;
  if(G.cfg.mode === 'qa' || b.dataset.m !== mode){ b.innerHTML = projBody(); b.dataset.m = mode; }
  var f = $('pfoot'); if(f) f.innerHTML = projFoot();
  var cv = $('projCv'), box = $('projBox');
  if(cv && box){
    var items = cloudItems(curRound());
    drawCloud(cv, items, Math.max(300, box.clientWidth - 16), Math.max(200, box.clientHeight - 16), {px:true});
    var ph = $('projPh'); if(ph) ph.hidden = items.length > 0;
  }
  var h1 = document.querySelector('.projv .ph1 h1'); if(h1) h1.innerHTML = G.cfg.mode === 'qa' ? '🙋 有問題嗎？掃描就能匿名提問' : '☁ ' + esc(curRound().prompt || '用一個詞回答');
}

/* ---------- 列印、CSV ---------- */
var ST_TXT = {pending:'待審核', open:'待回答', done:'已回答', hidden:'拿下來'};
function printRec(){
  var c = counts(), list = P.sortQs(qArr(), c, 'hot'), named = G.cfg.named || list.some(function(q){ return whoOf(q); });
  var h = '<div class="psheet"><h1>課堂問答紀錄・' + esc(clsName()) + '</h1><div class="meta">' + today() + '・共 ' + list.length + ' 個問題・已回答 ' + byState('done').length + ' 題・課堂提問牆</div>' +
    (list.length ? '<table><thead><tr><th>#</th><th>問題</th><th>讚</th><th>狀態</th><th>時間</th>' + (named ? '<th>提問者</th>' : '') + '</tr></thead><tbody>' +
      list.map(function(q){ return '<tr><td class="c">' + q.id + '</td><td>' + esc(q.text) + '</td><td class="c">' + (c[q.id] || 0) + '</td><td class="c">' + ST_TXT[q.st] + '</td><td class="c">' + P.hhmm(q.at) + '</td>' + (named ? '<td>' + esc(whoOf(q)) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table>' : '<p>這一場沒有問題。</p>') + '</div>';
  Object.keys(G.rounds).map(Number).sort(function(a, b){ return a - b; }).forEach(function(k){
    var r = G.rounds[k], items = cloudItems(r); if(!items.length) return;
    h += '<div class="psheet"><h1>文字雲 第 ' + k + ' 題</h1><div class="meta">' + esc(r.prompt || '（沒有題目）') + '・' + Object.keys(r.words).length + ' 人回答・' + items.length + ' 個不同的詞</div><img class="cl" alt="文字雲" src="' + exportCloud(r, k).toDataURL('image/png') + '">' +
      '<h2>最多人寫的詞</h2><table><thead><tr><th>詞</th><th>人數</th><th>詞</th><th>人數</th></tr></thead><tbody>';
    var top = items.slice(0, 30);
    for(var i = 0; i < top.length; i += 2) h += '<tr><td>' + esc(top[i].text) + '</td><td class="c">' + top[i].n + '</td><td>' + (top[i + 1] ? esc(top[i + 1].text) : '') + '</td><td class="c">' + (top[i + 1] ? top[i + 1].n : '') + '</td></tr>';
    h += '</tbody></table></div>';
  });
  $('printArea').innerHTML = h; document.body.classList.add('print-area');
  setTimeout(function(){ window.print(); }, 200);
}
window.addEventListener('afterprint', function(){ document.body.classList.remove('print-area'); });
function csvQ(){
  var c = counts(), named = G.cfg.named;
  var rows = [['編號', '問題', '讚數', '狀態', '提問時間'].concat(named ? ['提問者'] : [])];
  P.sortQs(qArr(), c, 'hot').forEach(function(q){ rows.push([q.id, q.text, c[q.id] || 0, ST_TXT[q.st], new Date(q.at).toLocaleString('zh-TW')].concat(named ? [whoOf(q)] : [])); });
  return rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n');
}
function csvW(){
  var rows = [['題號', '題目', '詞', '人數']];
  Object.keys(G.rounds).map(Number).sort(function(a, b){ return a - b; }).forEach(function(k){ var r = G.rounds[k]; cloudItems(r).forEach(function(it){ rows.push([k, r.prompt, it.text, it.n]); }); });
  return rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n');
}

/* ---------- 老師：主繪製與事件 ---------- */
function render(){
  if(JOIN){ renderStu(); return; }
  document.body.classList.toggle('proj', !!(G && (V.proj || PROJ)));
  if(PROJ){
    if(!G){ $('app').innerHTML = '<section class="card pin"><h2>📺 投影畫面</h2><p>找不到這間教室的資料。請從主持台按「📺 投影畫面 → 在新視窗開」。</p></section>'; return; }
    $('app').innerHTML = projHtml(); drawQR('qrProj', 140, G.room); paintProj(); return;
  }
  var h;
  if(!G || V.home) h = homeView();
  else if(V.proj) h = projHtml();
  else h = deskView();
  keepFocus(function(){ $('app').innerHTML = h; });
  if(G && !V.home){
    if(V.proj){ if(NET.want && !G.locked) drawQR('qrProj', 140); paintProj(); }
    else { if(NET.want && $('qrJoin')) drawQR('qrJoin', 170); drawHostCloud(); }
  }
}
document.addEventListener('click', function(e){
  var el = e.target.closest('[data-act],[data-cfg],[data-fontsize],[data-like]');
  if(!el){ if(e.target.id === 'cloudCv') cloudClick(e); return; }
  var ds = el.dataset;
  if(el.tagName === 'A' && ds.act) e.preventDefault();
  if(JOIN && S.click(el, ds)) return;
  if(ds.fontsize){ lsSet('fs', ds.fontsize); applyView(); openSettings(); return; }
  if(ds.cfg && G){
    var v = ds.v === 'true' ? true : ds.v === 'false' ? false : /^\d+$/.test(ds.v) ? +ds.v : ds.v;
    G.cfg[ds.cfg] = v; saveCfgPref();
    if(ds.cfg === 'likes' && !v){ G.likes = {}; }
    if(ds.cfg === 'review' && !v && byState('pending').length) toast('還有 ' + byState('pending').length + ' 題待審核，記得處理');
    T.push(); saveG(); render(); return;
  }
  var act = ds.act; if(act && ACT[act]) ACT[act](el);
});
function cloudClick(e){
  var cv = e.target, lay = cv._lay || [], rect = cv.getBoundingClientRect();
  var x = (e.clientX - rect.left) * (cv._W || rect.width) / rect.width, y = (e.clientY - rect.top) * (cv._H || rect.height) / rect.height;
  var hit = lay.filter(function(it){ return x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h; })[0];
  if(hit) ACT.wordMenu({dataset:{k:hit.key}});
}
document.addEventListener('input', function(e){ if(JOIN) S.onInput(e.target); });
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){ if(modalOpen()) closeModal(); else if(V.proj && !PROJ){ ACT.projExit(); } }
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    var id = e.target && e.target.id;
    if(id === 'pIn'){ e.preventDefault(); ACT.publishPrompt(); }
    else if(id === 'newQ'){ e.preventDefault(); ACT.addQYes(); }
    else if(id === 'editIn'){ e.preventDefault(); ACT.editQYes(); }
    else if(JOIN && (id === 'wordIn' || id === 'codeIn' || id === 'whoIn')){ e.preventDefault(); S.click({}, {act:id === 'wordIn' ? 'sendWord' : id === 'codeIn' ? 'joinCode' : 'saveWho'}); }
  }
});
document.addEventListener('toggle', function(e){ var d = e.target; if(d.dataset && d.dataset.keep) lsSet(d.dataset.keep, d.open ? '1' : '0'); }, true);
$('modal').addEventListener('click', function(e){ if(e.target.id === 'modal') closeModal(); });
window.addEventListener('resize', function(){ clearTimeout(V.rz); V.rz = setTimeout(function(){ if(JOIN || !G) return; if(V.proj || PROJ) paintProj(); else drawHostCloud(); }, 200); });

function qOf(el){ return G && G.qs[+el.dataset.id]; }
var ACT = {
  close:closeModal, warn:function(){ showWarn(); }, settings:openSettings, install:function(){ closeModal(); install(); },
  home:function(){ closeModal(); if(G) saveG(); V.home = true; V.proj = false; render(); window.scrollTo(0, 0); },
  resume:function(){ if(G) enterCls(G.cid, true); },
  enterCls:function(el){ enterCls(el.dataset.id, !lockBusy(el.dataset.id)); },
  enterForce:function(el){ enterCls(el.dataset.id, true); },
  newCls:function(){ openModal('<h2>🏫 新增教室</h2><p class="lead">取一個好認的名字，學生手機上也會看到。</p><label class="fld">教室名稱<input id="clsName" maxlength="20" placeholder="例如：三年二班、週六創業班"></label>' + pinFields(false) + '<p class="small">設了管理密碼，<b>刪除、改名、關閉教室</b>都要輸入密碼。共用電腦建議一定要設。密碼忘了無法找回。</p><div class="stack"><button class="btn red" data-act="newClsYes">建立並進入</button><button class="btn alt" data-act="close">取消</button></div>'); setTimeout(function(){ var i = $('clsName'); if(i) i.focus(); }, 50); },
  newClsYes:function(){
    var name = P.cleanRoomName(($('clsName') || {}).value);
    if(!name){ toast('請輸入教室名稱'); return; }
    if(clsList().some(function(c){ return c.name === name; })){ toast('已經有同名的教室'); return; }
    var np = readNewPin(); if(np.err){ toast(np.err); return; }
    (np.pin ? makePin(np.pin) : Promise.resolve(null)).then(function(pinObj){
      var id = newClsId(), l = clsList(), c = {id:id, name:name, at:Date.now()}; if(pinObj) c.pin = pinObj; l.push(c); clsSave(l);
      closeModal(); enterCls(id, true); toast('已建立「' + name + '」' + (pinObj ? '（有管理密碼）' : ''));
    });
  },
  renameCls:function(el){ var id = el.dataset.id; guard(id, {title:'✏ 改教室名稱', body:'<label class="fld">教室名稱<input id="clsName" maxlength="20" value="' + esc(clsName(id)) + '"></label>', btn:'儲存', read:function(){ return P.cleanRoomName(($('clsName') || {}).value); }}, function(name){
    if(!name){ toast('請輸入教室名稱'); return false; }
    if(clsList().some(function(c){ return c.name === name && c.id !== id; })){ toast('已經有同名的教室'); return false; }
    var l = clsList(); l.forEach(function(c){ if(c.id === id) c.name = name; }); clsSave(l);
    if(G && G.cid === id && NET.want) queueChats([P.encRoomName(name)], 'rname', true);
    render(); toast('已改名為「' + name + '」');
  }); },
  guardOk:function(){
    var g = V.guard; if(!g) return;
    var val = g.read ? g.read() : null, pin = ($('pinIn') || {}).value;
    if(hasPin(g.id) && !pin){ toast('請輸入管理密碼'); return; }
    checkPin(g.id, pin).then(function(ok){
      if(!ok){ toast('管理密碼不對'); var i = $('pinIn'); if(i){ i.value = ''; i.focus(); } return; }
      if(g.fn(val) === false) return;
      V.guard = null; closeModal();
    }, function(msg){ toast(msg); });
  },
  pinCls:function(el){
    var id = el.dataset.id, has = hasPin(id); V.pinId = id;
    openModal('<h2>🔐 「' + esc(clsName(id)) + '」的管理密碼</h2><p class="lead">' + (has ? '輸入目前的密碼才能修改。新密碼兩欄都留空＝取消密碼。' : '設了之後，刪除、改名、關閉教室都要輸入這組密碼。') + '</p>' + pinFields(has) + '<p class="small">密碼只存在這台電腦（加密雜湊），忘了無法找回。</p><div class="stack"><button class="btn red" data-act="pinSave">儲存</button><button class="btn alt" data-act="close">取消</button></div>');
  },
  pinSave:function(){
    var id = V.pinId, has = hasPin(id), np = readNewPin();
    if(np.err){ toast(np.err); return; }
    if(!has && np.none){ toast('請輸入 4～6 位數字'); return; }
    checkPin(id, ($('pinOld') || {}).value).then(function(ok){
      if(!ok){ toast('目前的密碼不對'); return; }
      (np.pin ? makePin(np.pin) : Promise.resolve(null)).then(function(pinObj){ setPin(id, pinObj); closeModal(); render(); toast(pinObj ? '已設定管理密碼' : '已取消管理密碼'); });
    }, function(msg){ toast(msg); });
  },
  delCls:function(el){
    var id = el.dataset.id, why = clsInUse(id);
    if(why){ openModal('<h2>🔒 教室使用中，不能刪除</h2><p>' + esc(why) + '。</p><p class="lead">請在教室裡按「🚪 關閉教室」讓學生離線（或關掉另一個分頁）後再刪除。</p><div class="stack"><button class="btn" data-act="close">知道了</button></div>'); return; }
    guard(id, {title:'🗑 刪除「' + esc(clsName(id)) + '」？', body:'<p>這間教室的問題、文字雲都會刪掉，無法復原。需要留存請先列印或下載 CSV。</p>', btn:'刪除教室', danger:true}, function(){
      if(clsInUse(id)){ toast('教室剛好有人在用，已取消刪除'); return; }
      if(G && G.cid === id) leaveCls(true);
      clsSave(clsList().filter(function(c){ return c.id !== id; })); lsDel(evKey(id)); lsDel('lock.' + id);
      render(); toast('已刪除教室');
    });
  },
  mode:function(el){
    var v = el.dataset.v; if(G.cfg.mode === v) return;
    G.cfg.mode = v; saveCfgPref(); T.push(); saveG();
    if(v === 'cloud' && curRound().prompt) queueChats([P.encPrompt(G.round, curRound().prompt)], 'prompt', true);
    render();
  },
  toggleOpen:function(){ G.cfg.open = !G.cfg.open; if(!G.cfg.open) G.closedAt = Date.now(); snd(G.cfg.open ? 'open' : 'close'); T.push(); saveG(); render(); },
  ftab:function(el){ V.filter = el.dataset.v; T.paint(); },
  sortBy:function(el){ G.cfg.sort = el.dataset.v; saveCfgPref(); saveSoon(); T.paint(); },
  approve:function(el){ var q = qOf(el); if(q) T.setSt(q, 'open'); },
  approveAll:function(){ byState('pending').sort(function(a, b){ return a.id - b.id; }).forEach(function(q){ T.setSt(q, 'open'); }); toast('已全部上牆'); },
  spot:function(el){ var q = qOf(el); if(!q) return; G.spot = q.id; snd('pop'); T.push(); saveG(); T.paint(); },
  unspot:function(){ G.spot = 0; T.push(); saveG(); T.paint(); },
  nextHot:function(el){
    if(el && el.dataset && el.dataset.done && G.spot && G.qs[G.spot]) T.setSt(G.qs[G.spot], 'done');
    var c = counts(), list = P.sortQs(byState('open').filter(function(q){ return q.id !== G.spot; }), c, 'hot');
    if(!list.length){ G.spot = 0; T.push(); saveG(); T.paint(); toast('沒有待回答的問題了'); return; }
    G.spot = list[0].id; snd('pop'); T.push(); saveG(); T.paint();
  },
  doneQ:function(el){ var q = qOf(el); if(q){ T.setSt(q, 'done'); snd('ok'); } },
  reopenQ:function(el){ var q = qOf(el); if(q) T.setSt(q, 'open'); },
  hideQ:function(el){ var q = qOf(el); if(q) T.setSt(q, 'hidden'); },
  restoreQ:function(el){ var q = qOf(el); if(q) T.setSt(q, 'open'); },
  editQ:function(el){ var q = qOf(el); if(!q) return; V.editId = q.id; openModal('<h2>✏ 修改問題 #' + q.id + '</h2><p class="lead">修正錯字或說得更清楚。手機上也會同步更新。</p><label class="fld">問題<input id="editIn" maxlength="' + P.MAX_Q + '" value="' + esc(q.text) + '"></label><div class="stack"><button class="btn red" data-act="editQYes">儲存</button><button class="btn alt" data-act="close">取消</button></div>'); setTimeout(function(){ var i = $('editIn'); if(i) i.focus(); }, 50); },
  editQYes:function(){ var q = G.qs[V.editId], t = P.cleanQ(($('editIn') || {}).value); if(!q || !t){ toast('問題不能空白'); return; } q.text = t; if(q.sent && q.st !== 'hidden') sendA(q); saveG(); closeModal(); T.paint(); },
  addQ:function(){ openModal('<h2>＋ 老師新增問題</h2><p class="lead">例如收到紙條、口頭提問，或想先放幾題暖場。會直接上牆。</p><label class="fld">問題<input id="newQ" maxlength="' + P.MAX_Q + '" placeholder="最多 ' + P.MAX_Q + ' 個字"></label><div class="stack"><button class="btn red" data-act="addQYes">新增</button><button class="btn alt" data-act="close">取消</button></div>'); setTimeout(function(){ var i = $('newQ'); if(i) i.focus(); }, 50); },
  addQYes:function(){ var t = P.cleanQ(($('newQ') || {}).value); if(!t){ toast('請輸入問題'); return; } if(G.seq >= P.MAX_ID){ toast('這一場已經 999 題了'); return; } T.addQ(t, 'T'); closeModal(); V.filter = 'open'; T.paint(); toast('已新增'); },
  block:function(el){ var q = qOf(el); if(!q) return; V.blockSid = q.sid; var n = qArr().filter(function(x){ return x.sid === q.sid && x.st !== 'hidden'; }).length; openModal('<h2>🚫 擋下這位提問者？</h2><p>他會被請出教室、不能再加入，問過的 <b>' + n + '</b> 個問題全部拿下來。</p><p class="lead">畫面上不會顯示是誰。適合用在洗版或不當發言；之後可以在右側「全部解除」。</p><div class="stack"><button class="btn red" data-act="blockYes">擋下</button><button class="btn alt" data-act="close">取消</button></div>'); },
  blockYes:function(){
    var sid = V.blockSid; if(!sid) return;
    G.banned[sid] = 1; send({t:'kick', id:sid}); delete NET.peers[sid]; delete G.likes[sid];
    qArr().forEach(function(q){ if(q.sid === sid && q.st !== 'hidden') T.setSt(q, 'hidden'); });
    saveG(); closeModal(); render(); toast('已擋下（不會顯示是誰）');
  },
  unblockAll:function(){ Object.keys(G.banned).forEach(function(id){ send({t:'unkick', id:id}); }); G.banned = {}; saveG(); render(); toast('已全部解除，被擋的同學重新整理就能加入'); },
  proj:function(){
    if(!G) return;
    openModal('<h2>📺 投影畫面</h2><p class="lead">只顯示 QR code、上牆的問題（或文字雲），<b>不會出現待審核的問題和操作按鈕</b>。</p><div class="stack"><button class="btn red" data-act="projHere">在這個視窗投影</button><button class="btn alt" data-act="projWin">↗ 在新視窗開（延伸螢幕用：筆電留主持台，投影機放這個視窗）</button><button class="btn alt" data-act="close">取消</button></div><p class="small">新視窗會自動跟著主持台更新，關掉也不影響教室。</p>');
  },
  projHere:function(){ closeModal(); V.proj = true; render(); try{ if(document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(){}); }catch(e){} },
  projWin:function(){ closeModal(); saveG(); var w = window.open(location.pathname + '?c=' + G.cid + '&proj=1', 'qawproj_' + G.cid); if(!w) toast('瀏覽器擋下了新視窗，請允許彈出視窗'); },
  projExit:function(){ V.proj = false; try{ if(document.fullscreenElement) document.exitFullscreen(); }catch(e){} render(); },
  publishPrompt:function(){
    var t = P.cleanQ(($('pIn') || {}).value, 54); if(!t){ toast('請輸入題目'); return; }
    var r = curRound();
    if(r.prompt && r.prompt !== t && Object.keys(r.words).length){ V.pendingPrompt = t; openModal('<h2>這一題已經有人回答了</h2><p>改題目會讓前面的答案對不上。建議按「➕ 下一題」開新的一題。</p><div class="stack"><button class="btn red" data-act="promptNew">開新的一題並發布</button><button class="btn alt" data-act="promptKeep">只改文字（保留答案）</button><button class="btn alt" data-act="close">取消</button></div>'); return; }
    ACT.setPrompt(t);
  },
  setPrompt:function(t){ var r = curRound(); r.prompt = t; queueChats([P.encPrompt(G.round, t)], 'prompt', true); if(!G.cfg.open){ G.cfg.open = true; } T.push(); saveG(); render(); toast('已發布題目'); },
  promptNew:function(){ closeModal(); ACT.nextRound(true); ACT.setPrompt(V.pendingPrompt); },
  promptKeep:function(){ closeModal(); ACT.setPrompt(V.pendingPrompt); },
  pickPrompt:function(el){ var i = $('pIn'); if(i){ i.value = P.PROMPTS[+el.dataset.i]; i.focus(); } },
  nextRound:function(silent){
    if(G.round >= 99){ toast('最多 99 題，請開「新的一場」'); return; }
    var r = curRound(); if(!r.prompt && !Object.keys(r.words).length){ if(silent !== true) toast('這一題還是空的，直接輸入題目就好'); return; }
    G.round++; G.rounds[G.round] = newRound(); V.vr = 0; T.push(); saveG(); if(silent !== true){ render(); var i = $('pIn'); if(i) i.focus(); }
  },
  viewRound:function(el){ var r = +el.dataset.r; V.vr = r === G.round ? 0 : r; render(); },
  wordMenu:function(el){
    var vr = viewRound(), r = vr.r, items = cloudItems(r), it = items.filter(function(x){ return x.key === el.dataset.k; })[0]; if(!it) return;
    V.word = {k:it.key, r:vr.no};
    var forms = []; Object.keys(r.words).forEach(function(s){ r.words[s].forEach(function(w){ var k = P.wordKey(w), g = 0; while(r.merge[k] && g++ < 20) k = r.merge[k]; if(k === it.key && forms.indexOf(w) < 0) forms.push(w); }); });
    openModal('<h2>「' + esc(it.text) + '」・' + it.n + ' 人</h2>' + (forms.length > 1 ? '<p class="lead">包含：' + forms.map(esc).join('、') + '</p>' : '') +
      '<div class="stack"><button class="btn red" data-act="wordHide">🙈 從文字雲隱藏</button></div>' +
      (items.length > 1 ? '<label class="fld" style="margin-top:.8rem">合併到另一個意思相同的詞<select id="mergeTo">' + items.filter(function(x){ return x.key !== it.key; }).map(function(x){ return '<option value="' + esc(x.key) + '">' + esc(x.text) + '（' + x.n + '）</option>'; }).join('') + '</select></label><div class="stack"><button class="btn alt" data-act="wordMerge">🔗 合併</button></div>' : '') +
      '<div class="stack"><button class="btn alt" data-act="close">取消</button></div>');
  },
  wordHide:function(){ var w = V.word, r = G.rounds[w.r]; r.hidden[w.k] = 1; saveG(); closeModal(); T.paint(); },
  wordMerge:function(){ var w = V.word, r = G.rounds[w.r], to = ($('mergeTo') || {}).value; if(!to || to === w.k) return; r.merge[w.k] = to; saveG(); closeModal(); T.paint(); toast('已合併'); },
  unhideAll:function(){ viewRound().r.hidden = {}; saveG(); T.paint(); },
  unmergeAll:function(){ viewRound().r.merge = {}; saveG(); T.paint(); },
  pngCloud:function(){ var vr = viewRound(); if(!cloudItems(vr.r).length){ toast('文字雲還是空的'); return; } exportCloud(vr.r, vr.no).toBlob(function(b){ saveBlob(fileBase() + '文字雲第' + vr.no + '題_' + today() + '.png', b); }); },
  csvQ:function(){ if(!qArr().length){ toast('還沒有問題'); return; } downloadCsv(fileBase() + '提問紀錄_' + today() + '.csv', csvQ()); },
  csvW:function(){ downloadCsv(fileBase() + '文字雲_' + today() + '.csv', csvW()); },
  printRec:function(){ printRec(); },
  newSession:function(){ openModal('<h2>🔄 開新的一場？</h2><p>這間教室的問題、讚和文字雲會全部清空（代碼不變，學生不用重新加入）。需要留存請先列印或下載 CSV。</p><div class="stack"><button class="btn red" data-act="newSessionYes">清空，開新的一場</button><button class="btn alt" data-act="close">取消</button></div>'); },
  newSessionYes:function(){ closeModal(); var keep = {room:G.room, cid:G.cid, cfg:G.cfg, netOff:G.netOff, locked:G.locked, allow:G.allow, kicked:G.kicked, banned:G.banned}; G = Object.assign(newEvent(G.cfg, G.room, G.cid), keep); G.cfg.open = true; V.filter = 'open'; V.vr = 0; saveG(); T.push(); render(); toast('已開新的一場'); },
  room:function(){ if(!NET.want){ ACT.netOn(); return; } ACT.bigQR(); },
  lock:function(){ T.setLock(true); render(); toast('已關閉加入：新同學進不來，已在教室的不受影響'); },
  unlock:function(){ T.setLock(false); render(); toast('已開放加入，被擋下的同學按「再試一次」就能進來'); },
  bigQR:function(){ if(!NET.want) return; if(G && G.locked){ toast('目前關閉加入中，要先按「🔓 開放加入」'); return; } openModal('<div style="text-align:center"><h2>📱 掃描加入「' + esc(clsName()) + '」</h2><div class="qr" id="qrBig"></div><div style="font-size:3.2rem;font-weight:900;letter-spacing:.14em;color:var(--pin)">' + esc(NET.code) + '</div><p class="small">或打開 ' + esc(ONLINE.replace('https://', '')) + '?join 輸入代碼</p><div class="stack"><button class="btn alt" data-act="netOff">🚪 關閉教室（換新代碼）</button><button class="btn" data-act="close">關閉</button></div></div>', true); drawQR('qrBig', Math.min(420, window.innerWidth - 80, window.innerHeight - 300)); },
  netOn:function(){ if(G){ G.netOff = false; saveG(); } closeModal(); ensureNet(true); render(); },
  netOff:function(){ if(!G) return; guard(G.cid, {title:'🚪 關閉教室？', body:'<p>所有學生會離線，舊的 QR code 和連結從此失效。之後再開放會換一個新代碼。問題和文字雲會保留。</p>', btn:'關閉教室', danger:true}, function(){ ACT.netOffYes(); }); },
  netOffYes:function(){ closeModal(); netStop(true); if(G){ G.netOff = true; G.locked = false; G.kicked = {}; G.allow = {}; G.banned = {}; G.room = P.newRoom(); saveG(); } render(); },
  copyJoin:function(){ copyText(roomUrl(NET.code), '加入連結已複製'); },
  wipeAll:function(){
    var used = clsList().filter(function(c){ return clsInUse(c.id); }), locked = clsList().filter(function(c){ return hasPin(c.id); });
    if(used.length || locked.length){ openModal('<h2>🧹 不能一次清除</h2>' + (used.length ? '<p>使用中的教室：<b>' + used.map(function(c){ return esc(c.name); }).join('、') + '</b>。</p>' : '') + (locked.length ? '<p>有管理密碼的教室：<b>' + locked.map(function(c){ return esc(c.name); }).join('、') + '</b>。這些只能由開教室的人在首頁逐間刪除。</p>' : '') + '<div class="stack"><button class="btn" data-act="close">知道了</button></div>'); return; }
    openModal('<h2>確定嗎？</h2><p>所有教室的問題、文字雲、設定都會刪掉，無法復原（字體與音效設定會保留）。</p><div class="stack"><button class="btn red" data-act="wipeAllYes">清除全部資料</button><button class="btn alt" data-act="close">取消</button></div>');
  },
  wipeAllYes:function(){
    if(NET.want) netStop(NET.role === 'T');
    G = null; setUrl(null);
    var keep = {fs:1, fold:1, warnSeen:1, marquee:1, mute:1, who:1};
    try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf(PFX) === 0 && !keep[k.slice(PFX.length)]) localStorage.removeItem(k); }); }catch(e){}
    V.home = true; closeModal(); render(); toast('資料已清除');
  },
  mute:function(){ lsSet('mute', lsGet('mute') === '1' ? '0' : '1'); openSettings(); },
  foldall:function(){ var all = document.querySelectorAll('.set-sec'), any = [].some.call(all, function(d){ return !d.open; }); all.forEach(function(d){ d.open = any; }); }
};
function ensureNet(force){
  if(JOIN || PROJ || !G) return;
  if(NET.want && NET.code === G.room) return;
  if(!force && G.netOff) return;
  if(NET.want) netStop();
  NET.state = 'T|0'; netStart(G.room); T.push();
}

/* ---------- 警語、設定、安裝 ---------- */
var WARN_HTML = '<h2>⚠ 使用警語</h2><ul>' +
  '<li><b>匿名是對同學與投影畫面匿名</b>：同學之間、投影上都看不到是誰問的。但不是「完全無法追查」：手機連線有一組隨機代號，老師可以把洗版的人擋下（畫面上不顯示是誰）；開「記名」時老師看得到名字。請誠實告訴學生這個規則。</li>' +
  '<li>問題會經過轉播站的<b>不雅字詞過濾</b>與網址移除，但擋不住所有不當內容。在大型課堂或要投影時，建議開「<b>先審核再上牆</b>」。</li>' +
  '<li>請提醒學生<b>不要在問題裡寫身分證字號、電話、地址、他人隱私</b>等個人資料。</li>' +
  '<li>手機連線借用「創業島」的轉播站，只傳送問題、文字雲的詞、按讚的題號，以及開記名時學生自己填的名字（最多 8 個字）。<b>學生只看得到老師送出的內容</b>，看不到彼此。轉播站不儲存資料，離線就消失。</li>' +
  '<li>問題、文字雲、設定只存在老師這台電腦的瀏覽器。清除瀏覽器資料就會不見；需要留存請列印或下載 CSV。</li>' +
  '<li>網路不穩時，問題或讚可能延遲幾秒；人數很多時，新加入的手機要等一下才會看到全部問題。</li></ul>';
function showWarn(){ openModal(WARN_HTML + '<div class="stack"><button class="btn" data-act="close">我知道了</button></div>'); }
function sec(id, title, val, body){ return '<details class="set-sec" data-sec="' + id + '"><summary><span class="sst">' + title + '</span><span class="ssv">' + esc(val) + '</span></summary><div class="set-body">' + body + '</div></details>'; }
function openSettings(){
  var muted = lsGet('mute') === '1';
  var h = '<div class="top"><h2 style="flex:1 1 0">⚙ 常用設定</h2><button class="ibtn" data-act="foldall">全部展開／收合</button></div>' +
    sec('view', '顯示', lsGet('fs') === 'xl' ? '大字（投影用）' : '標準字', '<div class="stack"><button class="btn' + (lsGet('fs') === 'xl' ? ' alt' : '') + '" data-fontsize="m">標準字</button><button class="btn' + (lsGet('fs') === 'xl' ? '' : ' alt') + '" data-fontsize="xl">大字（投影用）</button></div>') +
    sec('sound', '音效', muted ? '關閉' : '開啟', '<div class="stack"><button class="btn alt" data-act="mute">' + (muted ? '🔊 打開音效' : '🔇 關閉音效') + '</button></div><p class="small">收到問題、聚焦、開放與暫停的提示音（瀏覽器合成，不載入音檔）。</p>') +
    (JOIN ? '' : sec('net', '手機連線', NET.want ? '代碼 ' + NET.code : '關閉', '<p class="small">借用創業島轉播站的教室模式，學生只看得到老師。</p><div class="stack">' + (NET.want ? '<button class="btn red" data-act="netOff">🚪 關閉教室（換新代碼）</button>' : (G ? '<button class="btn" data-act="netOn">📱 開放手機加入</button>' : '<p class="small">先進入一間教室。</p>')) + '</div>')) +
    (JOIN ? '' : sec('wipe', '🧹 清除全部資料', '', '<p class="small">清掉這台電腦上<b>所有教室</b>的問題、文字雲與設定。字體與音效設定會保留。</p><div class="stack"><button class="btn red" data-act="wipeAll">清除全部資料</button></div>')) +
    sec('about', '關於本工具', '', '<p>👤 創作者 Mark Tsai（蔡豐全）<br><a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a></p><div class="stack"><a class="btn alt" href="manual.html">📖 操作手冊</a><a class="btn alt" href="manual.html#creator">👤 創作者資訊</a><button class="btn alt" data-act="warn">⚠ 使用警語</button>' +
      (standalone ? '' : '<button class="btn alt" data-act="install">📲 加入主畫面</button>') + '</div><p class="small" style="margin-top:.5rem">訪客數 <img src="' + BADGE + '" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle"></p>') +
    '<div class="stack"><button class="btn" data-act="close">關閉</button></div>';
  openModal(h);
  var open = lsJson('fold', []);
  document.querySelectorAll('.set-sec').forEach(function(d){ d.open = open.indexOf(d.dataset.sec) >= 0; d.addEventListener('toggle', saveFold); });
}
function saveFold(){ var o = []; document.querySelectorAll('.set-sec').forEach(function(d){ if(d.open) o.push(d.dataset.sec); }); lsSet('fold', JSON.stringify(o)); }
function applyView(){ document.documentElement.dataset.fs = lsGet('fs') === 'xl' ? 'xl' : 'm'; }
function install(){
  if(window._dp){ window._dp.prompt(); window._dp = null; return; }
  openModal('<h2>📲 加入主畫面</h2><ul><li><b>iPhone／iPad（Safari）</b>：按下方「分享」→「加入主畫面」。</li><li><b>Android（Chrome）</b>：右上角「⋮」→「安裝應用程式」或「加到主畫面」。</li><li><b>電腦（Chrome／Edge）</b>：網址列右邊的安裝圖示。</li></ul><div class="stack"><button class="btn" data-act="close">知道了</button></div>');
}

/* =====================================================================
   學生（手機）端
   ===================================================================== */
var S = {
  code:'', room:'', T:null, tid:'', gid:0, wall:{}, counts:{}, likes:[], mine:[], echo:[], myW:{}, prompt:{round:0, text:''}, who:'', askWho:false, closed:0, whoSent:false, flash:'', showDone:false,
  myName:function(){ return P.encS(S.gid || 0, S.T && S.T.likes ? S.likes : []); },
  key:function(){ return 'st.' + S.code; },
  load:function(){ var d = lsJson(S.key(), null); if(d && d.gid){ S.gid = d.gid; S.wall = d.wall || {}; S.likes = d.likes || []; S.mine = d.mine || []; S.echo = d.echo || []; S.myW = d.myW || {}; S.prompt = d.prompt || {round:0, text:''}; S.counts = d.counts || {}; } },
  save:function(){ lsSet(S.key(), JSON.stringify({gid:S.gid, wall:S.wall, likes:S.likes, mine:S.mine, echo:S.echo, myW:S.myW, prompt:S.prompt, counts:S.counts})); },
  reset:function(gid){ S.gid = gid; S.wall = {}; S.likes = []; S.mine = []; S.echo = []; S.myW = {}; S.prompt = {round:0, text:''}; S.counts = {}; S.flash = ''; },
  start:function(code){
    S.code = code; S.room = lsGet('room.' + code) || ''; S.who = lsGet('who') || ''; S.closed = 0; S.load();
    netStart(code); renderStu();
  },
  onPeer:function(id, name){
    var t = P.decT(name); if(!t) return;
    S.tid = id;
    if(t.gid !== S.gid) S.reset(t.gid);
    var prev = S.T; S.T = t;
    if(t.named && !S.who) S.askWho = true;
    if(!t.likes) S.likes = [];
    S.likes = S.likes.filter(function(x){ var q = S.wall[x]; return !q || q.st === 'open'; });
    if(prev && !prev.open && t.open && t.mode === 'cloud'){ try{ navigator.vibrate && navigator.vibrate(100); }catch(e){} }
    if(t.named && S.who && !S.whoSent && NET.status === 'on'){ S.whoSent = true; queueChats([P.encWho(S.who)], 'who'); }
    S.save(); setName(S.myName()); renderSoon();
  },
  onChat:function(m){
    if(m.id === NET.myId){
      var q = P.decQ(m.text);
      if(q && q.gid === S.gid && S.echo.length < S.mine.length){ S.echo.push(q.text); S.save(); renderSoon(); }
      return;
    }
    if(S.tid && m.id !== S.tid) return;
    var t = m.text, v;
    if((v = P.decRoomName(t))){ S.room = v; lsSet('room.' + S.code, v); }
    else if((v = P.decA(t))){ v.forEach(function(x){ var o = S.wall[x.id]; S.wall[x.id] = {text:x.text, st:o ? o.st : 'open'}; }); }
    else if((v = P.decX(t))){ v.forEach(function(x){ if(S.wall[x.id]) S.wall[x.id].st = x.st; else if(x.st !== 'hidden') S.wall[x.id] = {text:'', st:x.st}; if(x.st !== 'open'){ S.likes = S.likes.filter(function(y){ return y !== x.id; }); } }); setName(S.myName()); }
    else if((v = P.decL(t))){ v.forEach(function(x){ S.counts[x.id] = x.n; }); }
    else if((v = P.decPrompt(t))){ S.prompt = v; }
    else return;
    S.save(); renderSoon();
  },
  isMine:function(text){ var k = P.wordKey(text); return S.mine.concat(S.echo).some(function(x){ return P.wordKey(x) === k; }); },
  shown:function(i){ return S.echo[i] || S.mine[i]; },
  onInput:function(t){ if(t.id === 'askIn'){ var c = $('askCnt'); if(c) c.textContent = Array.from(t.value).length + ' / ' + P.MAX_Q; } },
  click:function(el, ds){
    var act = ds.act;
    if(ds.like){
      var id = +ds.like, i = S.likes.indexOf(id);
      if(i >= 0) S.likes.splice(i, 1);
      else { if(S.likes.length >= P.MAX_LIKES){ toast('最多同時按 ' + P.MAX_LIKES + ' 個讚，先收回一個'); return true; } S.likes.push(id); snd('tick'); }
      S.save(); setName(S.myName()); renderStu(); return true;
    }
    if(act === 'ask'){
      var t = P.cleanQ(($('askIn') || {}).value), n = S.sentN();
      if(!t){ toast('請先打字'); return true; }
      if(S.T.qlimit && n >= S.T.qlimit){ toast('這一場每人最多問 ' + S.T.qlimit + ' 題'); return true; }
      if(S.isMine(t)){ toast('這題你已經問過了'); return true; }
      S.mine.push(t); S.save(); queueChats([P.encQ(S.gid, t)]);
      var a = $('askIn'); if(a) a.value = '';
      snd('ok'); S.flash = S.T.review ? '✅ 已送出，老師看過後會放上牆' : '✅ 已送出！'; renderStu(); return true;
    }
    if(act === 'sendWord'){
      var w = P.cleanWord(($('wordIn') || {}).value), r = S.T.round, mw = S.myW[r] = S.myW[r] || [];
      if(!w){ toast('請輸入一個詞'); return true; }
      if(mw.length >= S.T.wmax){ toast('這一題每人最多 ' + S.T.wmax + ' 個詞'); return true; }
      if(mw.some(function(x){ return P.wordKey(x) === P.wordKey(w); })){ toast('這個詞你送過了'); return true; }
      mw.push(w); S.save(); queueChats([P.encW(S.gid, r, w)]);
      var wi = $('wordIn'); if(wi){ wi.value = ''; wi.focus(); }
      snd('ok'); renderStu(); return true;
    }
    if(act === 'toggleDone'){ S.showDone = !S.showDone; renderStu(); return true; }
    if(act === 'saveWho'){ var who = P.cleanWho(($('whoIn') || {}).value); if(!who){ toast('請輸入學號或姓名'); return true; } S.who = who; lsSet('who', who); S.askWho = false; S.whoSent = false; if(NET.status === 'on'){ S.whoSent = true; queueChats([P.encWho(who)], 'who'); } renderStu(); return true; }
    if(act === 'editWho'){ S.askWho = true; renderStu(); return true; }
    if(act === 'retry'){ S.closed = 0; netStart(S.code); renderStu(); return true; }
    if(act === 'leave'){ netStop(); location.href = location.pathname + '?join'; return true; }
    if(act === 'joinCode'){ var c = String(($('codeIn') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if(c.length !== 6){ toast('代碼是 6 個英文字母或數字'); return true; } history.replaceState(null, '', location.pathname + '?join=' + c); S.start(c); return true; }
    return false;
  },
  sentN:function(){ return S.mine.length; }
};
var rsT = 0;
function renderSoon(){ if(rsT) return; rsT = setTimeout(function(){ rsT = 0; renderStu(); }, 80); }
function stuTop(){ return '<div class="top noprint"><h1>📌 課堂提問牆</h1><span class="ibtn" id="netChip">' + netChipHtml() + '</span><button class="ibtn" data-act="settings" aria-label="常用設定">⚙</button></div>'; }
function renderStu(){
  var h = '<div class="stu">' + stuTop() + (S.code && S.room && !S.closed ? '<div class="roomline">🏫 ' + esc(S.room) + '</div>' : ''), t = S.T;
  if(!S.code){
    h += '<section class="card pin"><h2>📱 加入課堂提問牆</h2><p class="lead">輸入老師投影上的 6 碼代碼。</p><div class="amtin"><input id="codeIn" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="例如 AB3K7Q" style="text-align:center;letter-spacing:.2em;text-transform:uppercase"><button class="btn red" data-act="joinCode">加入</button></div></section>';
  } else if(S.closed){
    h += '<section class="card pin"><h2>' + (S.closed === 4005 ? (t && t.locked ? '🔒 這個教室已關閉加入' : '🚫 你已被請出這個教室') : '🚪 教室已關閉，或老師還沒開放') + '</h2>' + (S.room ? '<p style="font-weight:900">🏫 ' + esc(S.room) + '</p>' : '') + '<p class="lead">' + (S.closed === 4005 && t && t.locked ? '老師暫停讓新同學加入。請跟老師確認，等老師開放後再按「再試一次」。' : '請看老師投影上的代碼是不是 <b>' + esc(S.code) + '</b>。') + '</p><div class="go"><button class="btn red" data-act="retry">再試一次</button><button class="btn alt" data-act="leave">輸入新代碼</button></div></section>';
  } else if(!t){
    h += '<section class="card pin"><p class="bigstate">' + (NET.status === 'on' ? '等老師開教室…' : '連線中…') + '</p></section>';
  } else if(t.named && S.askWho){
    h += '<section class="card pin"><h2>👤 你是誰？</h2><p class="lead">老師開了「記名」：填學號或姓名（最多 8 個字），<b>只有老師看得到</b>，同學和投影上看不到。不要填身分證字號或電話。</p><div class="amtin"><input id="whoIn" maxlength="8" value="' + esc(S.who) + '" placeholder="學號或姓名"><button class="btn red" data-act="saveWho">下一步</button></div></section>';
  } else if(t.mode === 'cloud'){
    h += stuCloud();
  } else {
    h += stuQa();
  }
  h += '<p class="foot">' + (t && t.named ? '老師看得到你的名字，同學看不到' : '同學和投影上都看不到是誰問的') + '・<a href="#" data-act="warn">使用警語</a></p></div>';
  var keep = {}; ['codeIn', 'whoIn', 'askIn', 'wordIn'].forEach(function(id){ var el = $(id); if(el && el.value) keep[id] = el.value; });
  keepFocus(function(){ $('app').innerHTML = h; Object.keys(keep).forEach(function(id){ var el = $(id); if(el) el.value = keep[id]; }); });
  var c = $('askCnt'), a = $('askIn'); if(c && a) c.textContent = Array.from(a.value).length + ' / ' + P.MAX_Q;
}
function stuQa(){
  var t = S.T, h = '', spot = t.spot && S.wall[t.spot];
  if(t.named) h += '<p class="small" style="margin:.4rem 0 0;color:#3B2A1E;font-weight:700">👤 ' + esc(S.who) + '　<a href="#" data-act="editWho">改名字</a></p>';
  if(spot && spot.text) h += '<div class="spotmini"><small>🎯 老師正在回答</small>' + esc(spot.text) + '</div>';
  var n = S.sentN(), left = t.qlimit ? Math.max(0, t.qlimit - n) : -1;
  if(!t.open) h += '<section class="card pin"><p class="bigstate">⏸ 老師暫停收問題</p><p class="lead" style="text-align:center">還是可以幫下面的問題按讚。</p></section>';
  else if(left === 0) h += '<section class="card pin"><p class="bigstate">✅ 你已經問了 ' + n + ' 題</p><p class="lead" style="text-align:center">這一場每人最多 ' + t.qlimit + ' 題。可以幫別人的問題按讚。</p></section>';
  else h += '<section class="card pin askbox"><h2>🙋 我想問</h2>' + (S.flash ? '<div class="alert ok">' + esc(S.flash) + '</div>' : '') + '<textarea id="askIn" maxlength="' + P.MAX_Q + '" placeholder="不懂的地方、想多聽的、好奇的都可以問"></textarea><div class="cnt"><span id="askCnt"></span><span>' + (left > 0 ? '還可以問 ' + left + ' 題' : '') + '</span></div><button class="btn red" data-act="ask">📨 送出問題</button></section>';
  // 自己送出、還沒上牆的
  var onWall = {}; Object.keys(S.wall).forEach(function(id){ onWall[P.wordKey(S.wall[id].text)] = 1; });
  var waiting = S.mine.map(function(x, i){ return S.shown(i); }).filter(function(x){ return !onWall[P.wordKey(x)]; });
  if(waiting.length) h += '<section class="card"><h3 style="margin:0">🕒 你送出的問題</h3>' + waiting.slice(-5).map(function(x){ return '<div class="sq mine"><div class="t">' + esc(x) + '<small>' + (S.T.review ? '等老師審核' : '送出中…') + '</small></div></div>'; }).join('') + '</section>';
  var ids = Object.keys(S.wall).map(Number).filter(function(id){ return S.wall[id].text; });
  var open = ids.filter(function(id){ return S.wall[id].st === 'open'; }), done = ids.filter(function(id){ return S.wall[id].st === 'done'; });
  open.sort(function(a, b){ return (S.counts[b] || 0) - (S.counts[a] || 0) || b - a; });
  var syncing = t.total > ids.length ? '<p class="small" style="text-align:center">正在接收問題…（' + ids.length + ' / ' + t.total + '）</p>' : '';
  h += '<section class="card pin"><h2>📌 牆上的問題 <small class="small">' + open.length + ' 題</small></h2>' + (t.likes ? '<p class="small" style="margin:.1rem 0 0">也想知道就按 👍（最多 ' + P.MAX_LIKES + ' 個，已用 ' + S.likes.length + ' 個）。最多人想問的排最前面。</p>' : '') + syncing +
    (open.length ? open.map(function(id){ return sqHtml(id); }).join('') : '<p class="lead" style="text-align:center;margin-top:.8rem">還沒有問題，你可以當第一個 🙋</p>') +
    (done.length ? '<div class="go"><button class="btn alt sm" data-act="toggleDone">' + (S.showDone ? '收起' : '看') + '已回答的 ' + done.length + ' 題</button></div>' + (S.showDone ? done.sort(function(a, b){ return b - a; }).map(function(id){ return sqHtml(id); }).join('') : '') : '') + '</section>';
  return h;
}
function sqHtml(id){
  var q = S.wall[id], t = S.T, mine = S.isMine(q.text), liked = S.likes.indexOf(id) >= 0, n = S.counts[id];
  var lb = q.st === 'open' && t.likes ? '<button class="likebtn" data-like="' + id + '" aria-pressed="' + liked + '"' + (!liked && S.likes.length >= P.MAX_LIKES ? ' disabled' : '') + '>👍' + (n != null && n > 0 ? '<small>' + n + '</small>' : '<small>' + (liked ? '已按' : '我也想知道') + '</small>') + '</button>' : '';
  return '<div class="sq' + (mine ? ' mine' : '') + (q.st === 'done' ? ' done' : '') + '"><div class="t">' + esc(q.text) + '<small>' + (mine ? '你問的・' : '') + (q.st === 'done' ? '✅ 已回答' : t.spot === id ? '🎯 正在回答' : '#' + id) + '</small></div>' + lb + '</div>';
}
function stuCloud(){
  var t = S.T, r = t.round, mw = S.myW[r] || [], prompt = S.prompt.round === r ? S.prompt.text : '';
  var h = '<section class="card pin"><div class="small">☁ 文字雲・第 ' + r + ' 題</div><div class="prompt">' + (prompt ? esc(prompt) : '<span class="small">等老師出題…</span>') + '</div></section>';
  if(!t.open) h += '<section class="card"><p class="bigstate">⏸ 老師暫停收集</p></section>';
  else if(mw.length >= t.wmax) h += '<section class="card"><p class="bigstate">✅ 送出了 ' + mw.length + ' 個詞</p><p class="lead" style="text-align:center">看投影上的文字雲吧！</p></section>';
  else h += '<section class="card"><h2>✍ 用一個詞回答</h2><p class="lead">每個詞最多 ' + P.MAX_WORD + ' 個字，這一題可以送 ' + t.wmax + ' 個（還剩 ' + (t.wmax - mw.length) + ' 個）。</p><div class="amtin"><input id="wordIn" maxlength="' + P.MAX_WORD + '" autocomplete="off" placeholder="例如：實用"><button class="btn red" data-act="sendWord">送出</button></div></section>';
  if(mw.length) h += '<section class="card"><h3 style="margin:0">你送出的</h3><div class="myw">' + mw.map(function(w){ return '<span>' + esc(w) + '</span>'; }).join('') + '</div></section>';
  return h;
}

/* ---------- 跑馬燈（工作區共用公告，不可關） ---------- */
function initMarquee(){
  var URL_ = "https://script.google.com/macros/s/AKfycbwKX0DNNbY8y4nf90BFTHtxgfqJcHHcZasRrgycl4QAe52_hkjMWSkYk4xOsqU-JPCROw/exec";
  var REFRESH = 20 * 60 * 1000, bar = $('marqueeBar'), track = $('marqueeTrack'), lastKey = null;
  function appendText(c, text){ var re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, li = 0, m; while((m = re.exec(text))){ if(m.index > li) c.appendChild(document.createTextNode(text.slice(li, m.index))); var a = document.createElement('a'); a.href = m[2]; a.textContent = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.color = 'inherit'; a.style.textDecoration = 'underline'; c.appendChild(a); li = re.lastIndex; } if(li < text.length) c.appendChild(document.createTextNode(text.slice(li))); }
  function renderM(items){
    if(!items || !items.length) return;
    var k = JSON.stringify(items); if(k === lastKey) return; lastKey = k; track.innerHTML = '';
    var fr = document.createDocumentFragment();
    function pass(){ items.forEach(function(it, i){ if(i > 0) fr.appendChild(document.createTextNode('　★　')); appendText(fr, String(it)); }); }
    pass(); fr.appendChild(document.createTextNode('　★　')); pass(); track.appendChild(fr);
    bar.classList.add('show'); document.body.classList.add('has-marquee');
    track.style.animationDuration = Math.max(track.scrollWidth / 2 / 60, 12) + 's';
  }
  function fetchM(){ fetch(URL_, {method:'POST', body:JSON.stringify({serial:''})}).then(function(r){ return r.json(); }).then(function(d){ if(d && Array.isArray(d.marquee) && d.marquee.length){ lsSet('marquee', JSON.stringify(d.marquee)); renderM(d.marquee); } }).catch(function(){}); }
  renderM(lsJson('marquee', [])); fetchM(); setInterval(fetchM, REFRESH);
}

window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); window._dp = e; });
if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(function(){});
(function(){ if(!window.SOC_WATERMARK) return; var w = document.createElement('div'); w.id = 'printWm'; w.setAttribute('aria-hidden', 'true'); w.innerHTML = '<img alt="" src="' + window.SOC_WATERMARK + '">'; document.body.appendChild(w); })();
applyView();
if(JOIN){
  var jc = String(QS.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(jc.length === 6) S.start(jc); else renderStu();
} else if(PROJ){
  // 只讀投影視窗：不搶教室、不連線，跟著 localStorage 更新
  var pc = QS.get('c');
  G = pc ? loadEvent(pc) : null; if(G) G.cid = pc;
  render();
  var pjT = 0;
  window.addEventListener('storage', function(e){
    if(!pc || e.key !== PFX + evKey(pc)) return;
    clearTimeout(pjT); pjT = setTimeout(function(){ var old = G; G = loadEvent(pc); if(!G) return; G.cid = pc; if(!old || old.room !== G.room || old.cfg.mode !== G.cfg.mode || old.locked !== G.locked || old.netOff !== G.netOff) render(); else paintProj(); }, 150);
  });
  setInterval(function(){ if(G && G.cfg.mode === 'qa') paintProj(); }, 30000);
} else {
  var qc = QS.get('c');
  if(qc && clsGet(qc)) enterCls(qc); else { setUrl(null); render(); }
  setInterval(function(){
    if(G){ if(lockBusy(G.cid)){ var nm = clsName(); leaveCls(false); render(); openModal('<h2>🏫 「' + esc(nm) + '」已改在另一個分頁開啟</h2><p>這個分頁已退出這間教室，避免兩邊同時改動資料。</p><div class="stack"><button class="btn" data-act="close">知道了</button></div>'); } else lockTake(G.cid); }
    var box = $('clsList');
    if(V.home && box && !modalOpen()){ var tmp = document.createElement('div'); tmp.innerHTML = clsListHtml(); if(tmp.firstChild.innerHTML !== box.innerHTML) box.innerHTML = tmp.firstChild.innerHTML; }
  }, 2000);
  setInterval(function(){ if(G && !V.home) T.paint(); }, 30000);   // 更新「幾分鐘前」
  if(!lsGet('warnSeen')){ lsSet('warnSeen', '1'); showWarn(); }
}
if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ if(!JOIN && G){ if(V.proj || PROJ) paintProj(); else drawHostCloud(); } });
initMarquee();
window.addEventListener('pagehide', function(){ if(G && !PROJ){ saveG(); lockFree(G.cid); } });
window._qaw = {get G(){ return G; }, set G(v){ G = v; }, T:T, S:S, NET:NET, ACT:ACT, render:render, V:V, P:P};
})();
