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

## Setup (local)

```bash
npm install               # also runs `prisma generate` automatically (postinstall)
cp .env.example .env      # then fill in BOT_TOKEN, BOT_USERNAME, TMDB_API_KEY, SITE_URL, DATABASE_URL
npm start                 # generates client, syncs DB schema, starts web (+ bot if RUN_BOT=1)
```

`npm start` is self-contained — it runs `prisma generate && prisma db push && node src/server.js`,
so you never get a "@prisma/client did not initialize" error as long as the host launches the app
via `npm start`.

## Run

One process (recommended for hosting — set `RUN_BOT=1` in env):

```bash
npm start     # web server + Telegram bot in the same process
```

Two separate processes instead:

```bash
RUN_BOT=  npm start   # web only
npm run bot           # bot only (long polling)
```

For Telegram to reach the callback link in real use, `SITE_URL` must be publicly reachable (use a tunnel like cloudflared/ngrok in dev, e.g. `SITE_URL=https://xxxx.trycloudflare.com`).

## Deploying (Railway / Render / Amvera / any Docker PaaS)

The most common deploy failure is the host running a file directly (e.g. `node bot.js` or
`node http-wrapper.js`) instead of `npm start`. Do this:

1. **Build / install command:** `npm install` (this triggers `prisma generate`).
2. **Start command:** `npm start` — NOT `node bot.js`, NOT `node http-wrapper.js`.
   `http-wrapper.js` does not exist in this project; if your host points at it, change the start command.
3. **Environment variables:** set `BOT_TOKEN`, `BOT_USERNAME`, `TMDB_API_KEY`, `SITE_URL`
   (your public URL), `SESSION_SECRET`, `RUN_BOT=1`, and `DATABASE_URL`.
4. **Persistent storage for SQLite:** containers wipe their filesystem on every redeploy. To keep
   user accounts and diaries, mount a volume (e.g. at `/data`) and set
   `DATABASE_URL=file:/data/reelogue.db`. Without a volume the database resets on each deploy.

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
- Sessions are stored in `prisma/sessions.db` (connect-sqlite3) so logins survive restarts.
