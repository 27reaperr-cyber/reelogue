const prisma = require('../db');

/** Loads req.user from the session (if logged in) and exposes it to views. */
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  req.user = null;
  if (req.session && req.session.userId) {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

/** Blocks unauthenticated access to a route. */
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET') return res.redirect('/login');
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { loadUser, requireAuth };
