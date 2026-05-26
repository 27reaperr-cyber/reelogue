const prisma = require('../db');

const MONTHS_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getDate()} ${MONTHS_RU[dt.getMonth()]} ${dt.getFullYear()}`;
}

function pluralRu(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Compute personal statistics for a user. */
async function userStats(userId) {
  const [diary, ratings, reviews] = await Promise.all([
    prisma.diaryEntry.findMany({ where: { userId }, include: { film: true } }),
    prisma.rating.findMany({ where: { userId } }),
    prisma.review.count({ where: { userId } }),
  ]);

  // watch hours from runtimes of diary films
  let minutes = 0;
  for (const e of diary) minutes += e.film.runtime || 0;
  const hours = Math.round(minutes / 60);

  // favorite genres (count across diary films)
  const genreCount = {};
  for (const e of diary) {
    (e.film.genres || '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
      .forEach((g) => (genreCount[g] = (genreCount[g] || 0) + 1));
  }
  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // most active months
  const monthCount = {};
  for (const e of diary) {
    const dt = new Date(e.watchedAt);
    const label = `${MONTHS_RU[dt.getMonth()]} ${dt.getFullYear()}`;
    monthCount[label] = (monthCount[label] || 0) + 1;
  }
  const topMonths = Object.entries(monthCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  const avgRating =
    ratings.length > 0
      ? (ratings.reduce((s, r) => s + r.value, 0) / ratings.length).toFixed(1)
      : null;

  // rating distribution 1..10
  const dist = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, count: 0 }));
  for (const r of ratings) if (r.value >= 1 && r.value <= 10) dist[r.value - 1].count++;
  const maxDist = Math.max(1, ...dist.map((d) => d.count));

  return {
    watched: diary.length,
    hours,
    reviews,
    ratingsCount: ratings.length,
    avgRating,
    topGenres,
    topMonths,
    dist,
    maxDist,
  };
}

module.exports = { formatDate, pluralRu, userStats, MONTHS_RU };
