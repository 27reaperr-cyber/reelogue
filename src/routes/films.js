const express = require('express');
const router = express.Router();
const prisma = require('../db');
const tmdb = require('../utils/tmdb');
const { requireAuth } = require('../middleware/auth');

// ---- Film page ----
router.get('/film/:id', async (req, res, next) => {
  try {
    const tmdbId = Number(req.params.id);
    if (!tmdbId) return next();

    const d = await tmdb.details(tmdbId);
    const film = await tmdb.cacheFilm(d);

    const reviews = await prisma.review.findMany({
      where: { filmId: tmdbId },
      include: {
        user: true,
        comments: { include: { user: true, likes: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ratingAgg = await prisma.rating.aggregate({
      where: { filmId: tmdbId },
      _avg: { value: true },
      _count: true,
    });
    const avgUser = ratingAgg._avg.value ? ratingAgg._avg.value.toFixed(1) : null;

    let mine = { rating: null, status: null, review: null };
    let myLists = [];
    if (req.user) {
      const [r, s, rev, lists] = await Promise.all([
        prisma.rating.findUnique({ where: { userId_filmId: { userId: req.user.id, filmId: tmdbId } } }),
        prisma.filmStatus.findUnique({ where: { userId_filmId: { userId: req.user.id, filmId: tmdbId } } }),
        prisma.review.findFirst({ where: { userId: req.user.id, filmId: tmdbId } }),
        prisma.customList.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } }),
      ]);
      mine = { rating: r ? r.value : null, status: s ? s.status : null, review: rev };
      myLists = lists;
    }

    res.render('film', {
      title: film.title,
      d,
      film,
      reviews,
      avgUser,
      ratingCount: ratingAgg._count,
      mine,
      myLists,
      trailer: tmdb.trailerKey(d),
      watchUrl: tmdb.watchUrl(film.kinopoiskId, `${film.title} ${film.year || ''}`),
      tmdb,
    });
  } catch (e) {
    next(e);
  }
});

// ---- Actions (all require auth) ----

// Rate / unrate (value 0 clears)
router.post('/film/:id/rate', requireAuth, async (req, res, next) => {
  try {
    const filmId = Number(req.params.id);
    await tmdb.ensureFilm(filmId);
    const value = Number(req.body.value);
    if (!value) {
      await prisma.rating.deleteMany({ where: { userId: req.user.id, filmId } });
    } else {
      await prisma.rating.upsert({
        where: { userId_filmId: { userId: req.user.id, filmId } },
        create: { userId: req.user.id, filmId, value },
        update: { value },
      });
    }
    res.redirect(`/film/${filmId}`);
  } catch (e) {
    next(e);
  }
});

// Set list status: WATCHING / WATCHED / WATCHLIST (same value toggles off)
router.post('/film/:id/status', requireAuth, async (req, res, next) => {
  try {
    const filmId = Number(req.params.id);
    await tmdb.ensureFilm(filmId);
    const status = req.body.status;
    const existing = await prisma.filmStatus.findUnique({
      where: { userId_filmId: { userId: req.user.id, filmId } },
    });
    if (existing && existing.status === status) {
      await prisma.filmStatus.delete({ where: { id: existing.id } });
    } else {
      await prisma.filmStatus.upsert({
        where: { userId_filmId: { userId: req.user.id, filmId } },
        create: { userId: req.user.id, filmId, status },
        update: { status },
      });
      // Logging a watch also creates a diary entry once.
      if (status === 'WATCHED') {
        const today = new Date();
        await prisma.diaryEntry.create({
          data: { userId: req.user.id, filmId, watchedAt: today },
        });
      }
    }
    res.redirect(`/film/${filmId}`);
  } catch (e) {
    next(e);
  }
});

// Log a diary entry explicitly (date + optional rating + rewatch)
router.post('/film/:id/diary', requireAuth, async (req, res, next) => {
  try {
    const filmId = Number(req.params.id);
    await tmdb.ensureFilm(filmId);
    const watchedAt = req.body.watchedAt ? new Date(req.body.watchedAt) : new Date();
    const rating = req.body.rating ? Number(req.body.rating) : null;
    await prisma.diaryEntry.create({
      data: { userId: req.user.id, filmId, watchedAt, rating, rewatch: !!req.body.rewatch },
    });
    if (rating) {
      await prisma.rating.upsert({
        where: { userId_filmId: { userId: req.user.id, filmId } },
        create: { userId: req.user.id, filmId, value: rating },
        update: { value: rating },
      });
    }
    await prisma.filmStatus.upsert({
      where: { userId_filmId: { userId: req.user.id, filmId } },
      create: { userId: req.user.id, filmId, status: 'WATCHED' },
      update: { status: 'WATCHED' },
    });
    res.redirect(`/film/${filmId}`);
  } catch (e) {
    next(e);
  }
});

// Create / update a review
router.post('/film/:id/review', requireAuth, async (req, res, next) => {
  try {
    const filmId = Number(req.params.id);
    await tmdb.ensureFilm(filmId);
    const body = (req.body.body || '').trim();
    if (!body) return res.redirect(`/film/${filmId}`);
    const rating = req.body.rating ? Number(req.body.rating) : null;
    const existing = await prisma.review.findFirst({ where: { userId: req.user.id, filmId } });
    if (existing) {
      await prisma.review.update({ where: { id: existing.id }, data: { body, rating } });
    } else {
      await prisma.review.create({ data: { userId: req.user.id, filmId, body, rating } });
    }
    res.redirect(`/film/${filmId}`);
  } catch (e) {
    next(e);
  }
});

// Toggle one of the 4 favorite slots
router.post('/film/:id/favorite', requireAuth, async (req, res, next) => {
  try {
    const filmId = Number(req.params.id);
    await tmdb.ensureFilm(filmId);
    const existing = await prisma.favoriteFilm.findFirst({ where: { userId: req.user.id, filmId } });
    if (existing) {
      await prisma.favoriteFilm.delete({ where: { id: existing.id } });
    } else {
      const count = await prisma.favoriteFilm.count({ where: { userId: req.user.id } });
      if (count >= 4) {
        return res.redirect(`/film/${filmId}?fav=full`);
      }
      const used = await prisma.favoriteFilm.findMany({ where: { userId: req.user.id } });
      const taken = new Set(used.map((u) => u.position));
      let pos = 1;
      while (taken.has(pos)) pos++;
      await prisma.favoriteFilm.create({ data: { userId: req.user.id, filmId, position: pos } });
    }
    res.redirect(`/film/${filmId}`);
  } catch (e) {
    next(e);
  }
});

// Add film to a custom list
router.post('/film/:id/add-to-list', requireAuth, async (req, res, next) => {
  try {
    const filmId = Number(req.params.id);
    const listId = Number(req.body.listId);
    await tmdb.ensureFilm(filmId);
    const list = await prisma.customList.findFirst({ where: { id: listId, userId: req.user.id } });
    if (list) {
      const count = await prisma.customListItem.count({ where: { listId } });
      await prisma.customListItem
        .create({ data: { listId, filmId, order: count } })
        .catch(() => {}); // ignore duplicate
    }
    res.redirect(`/film/${filmId}`);
  } catch (e) {
    next(e);
  }
});

// Comment on a review
router.post('/review/:reviewId/comment', requireAuth, async (req, res, next) => {
  try {
    const reviewId = Number(req.params.reviewId);
    const body = (req.body.body || '').trim();
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (review && body) {
      await prisma.comment.create({ data: { reviewId, userId: req.user.id, body } });
    }
    res.redirect(`/film/${review ? review.filmId : ''}#review-${reviewId}`);
  } catch (e) {
    next(e);
  }
});

// Like / unlike a comment
router.post('/comment/:commentId/like', requireAuth, async (req, res, next) => {
  try {
    const commentId = Number(req.params.commentId);
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { review: true },
    });
    if (!comment) return res.redirect('back');
    const existing = await prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId: req.user.id } },
    });
    if (existing) await prisma.commentLike.delete({ where: { id: existing.id } });
    else await prisma.commentLike.create({ data: { commentId, userId: req.user.id } });
    res.redirect(`/film/${comment.review.filmId}#review-${comment.reviewId}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
