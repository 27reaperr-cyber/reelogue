# Reelogue

A Letterboxd-style film diary built on **Node.js + Express + EJS**, with **Telegram-based authentication** (no passwords) and **TMDB** for film data. Database: **SQLite via Prisma**.

## How auth works

1. Visitor opens the site → sees only the login page.
2. Clicks **"Войти через Telegram"** → server creates a one-time `START` token (stored in DB, 10-min TTL) and redirects to `t.me/<BOT_USERNAME>?start=auth_<token>`.
3. The bot (`bot.js`) receives `/start auth_<token>`:
   - **New user** → quick in-chat registration (username → display name), pulls the Telegram avatar.
   - **Existing user** → skips straight ahead.
   - Then it issues a one-time `LOGIN` token and sends a button linking to `SITE_URL/auth/callback?token=<token>` (valid 10 min).
4. User taps the link → site consumes the token, creates a session, and they're logged in.

Tokens live in the `AuthToken` table and are deleted on use or once expired (a sweeper runs every 5 min).

## Setup

```bash
npm install
cp .env.example .env      # then fill in BOT_TOKEN, BOT_USERNAME, TMDB_API_KEY, SITE_URL
npm run setup             # prisma generate + prisma db push (creates reelogue.db)
```

## Run

Two processes (recommended):

```bash
npm start     # web server on PORT (default 3000)
npm run bot   # Telegram bot (long polling)
```

Or both in one process:

```bash
RUN_BOT=1 npm start
```

For Telegram to reach the callback link in real use, `SITE_URL` must be publicly reachable (use a tunnel like cloudflared/ngrok in dev, e.g. `SITE_URL=https://xxxx.trycloudflare.com`).

## Project structure

```
bot.js                     Telegram bot (single file, grammy)
prisma/schema.prisma       Full data model
src/
  server.js                entry point
  app.js                   Express wiring
  db.js                    Prisma client
  routes/                  auth, index(feed), films, catalog, lists, users
  middleware/auth.js       session user loading + guards
  utils/                   tmdb.js, token.js, stats.js
views/                     EJS templates + partials
public/                    css, client js, uploaded avatars
```

## Notes / things to extend

- **Kinopoisk ID for the "Смотреть" button:** TMDB's `external_ids` does **not** actually expose a Kinopoisk ID (only imdb/wikidata/social). The watch link uses the exact transform from the spec (`kinopoisk.ru/film/ID` → `sspoisk.ru/film/ID`) when a Kinopoisk ID is present, and falls back to an sspoisk search by title otherwise. To get accurate IDs, plug a TMDB→Kinopoisk mapper (e.g. kinopoisk.dev by IMDb id) into `kinopoiskIdOf()` in `src/utils/tmdb.js`.
- **Premium emoji:** the bot uses custom (premium) emoji in messages and on inline buttons. These only render if the bot owner has Telegram Premium (or the bot bought a Fragment username). `send()` in `bot.js` retries a plain version automatically if Telegram rejects them, so the bot works regardless.
- Sessions are stored on disk in `.sessions/` (session-file-store) so logins survive restarts.
