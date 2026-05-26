const express = require('express');
const router = express.Router();
const prisma = require('../db');
const tmdb = require('../utils/tmdb');
const { requireAuth } = require('../middleware/auth');

// Home = activity feed from people you follow (+ yourself).
router.get('/', requireAuth, async (req, res) => {
  const follows = await prisma.follow.findMany({ where: { followerId: req.user.id } });
  const ids = [req.user.id, ...follows.map((f) => f.followingId)];

  const [diary, reviews, ratings] = await Promise.all([
    prisma.diaryEntry.findMany({
      where: { userId: { in: ids } },
      include: { film: true, user: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.review.findMany({
      where: { userId: { in: ids } },
      include: { film: true, user: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.rating.findMany({
      where: { userId: { in: ids } },
      include: { film: true, user: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const feed = [
    ...diary.map((d) => ({ type: 'diary', at: d.createdAt, ...d })),
    ...reviews.map((r) => ({ type: 'review', at: r.createdAt, ...r })),
    ...ratings.map((r) => ({ type: 'rating', at: r.createdAt, ...r })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 40);

  let suggested = [];
  if (feed.length === 0) {
    try {
      suggested = (await tmdb.trending()).slice(0, 12);
    } catch (e) {
      /* TMDB key may be missing; ignore */
    }
  }

  res.render('home', { title: 'Лента', feed, suggested, tmdb });
});

module.exports = router;
