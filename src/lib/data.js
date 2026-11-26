import { p, readJson, loadConfig } from './util.js';

/** Carica configurazione, titoli e cache TMDB e li trasforma in item per il ranking. */
export function loadItems() {
  const cfg = loadConfig();
  const titles = readJson(p('data', 'state', 'titles.json'), []);
  const cache = readJson(p('data', 'cache', 'tmdb.json'), {});
  const mk = t => cache[t.key] && {
    key: t.key, media: t.media, tmdb_id: t.tmdb_id, title: cache[t.key].data.title,
    d: cache[t.key].data, providers: cache[t.key].providers, my: t.my_rating, rated_at: t.rated_at, lb_uri: t.lb_uri,
  };
  const rated = titles.filter(t => t.my_rating != null).map(mk).filter(Boolean);
  const watchlist = titles.filter(t => t.status === 'watchlist').map(mk).filter(Boolean);
  const seenKeys = new Set(titles.map(t => t.key)); // tutto ciò che conosco: da escludere dai suggeriti
  return { cfg, titles, cache, rated, watchlist, seenKeys };
}
