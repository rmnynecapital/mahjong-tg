// Minimal Telegram bot (long polling): answers /start with a button that opens the Mini App,
// and sets the chat menu button. Uses Node's built-in fetch (Node 18+).
'use strict';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');
let username = process.env.BOT_USERNAME || null;

async function api(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

function appUrl(room) {
  return room ? `${WEBAPP_URL}/?room=${encodeURIComponent(room)}` : `${WEBAPP_URL}/`;
}

async function onMessage(msg) {
  const text = msg.text || '';
  if (!text.startsWith('/start') && !text.startsWith('/play')) return;
  const payload = text.split(' ')[1] || '';
  const room = /^room_[A-Z0-9]{5}$/.test(payload) ? payload.slice(5) : null;
  await api('sendMessage', {
    chat_id: msg.chat.id,
    text: room
      ? `🀄 You've been invited to Mahjong room ${room}. Tap below to take your seat!`
      : '🀄 Welcome to Mahjong!\n\nPlay against bots, jump into a quick match, or create a private room and invite friends.',
    reply_markup: { inline_keyboard: [[{ text: room ? `Join room ${room}` : '🀄 Play Mahjong', web_app: { url: appUrl(room) } }]] },
  });
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch((e) => console.error('bot:', e.message));
      }
    } catch (e) {
      console.error('bot poll:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function start() {
  if (!BOT_TOKEN) return console.log('BOT_TOKEN not set: Telegram bot disabled.');
  if (!WEBAPP_URL.startsWith('https://')) return console.log('WEBAPP_URL must be an https:// URL: Telegram bot disabled.');
  try {
    const me = await api('getMe');
    username = me.username;
    await api('deleteWebhook', {});
    await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: appUrl() } } });
    console.log(`Telegram bot @${username} is running.`);
    poll();
  } catch (e) {
    console.error('Telegram bot failed to start:', e.message);
  }
}

module.exports = { start, botUsername: () => username };
