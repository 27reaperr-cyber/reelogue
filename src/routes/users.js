const express = require('express');
const router = express.Router();
const prisma = require('../db');
const tmdb = require('../utils/tmdb');
const { requireAuth } = require('../middleware/auth');
const { userStats } = require('../utils/stats');

// Convenience redirect to your own profile
router.get('/profile', requireAuth, (req, res) => res.redirect(`/u/${req.user.username}`));

// Edit profile form
router.get('/settings', requireAuth, (req, res) => {
  res.render('edit-profile', { title: 'Настройки профиля' });
});
router.post('/settings', requireAuth, async (req, res, next) => {
  try {
    const displayName = (req.body.displayName || '').trim().slice(0, 60) || req.user.displayName;
    const bio = (req.body.bio || '').trim().slice(0, 400);
    await prisma.user.update({ where: { id: req.user.id }, data: { displayName, bio } });
    res.redirect(`/u/${req.user.username}`);
  } catch (e) {
    next(e);
  }
});

// Diary (full chronological list)
router.get('/diary', requireAuth, async (req, res, next) => {
  try {
    const entries = await prisma.diaryEntry.findMany({
      where: { userId: req.user.id },
      include: { film: true },
      orderBy: { watchedAt: 'desc' },
    });
    res.render('diary', { title: 'Кинодневник', entries, tmdb });
  } catch (e) {
    next(e);
  }
});

// Personal statistics
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const stats = await userStats(req.user.id);
    res.render('stats', { title: 'Статистика', stats });
  } catch (e) {
    next(e);
  }
});

// Follow / unfollow
router.post('/u/:username/follow', requireAuth, async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!target || target.id === req.user.id) return res.redirect('back');
    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: req.user.id, followingId: target.id } },
    });
    if (existing) await prisma.follow.delete({ where: { id: existing.id } });
    else
      await prisma.follow.create({
        data: { followerId: req.user.id, followingId: target.id },
      });
    res.redirect(`/u/${target.username}`);
  } catch (e) {
    next(e);
  }
});

// Public profile
router.get('/u/:username', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!user) return next();

    const [favorites, watchedCount, followers, following, recentDiary, reviews, lists] =
      await Promise.all([
        prisma.favoriteFilm.findMany({
          where: { userId: user.id },
          include: { film: true },
          orderBy: { position: 'asc' },
        }),
        prisma.diaryEntry.count({ where: { userId: user.id } }),
        prisma.follow.count({ where: { followingId: user.id } }),
        prisma.follow.count({ where: { followerId: user.id } }),
        prisma.diaryEntry.findMany({
          where: { userId: user.id },
          include: { film: true },
          orderBy: { watchedAt: 'desc' },
          take: 12,
        }),
        prisma.review.findMany({
          where: { userId: user.id },
          include: { film: true },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
        prisma.customList.findMany({
          where: { userId: user.id, ...(req.user && req.user.id === user.id ? {} : { isPublic: true }) },
          include: { items: { include: { film: true }, take: 5 } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    let isFollowing = false;
    if (req.user && req.user.id !== user.id) {
      isFollowing = !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: req.user.id, followingId: user.id } },
      }));
    }

    res.render('profile', {
      title: user.displayName,
      profile: user,
      isOwner: req.user && req.user.id === user.id,
      isFollowing,
      favorites,
      counts: { watched: watchedCount, followers, following },
      recentDiary,
      reviews,
      lists,
      tmdb,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
