// Reelogue Telegram bot — handles login via one-time tokens and first-time registration.
// Run standalone: `npm run bot`  (or set RUN_BOT=1 to run alongside the web server)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Bot, InputFile } = require('grammy');

const prisma = require('./src/db');
const { peekToken, createLoginToken } = require('./src/utils/token');
const tokenStore = require('./src/utils/token');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ---- premium emoji ids (from project style guide) ----
const E = {
  hooray: '6041731551845159060', // 🎉
  profile: '5870994129244131212', // 👤
  write: '5870753782874246579', // ✍
  check: '5870633910337015697', // ✅
  cross: '5870657884844462243', // ❌
  link: '5769289093221454192', // 🔗
  bot: '6030400221232501136', // 🤖
  smile: '5870764288364252592', // 🙂
  pencil: '5870676941614354370', // 🖋
  info: '6028435952299413210', // ℹ
};

function em(id, fallback) {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

function stripTgEmoji(html) {
  return html.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, '$1');
}

/**
 * Send a message with custom (premium) emoji + button icons.
 * Custom emoji in text and on buttons only render if the bot owner has Telegram
 * Premium (or the bot bought a Fragment username). If the API rejects them we
 * transparently retry a plain version so the bot never breaks.
 * buttons: array of rows; each row is array of {text, url?, callback_data?, emojiId?}
 */
async function send(ctx, html, buttons) {
  const build = (withCustom) => {
    if (!buttons) return undefined;
    return {
      inline_keyboard: buttons.map((row) =>
        row.map((b) => {
          const btn = { text: b.text };
          if (b.url) btn.url = b.url;
          if (b.callback_data) btn.callback_data = b.callback_data;
          if (withCustom && b.emojiId) btn.icon_custom_emoji_id = b.emojiId;
          return btn;
        })
      ),
    };
  };
  try {
    return await ctx.reply(html, { parse_mode: 'HTML', reply_markup: build(true) });
  } catch (e) {
    return ctx.reply(stripTgEmoji(html), { parse_mode: 'HTML', reply_markup: build(false) });
  }
}

// ---- in-memory registration state (per chat) ----
const pending = new Map(); // chatId -> { step, startToken, username }

// ---- avatar download ----
async function downloadAvatar(ctx, telegramId) {
  try {
    const photos = await ctx.api.getUserProfilePhotos(ctx.from.id, { limit: 1 });
    if (!photos.total_count) return null;
    const sizes = photos.photos[0];
    const fileId = sizes[sizes.length - 1].file_id;
    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `tg_${telegramId}.jpg`;
    fs.writeFileSync(path.join(dir, filename), buf);
    return `/uploads/${filename}`;
  } catch (e) {
    return null;
  }
}

// ---- emit a ready-to-use login link ----
async function sendLoginLink(ctx, user) {
  const token = await createLoginToken(user.id);
  const url = `${SITE_URL}/auth/callback?token=${token}`;
  await send(
    ctx,
    `${em(E.check, '✅')} <b>Готово, ${escapeHtml(user.displayName)}!</b>\n\n` +
      `${em(E.link, '🔗')} Нажмите кнопку ниже, чтобы войти на Reelogue.\n` +
      `<i>Ссылка одноразовая и действует 10 минут.</i>`,
    [[{ text: 'Войти на Reelogue', url, emojiId: E.link }]]
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- /start ----
bot.command('start', async (ctx) => {
  const payload = (ctx.match || '').trim();
  const telegramId = String(ctx.from.id);

  // Plain /start (no auth payload)
  if (!payload || !payload.startsWith('auth_')) {
    await send(
      ctx,
      `${em(E.bot, '🤖')} <b>Reelogue</b> — ваш кинодневник.\n\n` +
        `Чтобы войти, откройте сайт и нажмите ${em(E.profile, '👤')} «Войти через Telegram» — ` +
        `я пришлю одноразовую ссылку для входа.`,
      [[{ text: 'Открыть Reelogue', url: SITE_URL, emojiId: E.link }]]
    );
    return;
  }

  const startToken = payload.slice('auth_'.length);
  const rec = await peekToken(startToken, 'START');
  if (!rec) {
    await send(
      ctx,
      `${em(E.cross, '❌')} <b>Ссылка для входа устарела.</b>\n\n` +
        `Вернитесь на сайт и снова нажмите «Войти через Telegram».`
    );
    return;
  }

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (user) {
    // Existing user — clean up the start token and issue a login link.
    await prisma.authToken.delete({ where: { id: rec.id } }).catch(() => {});
    await sendLoginLink(ctx, user);
    return;
  }

  // New user — begin registration.
  pending.set(ctx.chat.id, { step: 'username', startToken });
  await send(
    ctx,
    `${em(E.hooray, '🎉')} <b>Добро пожаловать в Reelogue!</b>\n\n` +
      `Давайте создадим профиль. ${em(E.pencil, '🖋')} Придумайте <b>имя пользователя</b> ` +
      `(латиница, цифры и _, от 3 до 20 символов):`
  );
});

// ---- registration conversation ----
bot.on('message:text', async (ctx) => {
  const state = pending.get(ctx.chat.id);
  if (!state) return; // not in a flow
  const text = ctx.message.text.trim();

  if (state.step === 'username') {
    const username = text.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      await send(
        ctx,
        `${em(E.cross, '❌')} Имя должно содержать 3–20 символов: латиница, цифры и _.\nПопробуйте ещё раз:`
      );
      return;
    }
    const taken = await prisma.user.findUnique({ where: { username } });
    if (taken) {
      await send(ctx, `${em(E.cross, '❌')} <b>@${escapeHtml(username)}</b> уже занято. Выберите другое:`);
      return;
    }
    state.username = username;
    state.step = 'displayName';
    pending.set(ctx.chat.id, state);
    await send(
      ctx,
      `${em(E.check, '✅')} Отлично!\n\n` +
        `${em(E.smile, '🙂')} Теперь введите <b>отображаемое имя</b> — как вас будут видеть другие:`
    );
    return;
  }

  if (state.step === 'displayName') {
    const displayName = text.slice(0, 60);
    if (displayName.length < 1) {
      await send(ctx, `${em(E.cross, '❌')} Имя не может быть пустым. Введите отображаемое имя:`);
      return;
    }
    const telegramId = String(ctx.from.id);
    const avatarUrl = await downloadAvatar(ctx, telegramId);
    let user;
    try {
      user = await prisma.user.create({
        data: { telegramId, username: state.username, displayName, avatarUrl },
      });
    } catch (e) {
      pending.delete(ctx.chat.id);
      await send(ctx, `${em(E.cross, '❌')} Не удалось создать профиль. Попробуйте войти заново через сайт.`);
      return;
    }
    // consume the original start token, finish, issue login link
    await prisma.authToken
      .deleteMany({ where: { token: state.startToken } })
      .catch(() => {});
    pending.delete(ctx.chat.id);
    await sendLoginLink(ctx, user);
    return;
  }
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.start({
  onStart: (info) => console.log(`\n  Bot @${info.username} is running.\n`),
});

// expose for potential reuse
module.exports = bot;
