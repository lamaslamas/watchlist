// Logica pura (senza rete) per il seed verso Trakt e per costruire i titoli da Trakt. Testata in test/trakt.test.js.

const keyOf = (media, tmdb) => `${media}:${tmdb}`;

/** Confronta i titoli importati da CSV con lo stato di Trakt e dice cosa manca. Non scrive niente. */
export function planSeed(csvTitles, state) {
  const rated = new Map(state.ratings.filter(x => x.tmdb).map(x => [keyOf(x.media, x.tmdb), x]));
  const listed = new Set(state.watchlist.filter(x => x.tmdb).map(x => keyOf(x.media, x.tmdb)));
  const watched = new Map(state.watched.filter(x => x.tmdb).map(x => [keyOf(x.media, x.tmdb), x]));
  const plan = { ratingsMissing: [], ratingConflicts: [], watchlistMissing: [], alreadySeenOnTrakt: [], watchedMissing: [], ok: { ratings: 0, watchlist: 0 } };
  for (const t of csvTitles) {
    const k = t.key;
    if (t.my_rating != null) {
      const r = rated.get(k);
      if (!r) plan.ratingsMissing.push(t);
      else if (r.rating !== t.my_rating) plan.ratingConflicts.push({ title: t, csv: t.my_rating, trakt: r.rating });
      else plan.ok.ratings++;
    } else if (t.status === 'watchlist') {
      if (listed.has(k)) plan.ok.watchlist++;
      else if (rated.has(k) || watched.has(k)) plan.alreadySeenOnTrakt.push(t);
      else plan.watchlistMissing.push(t);
    } else if (!watched.has(k) && !rated.has(k)) plan.watchedMissing.push(t); // visto (Letterboxd) senza voto
  }
  return plan;
}

const idsOf = t => ({ ids: { tmdb: t.tmdb_id } });
const split = (list, fn) => ({
  movies: list.filter(t => t.media === 'movie').map(fn),
  shows: list.filter(t => t.media === 'tv').map(fn),
});
/** Corpi delle richieste di scrittura. Le date dei voti si conservano; per i visti senza data si usa "released". */
export function seedPayloads(plan, { includeWatched = false } = {}) {
  const payloads = [];
  const rating = split(plan.ratingsMissing, t => ({ ...idsOf(t), rating: t.my_rating, ...(t.rated_at ? { rated_at: `${t.rated_at.slice(0, 10)}T00:00:00.000Z` } : {}) }));
  if (plan.ratingsMissing.length) payloads.push({ path: '/sync/ratings', body: rating, count: plan.ratingsMissing.length, label: 'voti' });
  const wl = split(plan.watchlistMissing, idsOf);
  if (plan.watchlistMissing.length) payloads.push({ path: '/sync/watchlist', body: wl, count: plan.watchlistMissing.length, label: 'watchlist' });
  if (includeWatched && plan.watchedMissing.length) {
    const h = split(plan.watchedMissing, t => ({ ...idsOf(t), watched_at: 'released' }));
    payloads.push({ path: '/sync/history', body: h, count: plan.watchedMissing.length, label: 'visti senza voto' });
  }
  return payloads;
}
/** Spezza un corpo {movies, shows} in blocchi da `size` elementi. */
export function chunkBody(body, size = 100) {
  const out = [];
  for (const kind of ['movies', 'shows']) for (let i = 0; i < body[kind].length; i += size) out.push({ [kind]: body[kind].slice(i, i + size) });
  return out;
}

/**
 * Costruisce i titoli (stessa forma di titles.json) dallo stato Trakt.
 * Visto = ha un voto, oppure film guardato, oppure serie completata (episodi visti / episodi TMDB >= ratio).
 * Una serie iniziata ma non completata e ancora in watchlist resta in watchlist.
 * `extra` = { watchlist: [...], seen: [...] } con elementi {media, tmdb, imdb, title, year} che vivono solo nel repo.
 */
export function buildTitles(state, cache = {}, { completionRatio = 0.9, extra = {} } = {}) {
  const map = new Map();
  const get = x => {
    if (!x.tmdb) return null;
    const key = keyOf(x.media, x.tmdb);
    if (!map.has(key)) map.set(key, { key, media: x.media, tmdb_id: x.tmdb, imdb_id: x.imdb, name: x.title, year: x.year, ratings: [], my_rating: null, rated_at: null, watched_at: null, watched: false, watchlisted: false, sources: ['trakt'] });
    return map.get(key);
  };
  for (const x of state.ratings) { const t = get(x); if (t) { t.my_rating = x.rating; t.rated_at = x.at; t.ratings = [{ src: 'trakt', value: x.rating, date: x.at }]; } }
  for (const x of state.watchlist) { const t = get(x); if (t) t.watchlisted = true; }
  // Titoli che non stanno su Trakt (limite di 500 voci della watchlist gratuita): config/extra-watchlist.json
  for (const x of extra.watchlist ?? []) { const t = get(x); if (t) { t.watchlisted = true; if (!t.sources.includes('extra')) t.sources.push('extra'); } }
  for (const x of extra.seen ?? []) { const t = get(x); if (t) { t.watched = true; if (!t.sources.includes('extra')) t.sources.push('extra'); } }
  for (const x of state.watched) {
    const t = get(x); if (!t) continue;
    t.watched_at = x.at;
    if (x.media === 'movie') t.watched = true;
    else {
      const total = cache[t.key]?.data?.episodes;
      t.watched = !!total && x.episodes_watched / total >= completionRatio;
      t.in_progress = !t.watched;
    }
  }
  const out = [];
  for (const t of map.values()) {
    t.status = t.my_rating != null || t.watched ? 'seen' : t.watchlisted ? 'watchlist' : 'other';
    if (t.status === 'seen') t.watchlisted = false;
    out.push(t);
  }
  return out;
}
