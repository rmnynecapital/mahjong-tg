// Mahjong Telegram Mini App — client.
(function () {
  'use strict';
  const WA = window.Telegram && window.Telegram.WebApp;
  const tg = WA && WA.initData ? WA : null; // only when really opened inside Telegram
  const app = document.getElementById('app');
  const BOT_NAMES = ['Mei', 'Hao', 'Lin', 'Jun', 'Yue', 'Bao'];
  const WIND_LABEL = ['East', 'South', 'West', 'North'];

  const S = {
    screen: 'home', online: false, config: null, level: 'normal', rounds: 4,
    transport: null, view: null, lobby: null, sel: null, selKey: '', lastSeq: -1,
    callouts: {}, deadline: null, lobbyDeadline: null, busy: false, lastPhaseKey: '', resultSeen: -1, modal: null,
  };

  // ---------- utils ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tileHTML = (k, cls = '') => `<div class="tile ${cls}">${TileArt.face(k)}</div>`;
  const backHTML = (cls = '') => `<div class="tile back ${cls}"></div>`;
  const meldHTML = (m) => `<span class="meld">${m.tiles.map((t, i) => (m.concealed && (i === 0 || i === 3) ? backHTML() : tileHTML(t))).join('')}</span>`;
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const haptic = (kind, arg) => { try { if (tg && tg.HapticFeedback) tg.HapticFeedback[kind](arg); } catch { /* old client */ } };

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function myName() {
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return u ? u.first_name : 'You';
  }

  function devUser() {
    let id = store.get('mj_dev_id');
    if (!id) { id = Math.random().toString(36).slice(2, 10); store.set('mj_dev_id', id); }
    return `${id}|Guest-${id.slice(0, 4)}`;
  }

  function authHeaders() {
    return tg ? { 'X-Init-Data': tg.initData } : { 'X-Dev-User': devUser() };
  }

  async function api(path, body) {
    const r = await fetch('api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j = {};
    try { j = await r.json(); } catch { /* not json */ }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  function ask(message, okText = 'Leave') {
    return new Promise((resolve) => {
      if (tg && tg.showConfirm) { try { return tg.showConfirm(message, resolve); } catch { /* fall through */ } }
      S.modal = { message, okText, resolve };
      render();
    });
  }

  // ---------- transports ----------
  class Local {
    constructor({ level, rounds }) {
      this.opts = { level, rounds };
      const names = shuffle(BOT_NAMES);
      let pending = false;
      this.table = new MJ.Table({
        seats: [{ name: myName(), isBot: false }].concat([0, 1, 2].map((i) => ({ name: names[i], isBot: true, level }))),
        rounds, botDelay: 650,
        onChange: () => {
          if (pending) return;
          pending = true;
          queueMicrotask(() => { pending = false; setView(this.table.view(0)); });
        },
      });
      this.table.start();
    }
    async act(a) { const r = this.table.act(0, a); if (!r.ok) throw new Error(r.error); }
    leave() { this.table.destroy(); }
  }

  class Remote {
    constructor(code) {
      this.code = code;
      const q = new URLSearchParams({ code });
      if (tg) q.set('auth', tg.initData); else q.set('dev', devUser());
      this.es = new EventSource('api/stream?' + q);
      this.es.onmessage = (e) => onServer(JSON.parse(e.data));
      this.es.onerror = () => {
        if (this.es.readyState === 2 && S.transport === this) { toast('Connection to the room was lost'); goHome(); }
      };
    }
    act(a) { return api('action', { code: this.code, action: a }); }
    leave() { this.es.close(); api('leave', { code: this.code }).catch(() => {}); }
    close() { this.es.close(); }
  }

  function onServer(msg) {
    if (msg.kind === 'lobby') {
      S.screen = 'lobby'; S.lobby = msg;
      S.lobbyDeadline = msg.startsIn != null ? Date.now() + msg.startsIn : null;
      render();
    } else if (msg.kind === 'game') {
      S.screen = 'game'; setView(msg.view);
    } else if (msg.kind === 'closed') {
      toast('The room was closed'); goHome();
    } else if (msg.kind === 'error') {
      toast(msg.error); goHome();
    }
  }

  function setView(v) {
    S.view = v;
    S.screen = 'game';
    const me = v.me;
    if (v.seq !== S.lastSeq) {
      S.lastSeq = v.seq;
      const la = v.lastAction || {};
      const words = { pung: 'Pung!', kong: 'Kong!', chow: 'Chow!', ron: 'Mahjong!', tsumo: 'Mahjong!' };
      if (words[la.type] && la.seat != null) {
        S.callouts[la.seat] = { text: words[la.type], until: Date.now() + 1500 };
        setTimeout(render, 1550);
        if (la.seat !== me) haptic('impactOccurred', 'medium');
      }
    }
    const o = v.options;
    const phaseKey = `${v.handNo}:${v.phase}:${v.turn}:${v.lastDiscard ? v.lastDiscard.tile : ''}:${v.players[me].handCount}`;
    if (phaseKey !== S.lastPhaseKey) {
      S.lastPhaseKey = phaseKey;
      if (o && (o.ron || o.tsumo)) haptic('notificationOccurred', 'success');
      else if (o && (o.pung || o.kong || o.chows)) haptic('notificationOccurred', 'warning');
      else if (o && o.discard) haptic('selectionChanged');
    }
    if (v.phase === 'handOver' && v.result && S.resultSeen !== v.handNo) {
      S.resultSeen = v.handNo;
      if (v.result.type === 'win') haptic('notificationOccurred', v.result.winner === me ? 'success' : 'error');
    }
    const key = (v.players[me].hand || []).join(',') + '|' + v.phase;
    if (key !== S.selKey) { S.selKey = key; S.sel = null; }
    S.deadline = v.timeLeft != null ? Date.now() + v.timeLeft : null;
    render();
  }

  // ---------- navigation ----------
  function goHome() {
    if (S.transport && S.transport.close) S.transport.close();
    S.transport = null; S.view = null; S.lobby = null; S.screen = 'home';
    S.lastSeq = -1; S.resultSeen = -1; S.callouts = {};
    render();
    if (S.online) refreshConfig();
  }

  function startLocal() {
    if (S.transport) S.transport.leave();
    S.lastSeq = -1; S.resultSeen = -1; S.callouts = {};
    store.set('mj_level', S.level); store.set('mj_rounds', String(S.rounds));
    S.transport = new Local({ level: S.level, rounds: S.rounds });
  }

  function enterRoom(code) {
    if (S.transport && S.transport.close) S.transport.close();
    S.lastSeq = -1; S.resultSeen = -1; S.callouts = {};
    S.transport = new Remote(code);
    S.screen = 'loading'; render();
  }

  async function withBusy(fn) {
    if (S.busy) return;
    S.busy = true; render();
    try { await fn(); } catch (e) { toast(e.message); } finally { S.busy = false; render(); }
  }

  async function leaveCurrent() {
    const inGame = S.screen === 'game' && S.view && S.view.phase !== 'matchOver';
    if (inGame && !(await ask(S.transport instanceof Remote ? 'Leave the game? A bot will take your seat.' : 'Quit this game?'))) return;
    if (S.transport) S.transport.leave();
    S.transport = null;
    goHome();
  }

  function inviteLink(code) {
    const c = S.config || {};
    if (c.botUsername && c.appShortName) return `https://t.me/${c.botUsername}/${c.appShortName}?startapp=${code}`;
    if (c.botUsername) return `https://t.me/${c.botUsername}?start=room_${code}`;
    return `${location.origin}${location.pathname}?room=${code}`;
  }

  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast(text));
    else toast(text);
  }

  // ---------- event handling ----------
  const handlers = {
    level: (d) => { S.level = d.v; render(); },
    rounds: (d) => { S.rounds = Number(d.v); render(); },
    playBots: () => startLocal(),
    quick: () => withBusy(async () => { const r = await api('quick', {}); enterRoom(r.code); }),
    create: () => withBusy(async () => { const r = await api('create', { level: S.level, rounds: S.rounds }); enterRoom(r.code); }),
    join: () => {
      const code = (document.getElementById('codeInput').value || '').trim().toUpperCase();
      if (code.length !== 5) return toast('Room codes have 5 characters');
      withBusy(async () => { const r = await api('join', { code }); enterRoom(r.code); });
    },
    resume: () => enterRoom(S.config.activeRoom),
    start: () => withBusy(() => api('start', { code: S.lobby.code })),
    invite: () => {
      const link = inviteLink(S.lobby.code);
      if (tg && S.config && S.config.botUsername) {
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Join my Mahjong table! Room ${S.lobby.code}`)}`);
      } else copy(link);
    },
    copyCode: () => copy(S.lobby.code),
    leave: () => leaveCurrent(),
    tile: (d) => {
      const v = S.view;
      if (!v.options || !v.options.discard) return;
      const i = Number(d.i);
      if (S.sel === i) return discard(v.players[v.me].hand[i]);
      S.sel = i; haptic('selectionChanged'); render();
    },
    discardSel: () => discard(S.view.players[S.view.me].hand[S.sel]),
    do: (d) => {
      const a = { type: d.type };
      if (d.tile) a.tile = Number(d.tile);
      if (d.tiles) a.tiles = d.tiles.split(',').map(Number);
      send(a);
    },
    again: () => { if (S.transport instanceof Local) { const o = S.transport.opts; S.level = o.level; S.rounds = o.rounds; startLocal(); } else goHome(); },
    home: () => { if (S.transport && S.transport.leave) S.transport.leave(); S.transport = null; goHome(); },
    modalOk: () => { const m = S.modal; S.modal = null; render(); m.resolve(true); },
    modalCancel: () => { const m = S.modal; S.modal = null; render(); m.resolve(false); },
  };

  function discard(tile) {
    haptic('impactOccurred', 'light');
    S.sel = null;
    send({ type: 'discard', tile });
  }

  function send(a) {
    if (!S.transport) return;
    Promise.resolve(S.transport.act(a)).catch((e) => toast(e.message));
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const h = handlers[el.dataset.act];
    if (h) h(el.dataset, el);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'codeInput') handlers.join(); });

  // ---------- rendering ----------
  function render() {
    let html = '';
    if (S.screen === 'home') html = renderHome();
    else if (S.screen === 'lobby') html = renderLobby();
    else if (S.screen === 'game' && S.view) html = renderGame();
    else html = `<div class="screen"><div class="hero"><p>Connecting…</p></div></div>`;
    if (S.modal) html += `<div class="overlay"><div class="sheet"><h2 style="font-size:18px">${esc(S.modal.message)}</h2><div style="height:12px"></div>
      <button class="btn" data-act="modalOk">${esc(S.modal.okText)}</button><button class="btn alt" data-act="modalCancel">Cancel</button></div></div>`;
    const inputVal = document.getElementById('codeInput') ? document.getElementById('codeInput').value : '';
    app.innerHTML = html;
    const inp = document.getElementById('codeInput');
    if (inp) inp.value = inputVal;
    syncTelegramChrome();
    tick();
  }

  function seg(name, options, current) {
    return `<div class="seg">${options.map(([v, label]) => `<button data-act="${name}" data-v="${v}" class="${String(current) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  }

  function renderHome() {
    const c = S.config || {};
    const fan = [31, 0, 13, 22, 27, 32].map((k, i) => `<div class="tile" style="transform: rotate(${(i - 2.5) * 6}deg) translateY(${Math.abs(i - 2.5) * 4}px)">${TileArt.face(k)}</div>`).join('');
    return `<div class="screen">
      <div class="hero"><div class="fan">${fan}</div><h1>Mahjong</h1><p>Classic four-player mahjong</p></div>
      ${c.activeRoom ? `<button class="btn" style="margin-top:12px" data-act="resume">↩︎ Return to your game (${esc(c.activeRoom)})</button>` : ''}
      <div class="card">
        <h2>🤖 Play vs bots</h2>
        <p class="sub">Three computer opponents. Works offline.</p>
        <div class="label">Bot strength</div>
        ${seg('level', [['easy', 'Easy'], ['normal', 'Normal']], S.level)}
        <div class="label">Match length</div>
        ${seg('rounds', [[4, 'Short · 4 hands'], [8, 'Long · 8 hands']], S.rounds)}
        <button class="btn" data-act="playBots">Play</button>
      </div>
      <div class="card">
        <h2>🌏 Play people</h2>
        ${S.online ? `
          <p class="sub">Quick match finds other players. Empty seats are filled by bots after 20 seconds.</p>
          <button class="btn" data-act="quick" ${S.busy ? 'disabled' : ''}>Quick match</button>
          <button class="btn alt" data-act="create" ${S.busy ? 'disabled' : ''}>Create private room</button>
          <div class="row" style="margin-top:8px"><input id="codeInput" class="code" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters">
            <button class="btn alt" style="flex:.6" data-act="join" ${S.busy ? 'disabled' : ''}>Join</button></div>
          <p class="note">Private rooms use the bot strength and match length chosen above.</p>`
        : `<p class="sub">Online play needs the game server. Open this app from its Telegram bot to play with friends.</p>`}
      </div>
      <details class="rules"><summary>How to play</summary>
        <p>Build a winning hand of <b>14 tiles</b>: four sets plus one pair (or seven pairs).</p>
        <ul>
          <li><b>Pung</b>: three identical tiles. <b>Kong</b>: four identical tiles (you draw a replacement).</li>
          <li><b>Chow</b>: a run of three in one suit, e.g. 3-4-5 Dots. You can only chow the discard of the player on your left.</li>
          <li>On your turn you draw a tile, then tap a tile twice to discard it.</li>
          <li>When someone discards a tile you need, buttons appear to claim it. Mahjong beats Pung/Kong, which beat Chow.</li>
        </ul>
        <p><b>Scoring (fan):</b> self-drawn 1, concealed hand 1, all chows 1, dragon pung 1, seat/prevailing wind pung 1, all pungs 3, half flush 3, small three dragons 3, seven pairs 4, full flush 6, big three dragons 8, all honours 10. Points = 8 × 2<sup>fan</sup> (max 1024). The discarder pays on a claimed win; on a self-drawn win each opponent pays half.</p>
      </details>
    </div>`;
  }

  function renderLobby() {
    const L = S.lobby;
    const seats = L.seats.map((s, i) => `<div class="seat ${s ? '' : 'empty'}"><span class="w">${TileArt.windChar(27 + i)}</span>
      <div class="n">${s ? esc(s.name) + (s.you ? ' (you)' : '') : 'Waiting…'}</div>
      <div class="h">${s ? (s.host ? 'Host' : 'Player') : 'Bot if empty'}</div></div>`).join('');
    const count = L.seats.filter(Boolean).length;
    return `<div class="screen">
      <div class="card">
        <h2 style="justify-content:center">${L.isPublic ? 'Quick match' : 'Private room'}</h2>
        <div class="code-big">${esc(L.code)}</div>
        <p class="sub" style="text-align:center">${L.isPublic
          ? `Looking for players… starting in <span class="timer" data-until="lobby">--</span>`
          : 'Invite friends with the button below, or share the code. Empty seats are filled by bots.'}</p>
        <div class="seats">${seats}</div>
        ${L.isPublic ? '' : `<button class="btn" data-act="invite">Invite friends</button><button class="btn alt" data-act="copyCode">Copy code</button>`}
        ${L.isHost && !L.isPublic ? `<button class="btn" style="margin-top:8px" data-act="start" ${S.busy ? 'disabled' : ''}>Start game${count < 4 ? ` · ${4 - count} bot${4 - count > 1 ? 's' : ''}` : ''}</button>` : ''}
        ${!L.isHost && !L.isPublic ? '<p class="note">Waiting for the host to start…</p>' : ''}
        <button class="btn alt" style="margin-top:8px" data-act="leave">Leave room</button>
      </div>
    </div>`;
  }

  function callout(s) {
    const c = S.callouts[s];
    return c && c.until > Date.now() ? `<div class="callout">${c.text}</div>` : '';
  }

  function renderGame() {
    const v = S.view, me = v.me, P = v.players, o = v.options;
    const right = (me + 1) % 4, across = (me + 2) % 4, left = (me + 3) % 4;
    const seats = v.seats || [];
    const la = v.lastAction || {};
    const isTurn = (s) => v.phase === 'turn' && v.turn === s;
    const windBadge = (s) => `<span class="wind ${v.dealer === s ? 'dealer' : ''}" title="${WIND_LABEL[P[s].wind - 27]} seat">${TileArt.windChar(P[s].wind)}</span>`;

    const opp = (s) => {
      const p = P[s], st = seats[s] || {};
      const tag = st.isBot ? '<span class="badge">BOT</span>' : st.away ? '<span class="badge">LEFT</span>' : st.auto ? '<span class="badge">AUTO</span>' : '';
      return `<div class="opp ${isTurn(s) ? 'turn' : ''}">${callout(s)}
        <div class="top">${windBadge(s)}<span class="nm">${esc(p.name)}</span>${tag}</div>
        <div class="meta"><span>${p.score} pts</span><span>${p.handCount} tiles</span></div>
        <div class="tiles">${p.melds.map(meldHTML).join('')}</div></div>`;
    };

    const pool = (s, pos) => {
      const d = P[s].discards;
      const hlLast = la.type === 'discard' && la.seat === s;
      return `<div class="pool tiles ${pos} ${pos === 'left' || pos === 'right' ? 'side' : ''} ${v.lastDiscard && v.lastDiscard.seat === s ? 'active' : ''}">
        ${d.map((t, i) => tileHTML(t, hlLast && i === d.length - 1 ? 'hl' : '')).join('')}</div>`;
    };

    let center = '';
    if (v.phase === 'claim' && v.lastDiscard) {
      const ld = v.lastDiscard;
      center = `<div class="big">${tileHTML(ld.tile, 'hl')}</div>
        <div class="who">${ld.seat === me ? 'You' : esc(P[ld.seat].name)} discarded</div>
        <div class="sub">${MJ.tileName(ld.tile)}</div>`;
    } else if (v.phase === 'turn') {
      center = `<div class="who">${v.turn === me ? 'Your turn' : esc(P[v.turn].name) + '’s turn'}</div>
        <div class="sub">${v.wallCount} tiles left in the wall</div>`;
    } else {
      center = `<div class="who">Hand over</div>`;
    }
    if (S.deadline) center += `<div class="timer" data-until="turn"></div>`;

    const myHand = P[me].hand || [];
    const canDiscard = o && o.discard;
    const hand = myHand.map((t, i) => {
      const cls = [S.sel === i ? 'sel' : '', P[me].drawnLast && i === myHand.length - 1 ? 'gap' : ''].join(' ');
      return `<div class="tile ${cls}" data-act="tile" data-i="${i}">${TileArt.face(t)}</div>`;
    }).join('');

    let hint = '';
    let actions = '';
    if (o && v.phase === 'turn') {
      hint = S.sel == null ? 'Your turn: tap a tile, then tap it again to discard' : `Tap again to discard ${MJ.tileName(myHand[S.sel])}`;
      if (o.tsumo) actions += `<button class="act win" data-act="do" data-type="tsumo">Mahjong! 🀄</button>`;
      for (const k of o.kongs || []) actions += `<button class="act" data-act="do" data-type="kong" data-tile="${k}">Kong ${tileHTML(k)}</button>`;
      if (S.sel != null) actions += `<button class="act" data-act="discardSel">Discard ${tileHTML(myHand[S.sel])}</button>`;
    } else if (o && v.phase === 'claim') {
      const t = v.lastDiscard.tile;
      hint = `Claim the ${MJ.tileName(t)}?`;
      if (o.ron) actions += `<button class="act win" data-act="do" data-type="ron">Mahjong! 🀄</button>`;
      if (o.kong) actions += `<button class="act" data-act="do" data-type="kong">Kong ${tileHTML(t)}</button>`;
      if (o.pung) actions += `<button class="act" data-act="do" data-type="pung">Pung ${tileHTML(t)}${tileHTML(t)}${tileHTML(t)}</button>`;
      for (const ch of o.chows || []) {
        const run = [ch[0], t, ch[1]].sort((a, b) => a - b);
        actions += `<button class="act" data-act="do" data-type="chow" data-tiles="${ch.join(',')}">Chow ${run.map((k) => tileHTML(k)).join('')}</button>`;
      }
      actions += `<button class="act pass" data-act="do" data-type="pass">Pass</button>`;
    } else if (v.phase === 'turn' || v.phase === 'claim') {
      hint = v.phase === 'claim' ? 'Waiting for claims…' : '';
    }

    const st = seats[me] || {};
    return `<div class="game">
      <div class="topbar">
        <div class="info"><span class="pill">${WIND_LABEL[v.prevailing - 27]} round</span><span class="pill">Hand ${Math.min(v.handNo + 1, v.rounds)}/${v.rounds}</span><span class="pill">Wall ${v.wallCount}</span></div>
        <button class="iconbtn" data-act="leave">✕</button>
      </div>
      <div class="opps">${opp(left)}${opp(across)}${opp(right)}</div>
      <div class="board">
        ${pool(across, 'top')}${pool(left, 'left')}<div class="center">${center}</div>${pool(right, 'right')}${pool(me, 'bottom')}
      </div>
      <div class="me" style="position:relative">${callout(me)}
        <div class="bar">${windBadge(me)}<span class="nm">${esc(P[me].name)}</span><span>${P[me].score} pts</span>${st.auto ? '<span class="badge">AUTO</span>' : ''}
          <div class="melds">${P[me].melds.map(meldHTML).join('')}</div></div>
        <div class="hand ${canDiscard ? '' : 'locked'}">${hand}</div>
        <div class="hint">${hint}</div>
      </div>
      <div class="actions">${actions}</div>
      ${v.phase === 'handOver' || v.phase === 'matchOver' ? renderResult() : ''}
    </div>`;
  }

  function scoreTable(deltas) {
    const v = S.view;
    return `<table class="scores">${v.players.map((p, i) => `<tr><td>${TileArt.windChar(p.wind)} ${esc(p.name)}${i === v.me && p.name !== 'You' ? ' (you)' : ''}</td>
      ${deltas ? `<td class="d ${deltas[i] > 0 ? 'pos' : deltas[i] < 0 ? 'neg' : ''}">${deltas[i] > 0 ? '+' : ''}${deltas[i] || '–'}</td>` : ''}
      <td><b>${p.score}</b></td></tr>`).join('')}</table>`;
  }

  function overlay(inner) {
    const key = `${S.view.phase}:${S.view.handNo}`;
    const anim = S.animKey !== key;
    S.animKey = key;
    return `<div class="overlay ${anim ? 'anim' : ''}"><div class="sheet">${inner}</div></div>`;
  }

  function renderResult() {
    const v = S.view, P = v.players, me = v.me;
    if (v.phase === 'matchOver') {
      const order = P.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
      const place = order.findIndex((p) => p.i === me);
      const medal = ['🥇', '🥈', '🥉', '🀄'][place];
      return overlay(`
        <div class="medal">${medal}</div>
        <h2>${place === 0 ? 'You won the match!' : `You finished ${['1st', '2nd', '3rd', '4th'][place]}`}</h2>
        <div class="subt">Final scores after ${v.rounds} hands</div>
        <table class="scores">${order.map((p, n) => `<tr><td>${n + 1}. ${esc(p.name)}${p.i === me && p.name !== 'You' ? ' (you)' : ''}</td><td><b>${p.score}</b></td></tr>`).join('')}</table>
        <button class="btn" data-act="again">${S.transport instanceof Local ? 'Play again' : 'Back to menu'}</button>
        ${S.transport instanceof Local ? '<button class="btn alt" data-act="home">Main menu</button>' : ''}`);
    }
    const r = v.result;
    const readyCount = P.filter((p) => p.ready).length;
    const last = v.handNo + 1 >= v.rounds;
    const btn = v.options && v.options.next
      ? `<button class="btn" data-act="do" data-type="next">${last ? 'Final results' : 'Next hand'}</button>`
      : `<button class="btn alt" disabled>Waiting for other players… (${readyCount}/4)</button>`;
    if (!r || r.type === 'draw') {
      return overlay(`<h2>Draw game</h2><div class="subt">The wall ran out with no winner.</div>${scoreTable(null)}${btn}`);
    }
    const winnerName = r.winner === me ? 'You' : esc(P[r.winner].name);
    let marked = false;
    const handTiles = r.hand.map((t) => { const w = !marked && t === r.tile; if (w) marked = true; return tileHTML(t, w ? 'win' : ''); }).join('');
    return overlay(`
      <h2>${r.winner === me ? 'Mahjong! You win 🎉' : `${winnerName} wins`}</h2>
      <div class="subt">${r.from == null ? 'Self-drawn' : `On ${r.from === me ? 'your' : esc(P[r.from].name) + '’s'} discard`} · ${MJ.tileName(r.tile)}</div>
      <div class="wh">${r.melds.map(meldHTML).join('')}${handTiles}</div>
      <div class="fans">${r.items.map(([n, f]) => `<div><span>${esc(n)}</span><span>${f} fan</span></div>`).join('')}
        <div class="tot"><span>${r.fan} fan</span><span>${r.points} pts</span></div></div>
      ${scoreTable(r.deltas)}
      ${btn}`);
  }

  function tick() {
    for (const el of document.querySelectorAll('[data-until]')) {
      const until = el.dataset.until === 'lobby' ? S.lobbyDeadline : S.deadline;
      if (!until) { el.textContent = ''; continue; }
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      el.textContent = el.dataset.until === 'lobby' ? `${s}s` : `⏱ ${s}s`;
    }
  }
  setInterval(tick, 500);

  function syncTelegramChrome() {
    if (!tg) return;
    try {
      const inGame = S.screen === 'game';
      tg.setHeaderColor(inGame ? '#0c3a27' : 'bg_color');
      if (S.screen === 'home') tg.BackButton.hide(); else tg.BackButton.show();
    } catch { /* older Telegram clients */ }
  }

  // ---------- boot ----------
  async function refreshConfig() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch('api/config', { headers: authHeaders(), signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      S.online = !!j.online; S.config = j;
    } catch { S.online = false; }
    if (S.screen === 'home') render();
  }

  async function boot() {
    S.level = store.get('mj_level') || 'normal';
    S.rounds = Number(store.get('mj_rounds')) || 4;
    if (tg) {
      tg.ready(); tg.expand();
      try { tg.disableVerticalSwipes(); } catch { /* Bot API < 7.7 */ }
      try { tg.BackButton.onClick(() => (S.screen === 'home' ? null : leaveCurrent())); } catch { /* ignore */ }
    }
    render();
    await refreshConfig();
    const startRoom = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || new URLSearchParams(location.search).get('room');
    if (startRoom && S.online) {
      withBusy(async () => { const r = await api('join', { code: startRoom.toUpperCase() }); enterRoom(r.code); });
    }
  }
  boot();
})();
