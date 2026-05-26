const express = require('express');
const router = express.Router();
const prisma = require('../db');
const tmdb = require('../utils/tmdb');
const { requireAuth } = require('../middleware/auth');

// My lists
router.get('/lists', requireAuth, async (req, res, next) => {
  try {
    const lists = await prisma.customList.findMany({
      where: { userId: req.user.id },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.render('lists', { title: 'Мои списки', lists });
  } catch (e) {
    next(e);
  }
});

router.post('/lists', requireAuth, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim().slice(0, 80);
    if (!name) return res.redirect('/lists');
    const list = await prisma.customList.create({
      data: {
        userId: req.user.id,
        name,
        description: (req.body.description || '').trim().slice(0, 400),
        isPublic: req.body.isPublic === 'on' || req.body.isPublic === 'true',
      },
    });
    res.redirect(`/list/${list.id}`);
  } catch (e) {
    next(e);
  }
});

// View a single list
router.get('/list/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const list = await prisma.customList.findUnique({
      where: { id },
      include: {
        user: true,
        items: { include: { film: true }, orderBy: { order: 'asc' } },
      },
    });
    if (!list) return next();
    const isOwner = req.user && req.user.id === list.userId;
    if (!list.isPublic && !isOwner) {
      return res.status(403).render('error', {
        title: 'Приватный список',
        message: 'Этот список доступен только его автору.',
      });
    }
    res.render('list', { title: list.name, list, isOwner, tmdb });
  } catch (e) {
    next(e);
  }
});

router.post('/list/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.customList.deleteMany({ where: { id, userId: req.user.id } });
    res.redirect('/lists');
  } catch (e) {
    next(e);
  }
});

router.post('/list/:id/remove/:filmId', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const filmId = Number(req.params.filmId);
    const list = await prisma.customList.findFirst({ where: { id, userId: req.user.id } });
    if (list) await prisma.customListItem.deleteMany({ where: { listId: id, filmId } });
    res.redirect(`/list/${id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
