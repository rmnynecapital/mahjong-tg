# 🀄 Mahjong: Telegram Mini App

Four-player mahjong that runs inside Telegram. Players can:

- **Play vs bots**: three AI opponents (Easy or Normal), 4 or 8 hands. Runs entirely on the phone.
- **Quick match**: get paired with other online players. Empty seats are filled by bots after 20 seconds.
- **Private room**: create a room, tap *Invite friends* to share a link in any Telegram chat, and start when ready. Bots fill any empty seats.

No dependencies. Needs Node.js 18 or newer.

## Project layout

```
docs/              the Mini App (static files; also served by GitHub Pages)
  index.html
  app.js           screens, game table, Telegram integration
  engine.js        rules, scoring, bot AI (shared with the server)
  tiles.js         tile artwork (SVG drawn in code, no image files)
  style.css
server/
  index.js         HTTP server, Telegram login check, rooms, live updates (Server-Sent Events)
  telegram.js      the bot: replies to /start with a "Play" button and sets the menu button
test/sim.js        rule checks + 60 bot-only matches (npm test)
```

## Run it locally

```bash
npm start            # http://localhost:3000
npm test             # engine checks + simulated games
```

Without `BOT_TOKEN` the server runs in **dev mode**: you can open it in a normal browser, and each browser tab acts as a guest player, so you can test online rooms with two browser windows.

## Put it on Telegram

1. **Create the bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. **Host the server on HTTPS.** Telegram only opens Mini Apps over `https://`. Any Node host works (Render, Railway, Fly.io, a VPS behind Caddy or nginx). For testing on your own machine you can use a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.
3. **Start it with your settings:**
   ```bash
   BOT_TOKEN=123456:ABC... WEBAPP_URL=https://your-domain.example npm start
   ```
   On startup the bot sets its menu button to open the game, and replies to `/start` with a **Play Mahjong** button.
4. **(Optional) Register a Mini App link.** In BotFather send `/newapp`, pick your bot, enter the same URL, and choose a short name (for example `play`). Then also set `APP_SHORT_NAME=play`. Invite links become `https://t.me/YourBot/play?startapp=ROOMCODE`, which open the game directly. Without it, invites use `https://t.me/YourBot?start=room_ROOMCODE`, where the bot replies with a "Join room" button.

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `BOT_TOKEN` | for Telegram | Bot token from BotFather. Also used to verify that every request really comes from a Telegram user. |
| `WEBAPP_URL` | for Telegram | Public `https://` address of this server. |
| `APP_SHORT_NAME` | no | Short name from BotFather `/newapp`, for direct invite links. |
| `PORT` | no | Defaults to 3000. |
| `DEV` | no | Set to `1` to allow browser guests even when `BOT_TOKEN` is set. Don't use this in production. |

## Rules used

Hong Kong-style mahjong with 136 tiles (no flowers or seasons).

- A winning hand is four sets (pung, kong or chow) plus a pair, or seven pairs.
- Discards can be claimed: **Mahjong** beats **Pung/Kong**, which beat **Chow**. Only the next player can chow.
- After a kong you draw a replacement tile from the back of the wall.
- **Scoring (fan):** self-drawn 1, concealed hand 1, all chows 1, dragon pung 1, seat or prevailing wind pung 1, win on last tile 1, win after kong 1, all pungs 3, half flush 3, small three dragons 3, seven pairs 4, full flush 6, big three dragons 8, all honours 10 (max 13).
- **Points** = 8 × 2^fan, capped at 1024. On a claimed win the discarder pays it all; on a self-drawn win each opponent pays half.
- The dealer rotates every hand. Hands 1-4 are the East round and 5-8 the South round.

## Online play details

- **Login:** the app sends Telegram's signed `initData`, and the server checks the signature against your bot token, so nobody can pretend to be someone else.
- **Fairness:** the server runs the game. Each player only receives their own tiles; opponents' hands are revealed only at the end of a hand.
- **Timers:** 25 s per turn, 10 s to claim a discard, 30 s between hands. When time runs out the AI plays for you. Miss twice and your seat switches to autopilot (marked AUTO) until you act again.
- **Leaving:** if you leave mid-game, a bot takes your seat. Reopening the app shows *Return to your game*.
- Rooms are kept in memory. Restarting the server ends running games. For several server instances you'd need shared storage (e.g. Redis) and sticky sessions.

## Ideas for next steps

- Flowers and seasons, a minimum-fan rule, or Riichi rules
- Leaderboards and match history (add a database)
- Telegram Stars entry fees or cosmetic tile sets
- Sound effects and discard animations
