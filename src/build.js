// Genera i dati del sito: docs/data/items.json e copia ranking.js accanto, così il browser
// ricalcola il ranking con lo STESSO codice della build.
// Uso: node src/build.js   (prima: resolve → enrich → suggest → enrich → rank)
import fs from 'node:fs';
import { p, readJson, writeJson } from './lib/util.js';
import { loadItems } from './lib/data.js';

const { cfg, titles, rated, watchlist } = loadItems();
const rk = readJson(p('data', 'state', 'ranking.json'));
if (!rk) throw new Error('Esegui prima: npm run rank');
const cache = readJson(p('data', 'cache', 'tmdb.json'));
const site = readJson(p('config', 'site.json'), {});

const ids = l => (l ?? []).map(x => ({ id: x.id }));
const named = l => (l ?? []).map(x => ({ id: x.id, name: x.name }));

// Profilo: solo gli id bastano (i nomi servono solo per il titolo che si sta spiegando)
const ratedOut = rated.map(r => ({
  key: r.key, media: r.media, title: r.title, my: r.my,
  d: { year: r.d.year, vote_average: r.d.vote_average, vote_count: r.d.vote_count, genres: ids(r.d.genres), directors: ids(r.d.directors), cast: ids(r.d.cast), countries: r.d.countries, keywords: ids(r.d.keywords) },
}));

const providers = pr => {
  const f = l => (l ?? []).map(x => [x.name, x.logo]);
  return { flatrate: f(pr?.flatrate), free: f(pr?.free), ads: f(pr?.ads), rent: f(pr?.rent), buy: f(pr?.buy) };
};
function itemOut(key, extra = {}) {
  const e = cache[key]; if (!e) return null;
  const d = e.data;
  return {
    key, media: d.media, tmdb_id: d.id, imdb_id: d.imdb_id, title: d.title, original_title: d.original_title !== d.title ? d.original_title : undefined,
    overview: d.overview, runtime: d.runtime, seasons: d.seasons, poster: d.poster, providers: providers(e.providers), ...extra,
    d: { year: d.year, vote_average: d.vote_average, vote_count: d.vote_count, genres: named(d.genres), directors: named(d.directors), cast: named(d.cast), countries: d.countries, keywords: named(d.keywords) },
  };
}
const wl = watchlist.map(w => itemOut(w.key)).filter(Boolean);
const sg = rk.suggestions.map(s => itemOut(s.key, { via: s.via })).filter(Boolean);

// Storico dei film votati (per l'export Letterboxd "dai nuovi visti in poi"): data = quella del voto
const history = titles.filter(t => t.my_rating != null && t.media === 'movie' && cache[t.key])
  .map(t => ({ tmdb_id: t.tmdb_id, imdb_id: cache[t.key].data.imdb_id, title: cache[t.key].data.title, year: cache[t.key].data.year, rating: t.my_rating, at: t.rated_at }));

const out = {
  generated_at: new Date().toISOString(),
  last_letterboxd_export: site.letterboxd_last_export ?? null,
  bands: cfg.bands.map(b => ({ name: b.name, short: b.short ?? b.name })),
  cfg, rated: ratedOut, watchlist: wl, suggestions: sg, history,
};
writeJson(p('docs', 'data', 'items.json'), out, false);
fs.copyFileSync(p('src', 'ranking.js'), p('docs', 'ranking.js'));
const kb = fs.statSync(p('docs', 'data', 'items.json')).size / 1024;
console.log(`items.json: ${kb.toFixed(0)} KB — votati ${ratedOut.length}, watchlist ${wl.length}, suggeriti ${sg.length}, storico film ${history.length}`);
