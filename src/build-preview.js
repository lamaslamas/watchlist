// Dati per la pagina di prova: 20 titoli della watchlist (i migliori + un campione di tutte le fasce, con qualche serie) e 8 suggeriti.
import { p, readJson, writeJson } from './lib/util.js';
import { loadItems } from './lib/data.js';

const { cache, cfg } = loadItems();
const rk = readJson(p('data', 'state', 'ranking.json'));
const regions = new Intl.DisplayNames(['it'], { type: 'region' });
const region = c => { try { return regions.of(c); } catch { return c; } };

const wl = rk.watchlist;
const chosen = new Map();
wl.slice(0, 9).forEach(x => chosen.set(x.key, x));
const rest = wl.slice(9);
for (let i = 0; chosen.size < 18; i++) { const x = rest[Math.floor(((i + 0.5) * rest.length) / 9)]; if (x) chosen.set(x.key, x); }
// almeno 3 serie nel campione
const tvs = wl.filter(x => x.media === 'tv');
for (const t of [tvs[0], tvs[Math.floor(tvs.length / 2)], tvs.at(-1)]) if (t && ![...chosen.values()].some(x => x.key === t.key) && chosen.size < 20) chosen.set(t.key, t);
for (const x of wl) if (chosen.size < 20) chosen.set(x.key, x);

const shape = x => {
  const e = cache[x.key], d = e.data, pr = e.providers;
  const names = l => (l ?? []).map(y => y.name);
  const prov = l => (l ?? []).map(y => ({ name: y.name, logo: y.logo }));
  return {
    key: x.key, media: x.media, tmdb_id: x.tmdb_id, imdb_id: d.imdb_id, title: d.title, original_title: d.original_title, year: d.year,
    runtime: d.runtime, seasons: d.seasons, genres: names(d.genres), directors: names(d.directors), cast: names(d.cast),
    countries: (d.countries ?? []).map(region), overview: d.overview, poster: d.poster, vote_average: d.vote_average, vote_count: d.vote_count,
    providers: { link: pr.link, flatrate: prov(pr.flatrate), free: prov(pr.free), ads: prov(pr.ads), rent: prov(pr.rent), buy: prov(pr.buy) },
    score: x.score, band: x.band, why: x.why, via: x.via ?? null,
  };
};
const out = {
  bands: rk.cutoffs.map(c => c.name),
  bandsShort: cfg.bands.map(b => b.short ?? b.name),
  watchlist: [...chosen.values()].sort((a, b) => b.score - a.score).slice(0, 20).map(shape),
  suggestions: rk.suggestions.slice(0, 8).map(shape),
};
writeJson(p('docs', 'data', 'preview.json'), out, false);
console.log(`watchlist ${out.watchlist.length} (serie ${out.watchlist.filter(x => x.media === 'tv').length}), suggeriti ${out.suggestions.length}`);
console.log(out.watchlist.map(x => `${x.score.toFixed(0)} b${x.band} ${x.title}${x.poster ? '' : ' [NO POSTER]'}`).join('\n'));
