const express = require('express');
const router = express.Router();
const prisma = require('../db');
const tmdb = require('../utils/tmdb');

// Catalog with advanced filters (genre, year, country, rating)
router.get('/catalog', async (req, res, next) => {
  try {
    const { genre, year, country, rating, sort } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const genreList = await tmdb.genres().catch(() => []);
    const results = await tmdb
      .discover({
        genre,
        year,
        country,
        ratingGte: rating,
        page,
        sortBy: sort || 'popularity.desc',
      })
      .catch(() => []);
    res.render('catalog', {
      title: 'Каталог',
      results,
      genreList,
      filters: { genre, year, country, rating, sort },
      page,
      tmdb,
    });
  } catch (e) {
    next(e);
  }
});

// Combined search: films + users
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    let films = [];
    let users = [];
    if (q) {
      films = await tmdb.searchMovies(q).catch(() => []);
      users = await prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: q } },
            { displayName: { contains: q } },
          ],
        },
        take: 12,
      });
    }
    res.render('search', { title: 'Поиск', q, films, users, tmdb });
  } catch (e) {
    next(e);
  }
});

// Popular / trending
router.get('/popular', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const results = await tmdb.trending(page).catch(() => []);
    res.render('popular', { title: 'Популярное', results, page, tmdb });
  } catch (e) {
    next(e);
  }
});

// Random film -> redirect to its page
router.get('/random', async (req, res, next) => {
  try {
    const m = await tmdb.randomMovie();
    if (!m) return res.redirect('/popular');
    res.redirect(`/film/${m.id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
