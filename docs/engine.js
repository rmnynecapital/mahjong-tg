/*
 * Mahjong engine — shared by the browser (offline bot games) and the Node server (online rooms).
 * Rules: 136 tiles (no flowers), Hong Kong-style claiming, 4 sets + 1 pair or seven pairs.
 *
 * Tile kinds 0..33:
 *   0-8  Characters 1-9   9-17 Dots 1-9   18-26 Bamboo 1-9
 *   27-30 East South West North           31-33 Red Green White dragons
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WIND_NAMES = ['East', 'South', 'West', 'North'];
  const DRAGON_NAMES = ['Red', 'Green', 'White'];
  const SUIT_NAMES = ['Characters', 'Dots', 'Bamboo'];
  const suitOf = (k) => (k / 9) | 0;
  const rankOf = (k) => (k % 9) + 1;
  const isHonor = (k) => k >= 27;
  const isDragon = (k) => k >= 31;

  function tileName(k) {
    if (k < 27) return `${rankOf(k)} ${SUIT_NAMES[suitOf(k)]}`;
    if (k < 31) return `${WIND_NAMES[k - 27]} Wind`;
    return `${DRAGON_NAMES[k - 31]} Dragon`;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function toCounts(tiles) {
    const c = new Array(34).fill(0);
    for (const t of tiles) c[t]++;
    return c;
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  // ---------- hand analysis ----------

  // Can counts c be split into exactly `need` sets (no pair)?
  function canSets(c, i, need) {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) return need === 0;
    if (need === 0) return false;
    if (c[i] >= 3) {
      c[i] -= 3; const ok = canSets(c, i, need - 1); c[i] += 3;
      if (ok) return true;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      const ok = canSets(c, i, need - 1);
      c[i]++; c[i + 1]++; c[i + 2]++;
      if (ok) return true;
    }
    return false;
  }

  function isSevenPairs(c) {
    let pairs = 0;
    for (let k = 0; k < 34; k++) {
      if (c[k] === 0) continue;
      if (c[k] !== 2) return false;
      pairs++;
    }
    return pairs === 7;
  }

  function isWinningCounts(c, nMelds) {
    const need = 4 - nMelds;
    if (sum(c) !== need * 3 + 2) return false;
    if (nMelds === 0 && isSevenPairs(c)) return true;
    for (let p = 0; p < 34; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2; const ok = canSets(c, 0, need); c[p] += 2;
      if (ok) return true;
    }
    return false;
  }

  // All decompositions into pair + sets (for scoring).
  function decompositions(c, need) {
    const out = [];
    const sets = [];
    function rec(i, pair) {
      while (i < 34 && c[i] === 0) i++;
      if (i === 34) { if (sets.length === need) out.push({ pair, sets: sets.slice() }); return; }
      if (sets.length >= need) return;
      if (c[i] >= 3) { c[i] -= 3; sets.push({ type: 'pung', tile: i }); rec(i, pair); sets.pop(); c[i] += 3; }
      if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ type: 'chow', tile: i });
        rec(i, pair);
        sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    for (let p = 0; p < 34; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2; rec(0, p); c[p] += 2;
    }
    return out;
  }

  // Shanten: number of tiles away from ready (-1 = complete hand).
  function shanten(c, nMelds) {
    const need = 4 - nMelds;
    let best = 8;
    function dfs(i, m, t, p) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) {
        const tt = Math.min(t, need - m);
        const s = 2 * (need - m) - tt - p;
        if (s < best) best = s;
        return;
      }
      if (best === -1) return;
      if (c[i] >= 3) { c[i] -= 3; dfs(i, m + 1, t, p); c[i] += 3; }
      if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (c[i] >= 2) {
        c[i] -= 2;
        if (!p) dfs(i, m, t, 1);
        if (m + t < need) dfs(i, m, t + 1, p);
        c[i] += 2;
      }
      if (m + t < need && i < 27) {
        if (i % 9 <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; dfs(i, m, t + 1, p); c[i]++; c[i + 1]++; }
        if (i % 9 <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; dfs(i, m, t + 1, p); c[i]++; c[i + 2]++; }
      }
      c[i]--; dfs(i, m, t, p); c[i]++;
    }
    dfs(0, 0, 0, 0);
    if (nMelds === 0) {
      let pairs = 0, kinds = 0;
      for (let k = 0; k < 34; k++) { if (c[k]) kinds++; if (c[k] >= 2) pairs++; }
      best = Math.min(best, 6 - pairs + Math.max(0, 7 - kinds));
    }
    return best;
  }

  // ---------- scoring ----------

  function scoreHand(closed, melds, ctx) {
    const c = toCounts(closed);
    const need = 4 - melds.length;
    const all = closed.concat(...melds.map((m) => m.tiles));
    const concealed = melds.every((m) => m.concealed);

    const common = [];
    if (ctx.selfDrawn) common.push(['Self-drawn', 1]);
    if (concealed) common.push(['Concealed hand', 1]);
    if (ctx.lastTile) common.push(['Win on the last tile', 1]);
    if (ctx.afterKong) common.push(['Win after a Kong', 1]);

    const suits = new Set(all.filter((k) => k < 27).map(suitOf));
    const honors = all.some(isHonor);
    if (suits.size === 0) common.push(['All honours', 10]);
    else if (suits.size === 1 && !honors) common.push(['Full flush', 6]);
    else if (suits.size === 1) common.push(['Half flush', 3]);

    let best = null;
    const consider = (items) => {
      const fan = items.reduce((a, [, f]) => a + f, 0);
      if (!best || fan > best.fan) best = { fan, items };
    };

    if (melds.length === 0 && isSevenPairs(c)) consider(common.concat([['Seven pairs', 4]]));

    for (const d of decompositions(c, need)) {
      const sets = d.sets.concat(melds.map((m) => ({ type: m.type === 'chow' ? 'chow' : 'pung', tile: m.tiles[0] })));
      const items = common.slice();
      const pungs = sets.filter((s) => s.type === 'pung');
      if (pungs.length === 4) items.push(['All pungs', 3]);
      if (pungs.length === 0 && !isHonor(d.pair)) items.push(['All chows', 1]);
      const dragonPungs = pungs.filter((s) => isDragon(s.tile)).length;
      if (dragonPungs === 3) items.push(['Big three dragons', 8]);
      else {
        if (dragonPungs === 2 && isDragon(d.pair)) items.push(['Small three dragons', 3]);
        for (const s of pungs) if (isDragon(s.tile)) items.push([`${DRAGON_NAMES[s.tile - 31]} dragon pung`, 1]);
      }
      for (const s of pungs) {
        if (s.tile === ctx.seatWind) items.push(['Seat wind pung', 1]);
        if (s.tile === ctx.prevailingWind) items.push(['Prevailing wind pung', 1]);
      }
      consider(items);
    }
    if (!best) return null;
    best.fan = Math.min(best.fan, 13);
    if (best.fan === 0) best.items = [['Chicken hand', 0]];
    return best;
  }

  const fanToPoints = (fan) => Math.min(8 * 2 ** fan, 1024);

  // ---------- game ----------

  class Game {
    constructor(opts) {
      this.rng = mulberry32(opts.seed != null ? opts.seed : (Math.random() * 2 ** 31) | 0);
      this.players = opts.players.map((p) => ({ name: p.name, score: 0 }));
      this.rounds = opts.rounds || 4;
      this.handNo = 0;
      this.phaseId = 0;
      this.seq = 0;
      this.history = [];
      this.startHand();
    }

    get dealer() { return this.handNo % 4; }
    get prevailing() { return 27 + (((this.handNo / 4) | 0) % 4); }
    seatWind(s) { return 27 + ((s - this.dealer + 4) % 4); }

    startHand() {
      const wall = [];
      for (let k = 0; k < 34; k++) for (let i = 0; i < 4; i++) wall.push(k);
      for (let i = wall.length - 1; i > 0; i--) {
        const j = (this.rng() * (i + 1)) | 0;
        [wall[i], wall[j]] = [wall[j], wall[i]];
      }
      this.wall = wall;
      for (const p of this.players) { p.hand = []; p.melds = []; p.discards = []; }
      for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) this.players[(this.dealer + s) % 4].hand.push(this.wall.shift());
      this.result = null;
      this.lastDiscard = null;
      this.ready = [false, false, false, false];
      this.lastAction = { type: 'start' };
      this.turn = this.dealer;
      this.draw(this.dealer, false);
    }

    draw(seat, fromBack) {
      const t = fromBack ? this.wall.pop() : this.wall.shift();
      this.players[seat].hand.push(t);
      this.drawn = t;
      this.canTsumo = true;
      this.afterKong = fromBack;
      this.turn = seat;
      this.phase = 'turn';
      this.phaseId++;
    }

    optionsFor(seat) {
      if (this.phase === 'turn' && seat === this.turn) {
        const p = this.players[seat];
        const c = toCounts(p.hand);
        const kongs = [];
        if (this.wall.length > 0) {
          for (let k = 0; k < 34; k++) if (c[k] === 4) kongs.push(k);
          for (const m of p.melds) if (m.type === 'pung' && c[m.tiles[0]] > 0) kongs.push(m.tiles[0]);
        }
        return { discard: true, tsumo: this.canTsumo && isWinningCounts(c, p.melds.length), kongs };
      }
      if (this.phase === 'claim' && this.claims[seat] && !(seat in this.responses)) return this.claims[seat];
      if (this.phase === 'handOver' && !this.ready[seat]) return { next: true };
      return null;
    }

    waitingSeats() {
      if (this.phase === 'turn') return [this.turn];
      if (this.phase === 'claim') return Object.keys(this.claims).map(Number).filter((s) => !(s in this.responses));
      if (this.phase === 'handOver') return [0, 1, 2, 3].filter((s) => !this.ready[s]);
      return [];
    }

    apply(seat, a) {
      if (!a || typeof a.type !== 'string') return { ok: false, error: 'bad action' };
      const o = this.optionsFor(seat);
      if (!o) return { ok: false, error: 'not your move' };
      const p = this.players[seat];

      if (this.phase === 'turn') {
        if (a.type === 'discard') {
          const idx = p.hand.indexOf(a.tile);
          if (idx < 0) return { ok: false, error: 'tile not in hand' };
          p.hand.splice(idx, 1);
          p.discards.push(a.tile);
          this.lastDiscard = { seat, tile: a.tile };
          this.drawn = null;
          this.afterKong = false;
          this.act(seat, 'discard', a.tile);
          this.claims = this.computeClaims(seat, a.tile);
          this.responses = {};
          if (Object.keys(this.claims).length === 0) this.nextTurn();
          else { this.phase = 'claim'; this.phaseId++; }
          return { ok: true };
        }
        if (a.type === 'tsumo' && o.tsumo) { this.win(seat, this.drawn, null); return { ok: true }; }
        if (a.type === 'kong' && o.kongs.includes(a.tile)) {
          const t = a.tile;
          const existing = p.melds.find((m) => m.type === 'pung' && m.tiles[0] === t);
          if (existing) {
            p.hand.splice(p.hand.indexOf(t), 1);
            existing.type = 'kong'; existing.tiles.push(t);
          } else {
            for (let i = 0; i < 4; i++) p.hand.splice(p.hand.indexOf(t), 1);
            p.melds.push({ type: 'kong', tiles: [t, t, t, t], concealed: true });
          }
          this.act(seat, 'kong', t);
          this.draw(seat, true);
          return { ok: true };
        }
        return { ok: false, error: 'illegal action' };
      }

      if (this.phase === 'claim') {
        if (a.type === 'chow') {
          if (!o.chows || !Array.isArray(a.tiles) || !o.chows.some((ch) => ch[0] === a.tiles[0] && ch[1] === a.tiles[1])) return { ok: false, error: 'illegal chow' };
        } else if (!o[a.type]) return { ok: false, error: 'illegal claim' };
        this.responses[seat] = a;
        if (this.waitingSeats().length === 0) this.resolveClaims();
        else this.seq++;
        return { ok: true };
      }

      if (this.phase === 'handOver' && a.type === 'next') {
        this.ready[seat] = true;
        this.seq++;
        if (this.ready.every(Boolean)) {
          this.handNo++;
          if (this.handNo >= this.rounds) { this.phase = 'matchOver'; this.phaseId++; this.seq++; }
          else this.startHand();
        }
        return { ok: true };
      }
      return { ok: false, error: 'illegal action' };
    }

    act(seat, type, tile) {
      this.lastAction = { seat, type, tile };
      this.seq++;
    }

    computeClaims(discarder, t) {
      const res = {};
      for (let s = 0; s < 4; s++) {
        if (s === discarder) continue;
        const p = this.players[s];
        const c = toCounts(p.hand);
        const o = {};
        c[t]++;
        if (isWinningCounts(c, p.melds.length)) o.ron = true;
        c[t]--;
        if (this.wall.length > 0) {
          if (c[t] >= 2) o.pung = true;
          if (c[t] >= 3) o.kong = true;
          if (s === (discarder + 1) % 4 && t < 27) {
            const r = t % 9, ch = [];
            if (r >= 2 && c[t - 2] && c[t - 1]) ch.push([t - 2, t - 1]);
            if (r >= 1 && r <= 7 && c[t - 1] && c[t + 1]) ch.push([t - 1, t + 1]);
            if (r <= 6 && c[t + 1] && c[t + 2]) ch.push([t + 1, t + 2]);
            if (ch.length) o.chows = ch;
          }
        }
        if (Object.keys(o).length) { o.pass = true; res[s] = o; }
      }
      return res;
    }

    resolveClaims() {
      const { seat: d, tile: t } = this.lastDiscard;
      const order = [1, 2, 3].map((i) => (d + i) % 4);
      const r = this.responses;
      for (const s of order) if (r[s] && r[s].type === 'ron') return this.win(s, t, d);
      for (const s of order) if (r[s] && (r[s].type === 'pung' || r[s].type === 'kong')) return this.claim(s, r[s]);
      for (const s of order) if (r[s] && r[s].type === 'chow') return this.claim(s, r[s]);
      this.nextTurn();
    }

    claim(s, a) {
      const { seat: d, tile: t } = this.lastDiscard;
      const p = this.players[s];
      this.players[d].discards.pop();
      const take = (k) => p.hand.splice(p.hand.indexOf(k), 1);
      if (a.type === 'pung') { take(t); take(t); p.melds.push({ type: 'pung', tiles: [t, t, t], from: d }); }
      else if (a.type === 'kong') { take(t); take(t); take(t); p.melds.push({ type: 'kong', tiles: [t, t, t, t], from: d }); }
      else { take(a.tiles[0]); take(a.tiles[1]); p.melds.push({ type: 'chow', tiles: [a.tiles[0], t, a.tiles[1]].sort((x, y) => x - y), from: d }); }
      this.lastDiscard = null;
      this.act(s, a.type, t);
      if (a.type === 'kong') { this.draw(s, true); return; }
      this.turn = s;
      this.drawn = null;
      this.canTsumo = false;
      this.phase = 'turn';
      this.phaseId++;
    }

    nextTurn() {
      if (this.wall.length === 0) return this.exhaust();
      this.draw((this.turn + 1) % 4, false);
    }

    win(seat, tile, from) {
      const p = this.players[seat];
      const selfDrawn = from == null;
      const closed = selfDrawn ? p.hand.slice() : p.hand.concat([tile]);
      const sc = scoreHand(closed, p.melds, {
        selfDrawn, lastTile: this.wall.length === 0, afterKong: selfDrawn && this.afterKong,
        seatWind: this.seatWind(seat), prevailingWind: this.prevailing,
      });
      const pts = fanToPoints(sc.fan);
      const deltas = [0, 0, 0, 0];
      if (selfDrawn) {
        for (let s = 0; s < 4; s++) if (s !== seat) { deltas[s] -= pts / 2; deltas[seat] += pts / 2; }
      } else { deltas[from] -= pts; deltas[seat] += pts; this.players[from].discards.pop(); }
      deltas.forEach((d, s) => (this.players[s].score += d));
      this.result = {
        type: 'win', winner: seat, from, tile, fan: sc.fan, items: sc.items, points: pts, deltas,
        hand: closed.sort((a, b) => a - b), melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
      };
      this.act(seat, selfDrawn ? 'tsumo' : 'ron', tile);
      this.endHand();
    }

    exhaust() {
      this.result = { type: 'draw', deltas: [0, 0, 0, 0] };
      this.act(null, 'exhaust');
      this.endHand();
    }

    endHand() {
      this.history.push({ handNo: this.handNo, result: this.result });
      this.phase = 'handOver';
      this.ready = [false, false, false, false];
      this.phaseId++;
    }

    view(seat) {
      const reveal = this.phase === 'handOver' || this.phase === 'matchOver';
      return {
        phase: this.phase, seq: this.seq, me: seat, turn: this.turn,
        handNo: this.handNo, rounds: this.rounds, dealer: this.dealer, prevailing: this.prevailing,
        wallCount: this.wall.length,
        lastDiscard: this.phase === 'claim' ? this.lastDiscard : null,
        lastAction: this.lastAction,
        players: this.players.map((p, i) => {
          let hand = null;
          if (i === seat || reveal) {
            hand = p.hand.slice().sort((a, b) => a - b);
            if (i === seat && this.phase === 'turn' && this.turn === seat && this.drawn != null) {
              hand.splice(hand.indexOf(this.drawn), 1); hand.push(this.drawn);
            }
          }
          return {
            name: p.name, score: p.score, wind: this.seatWind(i), handCount: p.hand.length, hand,
            drawnLast: i === seat && this.phase === 'turn' && this.turn === seat && this.drawn != null,
            melds: p.melds.map((m) => ({ type: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed })),
            discards: p.discards.slice(), ready: !!(this.ready && this.ready[i]),
          };
        }),
        options: this.optionsFor(seat),
        result: this.result,
      };
    }
  }

  // ---------- bots ----------

  function unseenCounts(g, seat) {
    const u = new Array(34).fill(4);
    for (const t of g.players[seat].hand) u[t]--;
    for (const p of g.players) {
      for (const t of p.discards) u[t]--;
      for (const m of p.melds) for (const t of m.tiles) u[t]--;
    }
    return u.map((x) => Math.max(0, x));
  }

  function bestDiscard(g, seat, level, rng) {
    const p = g.players[seat];
    const c = toCounts(p.hand);
    const n = p.melds.length;
    const kinds = [];
    for (let k = 0; k < 34; k++) if (c[k]) kinds.push(k);
    if (level === 'easy' && rng() < 0.3) return kinds[(rng() * kinds.length) | 0];
    const unseen = unseenCounts(g, seat);
    let best = null;
    for (const k of kinds) {
      c[k]--;
      const s = shanten(c, n);
      let uke = 0;
      if (level !== 'easy') {
        for (let j = 0; j < 34; j++) {
          if (!unseen[j]) continue;
          let near = c[j] > 0;
          if (!near && j < 27) for (let d = -2; d <= 2 && !near; d++) { const x = j + d; if (x >= 0 && x < 27 && suitOf(x) === suitOf(j) && c[x]) near = true; }
          if (!near && n === 0 && j >= 27) near = false;
          if (!near) continue;
          c[j]++;
          if (shanten(c, n) < s) uke += unseen[j];
          c[j]--;
        }
      }
      c[k]++;
      let bias = 0;
      if (isHonor(k)) bias = c[k] === 1 ? -0.6 : 0.4;
      else if (rankOf(k) === 1 || rankOf(k) === 9) bias = -0.3;
      const score = s * 1000 - uke - bias + rng() * 0.1;
      if (!best || score < best.score) best = { k, score };
    }
    return best.k;
  }

  // Best shanten reachable after making a claim and discarding.
  function shantenAfterClaim(hand, nMelds, remove) {
    const c = toCounts(hand);
    for (const t of remove) c[t]--;
    let best = 9;
    for (let k = 0; k < 34; k++) {
      if (!c[k]) continue;
      c[k]--; best = Math.min(best, shanten(c, nMelds + 1)); c[k]++;
    }
    return best;
  }

  function botAction(g, seat, level, rng) {
    level = level || 'normal';
    rng = rng || Math.random;
    const o = g.optionsFor(seat);
    if (!o) return null;
    const p = g.players[seat];
    if (g.phase === 'handOver') return { type: 'next' };
    if (g.phase === 'turn') {
      if (o.tsumo) return { type: 'tsumo' };
      for (const k of o.kongs) {
        const added = p.melds.some((m) => m.type === 'pung' && m.tiles[0] === k);
        if (added) return { type: 'kong', tile: k };
        const c = toCounts(p.hand);
        const before = shanten(c, p.melds.length);
        c[k] -= 4;
        // after a concealed kong we draw a replacement, so compare with one fewer set needed
        const after = shanten(c, p.melds.length + 1);
        if (after <= before) return { type: 'kong', tile: k };
      }
      return { type: 'discard', tile: bestDiscard(g, seat, level, rng) };
    }
    if (g.phase === 'claim') {
      if (o.ron) return { type: 'ron' };
      const t = g.lastDiscard.tile;
      const cur = shanten(toCounts(p.hand), p.melds.length);
      const valuable = isDragon(t) || t === g.seatWind(seat) || t === g.prevailing;
      if (level === 'easy') {
        if ((o.pung || o.kong) && rng() < 0.5) return { type: o.kong && rng() < 0.5 ? 'kong' : 'pung' };
        if (o.chows && rng() < 0.3) return { type: 'chow', tiles: o.chows[0] };
        return { type: 'pass' };
      }
      if (o.kong) {
        const c = toCounts(p.hand); c[t] -= 3;
        if (shanten(c, p.melds.length + 1) <= cur) return { type: 'kong' };
      }
      if (o.pung) {
        const after = shantenAfterClaim(p.hand, p.melds.length, [t, t]);
        if (after < cur || (valuable && after <= cur)) return { type: 'pung' };
      }
      if (o.chows) {
        for (const ch of o.chows) {
          const after = shantenAfterClaim(p.hand, p.melds.length, ch);
          if (after < cur && cur <= 3) return { type: 'chow', tiles: ch };
        }
      }
      return { type: 'pass' };
    }
    return null;
  }

  // ---------- table: game + bot/timeout scheduling ----------

  class Table {
    /**
     * seats: [{name, isBot, level}] x4
     * timeouts: null (no timeouts) or {turn, claim, handOver} in ms for humans
     */
    constructor(opts) {
      this.seats = opts.seats.map((s) => ({ ...s }));
      this.botDelay = opts.botDelay != null ? opts.botDelay : 700;
      this.timeouts = opts.timeouts || null;
      this.onChange = opts.onChange || (() => {});
      this.game = new Game({ players: this.seats, rounds: opts.rounds, seed: opts.seed });
      this.auto = [false, false, false, false];
      this.misses = [0, 0, 0, 0];
      this.timers = [];
      this.deadlines = {};
      this.schedPid = -1;
      this.scheduled = new Set();
      this.destroyed = false;
    }

    start() { this.changed(); }

    act(seat, action, isAuto) {
      if (this.destroyed) return { ok: false, error: 'table closed' };
      const r = this.game.apply(seat, action);
      if (r.ok) {
        if (!isAuto && !this.seats[seat].isBot) { this.auto[seat] = false; this.misses[seat] = 0; }
        delete this.deadlines[seat];
        this.changed();
      }
      return r;
    }

    setAway(seat, away) {
      this.seats[seat].away = away;
      if (away) this.auto[seat] = true;
      this.scheduled.delete(seat);
      this.schedule();
      this.onChange();
    }

    changed() {
      this.schedule();
      this.onChange();
    }

    schedule() {
      if (this.destroyed) return;
      const g = this.game;
      const pid = g.phaseId;
      if (this.schedPid !== pid) {
        this.timers.forEach(clearTimeout);
        this.timers = [];
        this.scheduled = new Set();
        this.deadlines = {};
        this.schedPid = pid;
      }
      for (const s of g.waitingSeats()) {
        if (this.scheduled.has(s)) continue;
        const info = this.seats[s];
        const robot = info.isBot || this.auto[s];
        let delay = null;
        if (robot) {
          if (g.phase === 'handOver') delay = info.isBot ? 400 : 1500;
          else delay = this.botDelay * (g.phase === 'claim' ? 0.6 : 1) * (0.8 + Math.random() * 0.5);
        } else if (this.timeouts && this.timeouts[g.phase]) {
          delay = this.timeouts[g.phase];
          this.deadlines[s] = Date.now() + delay;
        }
        if (delay == null) continue;
        this.scheduled.add(s);
        const t = setTimeout(() => {
          if (this.destroyed || this.game.phaseId !== pid || !this.game.waitingSeats().includes(s)) return;
          if (!info.isBot && !this.auto[s]) {
            this.misses[s]++;
            if (this.misses[s] >= 2) this.auto[s] = true;
          }
          const a = botAction(this.game, s, info.isBot ? info.level : 'normal');
          if (a) this.act(s, a, true);
        }, delay);
        this.timers.push(t);
      }
    }

    view(seat) {
      const v = this.game.view(seat);
      v.seats = this.seats.map((s, i) => ({ isBot: !!s.isBot, auto: this.auto[i], away: !!s.away }));
      const dl = this.deadlines[seat];
      v.timeLeft = dl ? Math.max(0, dl - Date.now()) : null;
      return v;
    }

    destroy() {
      this.destroyed = true;
      this.timers.forEach(clearTimeout);
    }
  }

  return {
    Game, Table, botAction, shanten, toCounts, isWinningCounts, scoreHand, fanToPoints, tileName,
    suitOf, rankOf, isHonor, isDragon, WIND_NAMES,
  };
});
