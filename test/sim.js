const MJ = require('../docs/engine.js');
const assert = require('assert');
// unit checks
const T = (s) => s.split(' ').map(Number);
assert(MJ.isWinningCounts(MJ.toCounts([0,1,2, 3,4,5, 6,7,8, 9,9,9, 27,27]), 0));
assert(!MJ.isWinningCounts(MJ.toCounts([0,1,2, 3,4,5, 6,7,8, 9,9,9, 27,28]), 0));
assert(MJ.isWinningCounts(MJ.toCounts([0,0,1,1,2,2,3,3,4,4,5,5,31,31]), 0));
assert.equal(MJ.shanten(MJ.toCounts([0,1,2, 3,4,5, 6,7,8, 9,9,9, 27]), 0), 0);
assert.equal(MJ.shanten(MJ.toCounts([0,1,2, 3,4,5, 6,7,8, 9,9,9, 27,27]), 0), -1);
const sc = MJ.scoreHand([0,1,2,3,4,5,6,7,8,0,0,0,8,8], [], {selfDrawn:true, seatWind:27, prevailingWind:27});
console.log('full flush score', sc);
// full games
let t0 = Date.now(), wins = 0, draws = 0, hands = 0, fans = {};
for (let g = 0; g < 60; g++) {
  const game = new MJ.Game({ players: [0,1,2,3].map(i => ({ name: 'P'+i })), rounds: 4, seed: g });
  let steps = 0;
  while (game.phase !== 'matchOver') {
    if (++steps > 5000) throw new Error('stuck');
    for (const s of game.waitingSeats()) {
      if (!game.waitingSeats().includes(s)) continue;
      const a = MJ.botAction(game, s, g % 2 ? 'easy' : 'normal');
      const r = game.apply(s, a);
      if (!r.ok) throw new Error(JSON.stringify({ r, a, phase: game.phase }));
      // invariant: tile conservation
      const total = game.wall.length + game.players.reduce((n, p) => n + p.hand.length + p.discards.length + p.melds.reduce((m, x) => m + x.tiles.length, 0), 0);
      if (game.phase !== 'handOver' && game.phase !== 'matchOver') assert.equal(total, 136);
      break;
    }
  }
  for (const h of game.history) { hands++; if (h.result.type === 'win') { wins++; for (const [n] of h.result.items) fans[n] = (fans[n]||0)+1; } else draws++; }
  assert.equal(game.players.reduce((a, p) => a + p.score, 0), 0);
}
console.log({ hands, wins, draws, ms: Date.now() - t0, msPerHand: (Date.now()-t0)/hands });
console.log(fans);
