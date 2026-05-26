const express = require('express');
const router = express.Router();
const { createStartToken, consumeLoginToken, cleanupExpired } = require('../utils/token');

const BOT_USERNAME = process.env.BOT_USERNAME || 'ReelogueBot';

// Login page — the only thing an unauthenticated visitor sees.
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Войти' });
});

// Step 1: site generates a one-time START token and sends the user to the bot.
router.get('/auth/telegram', async (req, res) => {
  await cleanupExpired();
  const token = await createStartToken();
  const url = `https://t.me/${BOT_USERNAME}?start=auth_${token}`;
  res.redirect(url);
});

// Step 4: bot-generated LOGIN link lands here. Consume token -> create session.
router.get('/auth/callback', async (req, res) => {
  const token = req.query.token;
  const userId = await consumeLoginToken(token);
  if (!userId) {
    return res.status(400).render('error', {
      title: 'Ссылка недействительна',
      message: 'Ссылка для входа недействительна или истекла. Запросите новую через бота.',
    });
  }
  req.session.userId = userId;
  req.session.save(() => res.redirect('/'));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
