require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const { loadUser } = require('./middleware/auth');

const app = express();

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Body parsing + static
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Sessions (persisted to disk so logins survive restarts)
app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, '..', '.sessions'),
      ttl: 60 * 60 * 24 * 30,
      retries: 1,
      logFn: () => {},
    }),
    secret: process.env.SESSION_SECRET || 'reelogue-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true },
  })
);

// Make a few globals available to all views
app.use((req, res, next) => {
  res.locals.SITE_URL = process.env.SITE_URL || '';
  res.locals.path = req.path;
  res.locals.query = req.query;
  next();
});

// Load current user on every request
app.use(loadUser);

// Routes
app.use(require('./routes/auth'));
app.use(require('./routes/index'));
app.use(require('./routes/films'));
app.use(require('./routes/catalog'));
app.use(require('./routes/lists'));
app.use(require('./routes/users'));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Не найдено',
    message: 'Страница не найдена.',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Ошибка',
    message:
      process.env.NODE_ENV === 'production'
        ? 'Что-то пошло не так. Попробуйте позже.'
        : String(err.message || err),
  });
});

module.exports = app;
