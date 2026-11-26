// Arricchisce i titoli (visti con voto + watchlist) con i dati TMDB e li salva in data/cache/tmdb.json.
// Incrementale: chiede a TMDB solo i titoli nuovi. La disponibilità streaming (IT) si aggiorna ogni
// `tmdb.providers_refresh_days` giorni, solo per i titoli ancora da vedere (watchlist e suggeriti).
// Uso: node src/enrich.js [--force-providers]
import { p, readJson, writeJson, loadConfig } from './lib/util.js';
import { tmdb, pool } from './lib/tmdb.js';

const cfg = loadConfig();
const REGION = cfg.tmdb.region;
const DAY = 86400e3;
const now = Date.now();
const forceProviders = process.argv.includes('--force-providers');

const titles = readJson(p('data', 'state', 'titles.json'));
if (!titles) throw new Error('Esegui prima: npm run resolve');
const cachePath = p('data', 'cache', 'tmdb.json');
const cache = readJson(cachePath, {});

const compactProviders = res => {
  const it = res?.results?.[REGION];
  const pick = list => (list ?? []).map(x => ({ id: x.provider_id, name: x.provider_name, logo: x.logo_path }));
  return it ? { link: it.link ?? null, flatrate: pick(it.flatrate), free: pick(it.free), ads: pick(it.ads), rent: pick(it.rent), buy: pick(it.buy) }
            : { link: null, flatrate: [], free: [], ads: [], rent: [], buy: [] };
};

function shape(media, d, en) {
  const date = d.release_date || d.first_air_date || '';
  const credits = d.credits ?? {};
  const people = list => (list ?? []).map(x => ({ id: x.id, name: x.name }));
  return {
    id: d.id, media,
    imdb_id: d.external_ids?.imdb_id || d.imdb_id || null,
    title: d.title ?? d.name, original_title: d.original_title ?? d.original_name,
    overview: d.overview || en?.overview || '',
    year: Number(date.slice(0, 4)) || null, release_date: date || null,
    runtime: media === 'movie' ? (d.runtime || null) : (d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || null),
    countries: media === 'movie' ? (d.production_countries ?? []).map(c => c.iso_3166_1) : (d.origin_country ?? []),
    original_language: d.original_language,
    genres: (d.genres ?? []).map(g => ({ id: g.id, name: g.name })),
    directors: media === 'movie'
      ? people((credits.crew ?? []).filter(c => c.job === 'Director')).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i)
      : people(d.created_by),
    cast: people((credits.cast ?? []).slice(0, 5)),
    keywords: (d.keywords?.keywords ?? d.keywords?.results ?? []).map(k => ({ id: k.id, name: k.name })),
    seasons: media === 'tv' ? d.number_of_seasons ?? null : null,
    episodes: media === 'tv' ? d.number_of_episodes ?? null : null,
    poster: d.poster_path || en?.poster_path || null,
    vote_average: d.vote_average ?? null, vote_count: d.vote_count ?? 0,
    collection: d.belongs_to_collection?.id ?? null,
  };
}

async function fetchFull(t) {
  const path = `/${t.media}/${t.tmdb_id}`;
  const append = 'credits,keywords,external_ids,watch/providers';
  const d = await tmdb(path, { language: cfg.tmdb.language, append_to_response: append });
  if (!d) return null;
  // Se in italiano manca trama o locandina, ripiego sull'inglese
  const en = (!d.overview || !d.poster_path) ? await tmdb(path, { language: 'en-US' }) : null;
  return { fetched_at: now, providers_at: now, data: shape(t.media, d, en), providers: compactProviders(d['watch/providers']) };
}

// Titoli suggeriti (da src/suggest.js): servono i loro dati per poterli ordinare
const suggested = readJson(p('data', 'state', 'suggestions.json'), []).map(s => ({ key: s.key, media: s.media, tmdb_id: s.tmdb_id, status: 'suggested' }));
const wanted = [...titles.filter(t => t.status === 'watchlist' || t.my_rating != null), ...suggested];
const missing = wanted.filter(t => !cache[t.key]);
console.log(`Titoli da arricchire: ${wanted.length} — nuovi: ${missing.length}`);
let done = 0;
const failed = [];
await pool(missing, 8, async t => {
  const e = await fetchFull(t);
  if (e) cache[t.key] = e; else failed.push(t.key);
  if (++done % 100 === 0) console.log(`  ${done}/${missing.length}`);
});

// Aggiornamento settimanale dei provider (solo watchlist)
const stale = wanted.filter(t => t.status !== 'seen' && cache[t.key] &&
  (forceProviders || now - (cache[t.key].providers_at ?? 0) > cfg.tmdb.providers_refresh_days * DAY) && cache[t.key].fetched_at !== now);
await pool(stale, 8, async t => {
  const res = await tmdb(`/${t.media}/${t.tmdb_id}/watch/providers`);
  cache[t.key].providers = compactProviders(res);
  cache[t.key].providers_at = now;
});
if (stale.length) console.log(`Provider aggiornati: ${stale.length}`);

writeJson(cachePath, cache, false);
if (failed.length) console.log('Non trovati su TMDB:', failed.join(', '));
console.log(`Cache: ${Object.keys(cache).length} titoli`);
