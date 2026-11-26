// Genera l'addon Stremio/Nuvio (solo cataloghi, statico): docs/manifest.json e docs/catalog/<tipo>/<id>.json.
// Gli id dei meta sono ID IMDb (tt…): Stremio/Nuvio recuperano da soli schede e locandine.
// Uso: node src/build-addon.js   (dopo npm run build)
import fs from 'node:fs';
import { p, readJson, writeJson, loadConfig } from './lib/util.js';
import { loadItems } from './lib/data.js';
import { computeAll } from './ranking.js';

const cfg = loadConfig(), A = cfg.addon;
const data = readJson(p('docs', 'data', 'items.json'));
const rk = readJson(p('data', 'state', 'ranking.json'));
const { cache, rated } = loadItems();
if (!data || !rk) throw new Error('Esegui prima: npm run rank && npm run build');

const R = computeAll(data); // stesso calcolo del sito
const TYPE = { movie: 'movie', tv: 'series' };
const IMG = 'https://image.tmdb.org/t/p/w500';
const bandName = i => cfg.bands[i].name;
const stars = v => String(v / 2).replace('.', ',');
const skipped = { noImdb: 0 };

/** Meta minimale per un catalogo. `why` finisce nella descrizione: qui è la spiegazione del punteggio. */
function meta({ key, media, imdb_id, title, year, score, band, why, via }) {
  const d = cache[key]?.data;
  if (!imdb_id || !/^tt\d+$/.test(imdb_id)) { skipped.noImdb++; return null; }
  return {
    id: imdb_id, type: TYPE[media], name: title,
    ...(d?.poster ? { poster: IMG + d.poster, posterShape: 'poster' } : {}),
    ...(year ? { releaseInfo: String(year) } : {}),
    ...(d?.genres?.length ? { genres: d.genres.map(g => g.name) } : {}),
    ...(d?.runtime ? { runtime: `${d.runtime} min` } : {}),
    description: `${Math.round(score)} · ${bandName(band)}. ${why}${via ? ` ${via.charAt(0).toUpperCase() + via.slice(1)}.` : ''}`,
  };
}
const dedupe = metas => { const seen = new Set(); return metas.filter(m => m && !seen.has(m.id) && seen.add(m.id)); };

// ---- Cataloghi ----
const wl = R.watchlist.map(x => ({ key: x.it.key, media: x.it.media, imdb_id: x.it.imdb_id, title: x.it.title, year: x.it.d.year, score: x.score, band: x.band, why: x.why, it: x.it }));
const fromRank = list => list.map(x => ({ key: x.key, media: x.media, imdb_id: x.imdb_id, title: x.title, year: x.year, score: x.score, band: x.band, why: x.why, via: x.via }));

// "Registi che ami": registi con più titoli votati e peso alto nel profilo; i loro titoli in watchlist, un regista dopo l'altro
const names = new Map();
for (const r of rated) for (const x of r.d.directors) names.set(x.id, x.name);
for (const x of wl) for (const d of x.it.d.directors) names.set(d.id, d.name);
const loved = [...R.profile.table.directors].filter(([, e]) => e.n >= A.directors_min_seen && e.w > 0).sort((a, b) => b[1].w - a[1].w).slice(0, A.directors_top);
const lovedSet = new Map(loved.map(([id], i) => [id, i]));
const directorsList = wl.filter(x => x.media === 'movie' && x.it.d.directors.some(d => lovedSet.has(d.id)))
  .map(x => {
    const best = x.it.d.directors.filter(d => lovedSet.has(d.id)).sort((a, b) => lovedSet.get(a.id) - lovedSet.get(b.id))[0];
    const e = R.profile.table.directors.get(best.id);
    // se la spiegazione già cita il regista non la ripeto
    const why = x.why.includes(best.name) ? x.why : `Regia di ${best.name}, di cui hai visto ${e.n} titoli (media ${stars(Math.round(e.mean))}). ${x.why}`;
    return { ...x, order: lovedSet.get(best.id), why };
  })
  .sort((a, b) => a.order - b.order || b.score - a.score);

const catalogs = {
  movie: {
    'da-vedere': { name: 'Da vedere per te', metas: wl.filter(x => x.media === 'movie') },
    'sotto-100': { name: `Sotto i ${A.short_runtime_max} minuti`, metas: wl.filter(x => x.media === 'movie' && x.it.runtime && x.it.runtime < A.short_runtime_max) },
    'registi': { name: 'Registi che ami', metas: directorsList },
    'suggeriti': { name: 'Suggeriti per te', metas: fromRank(rk.suggestions_addon.movie) },
  },
  series: {
    'da-vedere': { name: 'Da vedere per te', metas: wl.filter(x => x.media === 'tv') },
    'suggeriti': { name: 'Suggeriti per te', metas: fromRank(rk.suggestions_addon.tv) },
  },
};

// ---- Scrittura ----
fs.rmSync(p('docs', 'catalog'), { recursive: true, force: true });
const manifestCatalogs = [];
const counts = [];
for (const [type, cats] of Object.entries(catalogs)) {
  for (const [id, c] of Object.entries(cats)) {
    const metas = dedupe(c.metas.map(meta));
    writeJson(p('docs', 'catalog', type, `${id}.json`), { metas }, false);
    manifestCatalogs.push({ type, id, name: c.name });
    counts.push([`${type}/${id}`, metas.length]);
  }
}
const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const manifest = {
  id: 'io.github.lamaslamas.watchlist',
  version: `1.${day}.0`, // semver crescente a ogni build: i client ricaricano i cataloghi
  name: 'Watchlist',
  description: 'I film e le serie che voglio vedere, ordinati in base ai miei gusti. Solo cataloghi.',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: manifestCatalogs,
  behaviorHints: { configurable: false, configurationRequired: false },
};
writeJson(p('docs', 'manifest.json'), manifest);
console.table(Object.fromEntries(counts.map(([k, n]) => [k, { titoli: n }])));
if (skipped.noImdb) console.log(`Esclusi per mancanza di ID IMDb: ${skipped.noImdb}`);
console.log(`Manifest: ${A.base_url}/manifest.json`);
