// TMDB integration. Uses global fetch (Node 18+).
const prisma = require('../db');

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const LANG = process.env.TMDB_LANG || 'ru-RU';
const REGION = process.env.TMDB_REGION || 'RU';

function key() {
  return process.env.TMDB_API_KEY;
}

async function tmdb(path, params = {}) {
  if (!key()) throw new Error('TMDB_API_KEY is not set in .env');
  const url = new URL(API + path);
  url.searchParams.set('api_key', key());
  url.searchParams.set('language', LANG);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TMDB ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ---- image helpers ----
function img(path, size = 'w342') {
  if (!path) return null;
  return `${IMG}/${size}${path}`;
}
function poster(path) {
  return img(path, 'w342');
}
function posterLg(path) {
  return img(path, 'w500');
}
function backdrop(path) {
  return img(path, 'w1280');
}

// ---- search & browse ----
async function searchMovies(query, page = 1) {
  const data = await tmdb('/search/movie', { query, page, include_adult: 'false', region: REGION });
  return data.results || [];
}

async function trending(page = 1) {
  const data = await tmdb('/trending/movie/week', { page });
  return data.results || [];
}

async function popular(page = 1) {
  const data = await tmdb('/movie/popular', { page, region: REGION });
  return data.results || [];
}

let _genreCache = null;
async function genres() {
  if (_genreCache) return _genreCache;
  const data = await tmdb('/genre/movie/list');
  _genreCache = data.genres || [];
  return _genreCache;
}

async function discover({ genre, year, country, ratingGte, page = 1, sortBy = 'popularity.desc' } = {}) {
  const data = await tmdb('/discover/movie', {
    with_genres: genre,
    primary_release_year: year,
    with_origin_country: country,
    'vote_average.gte': ratingGte,
    'vote_count.gte': ratingGte ? 50 : undefined,
    sort_by: sortBy,
    include_adult: 'false',
    page,
  });
  return data.results || [];
}

async function randomMovie() {
  const page = 1 + Math.floor(Math.random() * 20);
  const list = await discover({ ratingGte: 6.5, page, sortBy: 'vote_count.desc' });
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// ---- film details + cache ----
async function details(tmdbId) {
  return tmdb(`/movie/${tmdbId}`, { append_to_response: 'videos,external_ids,credits' });
}

function yearOf(d) {
  return d.release_date ? Number(d.release_date.slice(0, 4)) || null : null;
}

/**
 * Kinopoisk id is NOT part of TMDB's external_ids in practice (TMDB exposes
 * imdb/wikidata/social ids only). We read it defensively in case a proxy adds
 * it, and otherwise leave it null — the watch link then falls back to search.
 */
function kinopoiskIdOf(d) {
  const ext = d.external_ids || {};
  return ext.kinopoisk_id || ext.kinopoiskId || null;
}

function trailerKey(d) {
  const vids = (d.videos && d.videos.results) || [];
  const pick =
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ||
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
    vids.find((v) => v.site === 'YouTube');
  return pick ? pick.key : null;
}

/** Builds the watch URL per spec: kinopoisk.ru/film/ID -> sspoisk.ru/film/ID. */
function watchUrl(kinopoiskId, fallbackTitle) {
  if (kinopoiskId) {
    const kp = `https://www.kinopoisk.ru/film/${kinopoiskId}/`;
    return kp.replace('kinopoisk.ru', 'sspoisk.ru');
  }
  // Graceful fallback when no Kinopoisk id is available.
  return `https://www.sspoisk.ru/index.php?kp_query=${encodeURIComponent(fallbackTitle || '')}`;
}

/** Upsert a TMDB details object into our local Film cache and return the row. */
async function cacheFilm(d) {
  const data = {
    title: d.title || d.name || d.original_title || 'Untitled',
    originalTitle: d.original_title || null,
    year: yearOf(d),
    posterPath: d.poster_path || null,
    backdropPath: d.backdrop_path || null,
    overview: d.overview || '',
    genres: (d.genres || []).map((g) => g.name).join(', '),
    country: (d.production_countries && d.production_countries[0] && d.production_countries[0].name) || null,
    runtime: d.runtime || null,
    tmdbRating: typeof d.vote_average === 'number' ? d.vote_average : null,
    kinopoiskId: kinopoiskIdOf(d),
  };
  return prisma.film.upsert({
    where: { tmdbId: d.id },
    create: { tmdbId: d.id, ...data },
    update: data,
  });
}

/** Ensure a Film exists locally (fetch + cache if missing or stale). */
async function ensureFilm(tmdbId) {
  const id = Number(tmdbId);
  const existing = await prisma.film.findUnique({ where: { tmdbId: id } });
  const stale = !existing || Date.now() - existing.updatedAt.getTime() > 7 * 24 * 3600 * 1000;
  if (!stale) return existing;
  try {
    const d = await details(id);
    return cacheFilm(d);
  } catch (e) {
    if (existing) return existing;
    throw e;
  }
}

module.exports = {
  tmdb,
  img,
  poster,
  posterLg,
  backdrop,
  searchMovies,
  trending,
  popular,
  genres,
  discover,
  randomMovie,
  details,
  cacheFilm,
  ensureFilm,
  trailerKey,
  watchUrl,
  yearOf,
  kinopoiskIdOf,
};
