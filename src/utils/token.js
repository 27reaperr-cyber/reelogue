const crypto = require('crypto');
const prisma = require('../db');

const TEN_MINUTES = 10 * 60 * 1000;

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** Site creates a START token, then links the user to the bot. */
async function createStartToken() {
  const token = randomToken();
  await prisma.authToken.create({
    data: { token, kind: 'START', expiresAt: new Date(Date.now() + TEN_MINUTES) },
  });
  return token;
}

/** Bot creates a fresh LOGIN token bound to a user. Link is valid 10 minutes. */
async function createLoginToken(userId) {
  const token = randomToken();
  await prisma.authToken.create({
    data: { token, kind: 'LOGIN', userId, expiresAt: new Date(Date.now() + TEN_MINUTES) },
  });
  return token;
}

/** Validate a token of a given kind; returns the record or null. Does NOT delete. */
async function peekToken(token, kind) {
  if (!token) return null;
  const rec = await prisma.authToken.findUnique({ where: { token } });
  if (!rec || rec.kind !== kind) return null;
  if (rec.expiresAt.getTime() < Date.now()) {
    await prisma.authToken.delete({ where: { id: rec.id } }).catch(() => {});
    return null;
  }
  return rec;
}

/** Consume a LOGIN token: validate, then delete (one-time use). */
async function consumeLoginToken(token) {
  const rec = await peekToken(token, 'LOGIN');
  if (!rec || !rec.userId) return null;
  await prisma.authToken.delete({ where: { id: rec.id } }).catch(() => {});
  return rec.userId;
}

/** Best-effort cleanup of expired tokens. */
async function cleanupExpired() {
  await prisma.authToken
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

module.exports = {
  randomToken,
  createStartToken,
  createLoginToken,
  peekToken,
  consumeLoginToken,
  cleanupExpired,
};
