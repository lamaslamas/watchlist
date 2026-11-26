// Associa ogni record di sources.json a un ID TMDB (e IMDb), unisce i duplicati e
// scrive data/state/titles.json + data/state/ambiguous.json.
//  - IMDb: /find per ID (esatto).
//  - Letterboxd: ricerca per nome+anno; accettata solo se il titolo coincide e l'anno è identico.
//    Altrimenti il caso finisce in ambiguous.json e NON entra nei titoli finché non lo risolvi.
import { p, readJson, writeJson, loadConfig, norm } from './lib/util.js';
import { tmdb, pool } from './lib/tmdb.js';

const cfg = loadConfig();
const records = readJson(p('data', 'state', 'sources.json'));
if (!records) throw new Error('Esegui prima: npm run import');
const cachePath = p('data', 'cache', 'resolve.json');
const cache = readJson(cachePath, {});
const overrides = readJson(p('config', 'match-overrides.json'), {}); // "lb:<uri>": {media, id} oppure null per scartare

const yearOf = r => Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null;
const key = (media, id) => `${media}:${id}`;

async function searchOne(media, name, year) {
  // Due ricerche (inglese e italiano): Letterboxd usa titoli inglesi, TMDB in it-IT mostra quelli italiani.
  const byId = new Map();
  for (const language of ['en-US', cfg.tmdb.language]) {
    const q = { query: name, language, include_adult: 'false' };
    const data = await tmdb(`/search/${media}`, media === 'movie' ? { ...q, year } : { ...q, first_air_date_year: year });
    for (const r of (data?.results ?? []).slice(0, 8)) {
      const c = byId.get(r.id) ?? { media, id: r.id, names: [], year: yearOf(r), votes: r.vote_count };
      c.names.push(r.title ?? r.name, r.original_title ?? r.original_name);
      c.title = c.title ?? (r.title ?? r.name);
      byId.set(r.id, c);
    }
  }
  return [...byId.values()];
}

/** Cerca per nome+anno e applica la regola di accettazione. `names` = titoli alternativi da provare. */
async function searchResolve(rec, medias, names) {
  const tol = cfg.matching.year_tolerance;
  const wanted = new Set(names.filter(Boolean).map(norm));
  let cands = [];
  for (const m of medias) for (const n of new Set(names.filter(Boolean))) cands.push(...await searchOne(m, n, rec.year));
  const seen = new Set(); cands = cands.filter(c => !seen.has(c.media + c.id) && seen.add(c.media + c.id));
  const rawNames = names.filter(Boolean).map(n => n.toLowerCase());
  // nome coincidente, oppure TMDB ha un sottotitolo ("Wake Up Dead Man: A Knives Out Mystery")
  const nameOk = c => c.names.some(n => wanted.has(norm(n)) || rawNames.some(w => n?.toLowerCase().startsWith(w + ':')));
  const slim = c => ({ media: c.media, id: c.id, title: c.title, year: c.year, votes: c.votes });
  const pick = c => ({ media: c.media, id: c.id });
  const byVotes = list => [...list].sort((a, b) => b.votes - a.votes);
  // Candidati con anno entro la tolleranza (Letterboxd usa l'anno di prima uscita, TMDB spesso quello dell'uscita nazionale)
  let inRange = cands.filter(c => nameOk(c) && c.year && rec.year && Math.abs(c.year - rec.year) <= tol);
  // I match "col sottotitolo" valgono solo se non esiste un titolo con nome identico
  const exactName = inRange.filter(c => c.names.some(n => wanted.has(norm(n))));
  if (exactName.length) inRange = exactName;
  // Film e serie competono sullo stesso piano: vince il titolo con molti più voti (es. la miniserie HBO "Chernobyl"
  // contro un film russo omonimo dello stesso anno); se non c'è un vincitore netto resta ambiguo.
  const ranked = byVotes(inRange);
  if (ranked.length) {
    const [top, second] = ranked;
    // Dominante: 10x i voti del secondo; basta 2x se il primo ha anche l'anno esatto
    const dominant = !second || (top.votes >= 20 && top.votes >= (top.year === rec.year ? 2 : 10) * second.votes);
    if (dominant) {
      return top.year === rec.year
        ? { status: 'ok', ...pick(top) }
        : { status: 'ok_year', reason: `anno ${top.year} su TMDB vs ${rec.year}`, ...pick(top), candidates: [slim(top)] };
    }
    return { status: 'ambiguous', reason: 'più titoli con nome e anno compatibili', pick: pick(top), candidates: ranked.map(slim) };
  }
  return { status: 'unresolved', reason: 'nessun titolo con nome e anno coincidenti', candidates: cands.slice(0, 5).map(slim) };
}

async function resolveImdb(rec) {
  const ck = `imdb2:${rec.imdb}`;
  const ov = overrides[`imdb:${rec.imdb}`];
  if (ov !== undefined) return ov === null ? { status: 'skip' } : { status: 'ok', ...ov };
  if (cache[ck] !== undefined) return cache[ck];
  const f = await tmdb(`/find/${rec.imdb}`, { external_source: 'imdb_id' });
  const mov = f?.movie_results?.[0], tv = f?.tv_results?.[0];
  let hit = rec.media === 'tv' ? (tv ? { media: 'tv', id: tv.id } : mov ? { media: 'movie', id: mov.id } : null)
                               : (mov ? { media: 'movie', id: mov.id } : tv ? { media: 'tv', id: tv.id } : null);
  // ID IMDb non presente in TMDB: ripiego sulla ricerca per titolo originale/anno
  const res = hit ? { status: 'ok', ...hit }
    : await searchResolve(rec, rec.media === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'], [rec.original, rec.title]);
  return (cache[ck] = res);
}

async function resolveLetterboxd(rec) {
  const ck = `lb2:${rec.lbUri}`;
  const ov = overrides[`lb:${rec.lbUri}`];
  if (ov !== undefined) return ov === null ? { status: 'skip' } : { status: 'ok', ...ov };
  if (cache[ck] !== undefined) return cache[ck];
  // Letterboxd contiene anche miniserie/serie: cerca prima tra i film, poi tra le serie
  return (cache[ck] = await searchResolve(rec, ['movie', 'tv'], [rec.title]));
}

const todo = records.filter(r => r.src === 'imdb' || r.src === 'letterboxd');
const uniq = new Map();
for (const r of todo) uniq.set(r.src === 'imdb' ? `imdb:${r.imdb}` : `lb:${r.lbUri}`, r);
console.log(`Da risolvere: ${uniq.size} titoli unici`);
let done = 0;
const results = new Map();
await pool([...uniq], 8, async ([k, r]) => {
  results.set(k, r.src === 'imdb' ? await resolveImdb(r) : await resolveLetterboxd(r));
  if (++done % 100 === 0) console.log(`  ${done}/${uniq.size}`);
});
writeJson(cachePath, cache);

// Unione per (media, tmdb id)
const titles = new Map();
const ambiguous = new Map(), unresolved = new Map(), accepted = new Map();
for (const r of records) {
  const k = r.src === 'imdb' ? `imdb:${r.imdb}` : `lb:${r.lbUri}`;
  const res = results.get(k);
  if (!res || res.status === 'skip') continue;
  if (res.status === 'unresolved') { unresolved.set(k, { key: k, title: r.title, year: r.year, reason: res.reason, candidates: res.candidates }); continue; }
  const hit = res.status === 'ambiguous' ? res.pick : res;
  if (res.status === 'ambiguous') ambiguous.set(k, { key: k, title: r.title, year: r.year, reason: res.reason, pick: res.pick, candidates: res.candidates });
  if (res.status === 'ok_year') accepted.set(k, { key: k, title: r.title, year: r.year, reason: res.reason, pick: { media: res.media, id: res.id } });
  const id = key(hit.media, hit.id);
  const t = titles.get(id) ?? { key: id, media: hit.media, tmdb_id: hit.id, imdb_id: null, name: r.title, year: r.year, ratings: [], watchlisted: false, watched: false, lb_uri: null, sources: [] };
  if (r.imdb) t.imdb_id = r.imdb;
  if (r.lbUri) t.lb_uri = r.lbUri;
  if (!t.sources.includes(r.src)) t.sources.push(r.src);
  if (r.kind === 'rating') t.ratings.push({ src: r.src, value: r.rating, date: r.date });
  if (r.kind === 'watchlist') t.watchlisted = true;
  if (r.kind === 'watched') t.watched = true;
  titles.set(id, t);
}
for (const t of titles.values()) {
  // voto valido = il più recente; a parità di data, quello IMDb (scala intera) vale quanto Letterboxd
  t.ratings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  t.my_rating = t.ratings[0]?.value ?? null;
  t.rated_at = t.ratings[0]?.date ?? null;
  t.status = t.my_rating != null || t.watched ? 'seen' : 'watchlist';
  if (t.status === 'seen') t.watchlisted = false; // visto ⇒ fuori dalla watchlist
}
const list = [...titles.values()];
writeJson(p('data', 'state', 'titles-csv.json'), list); // import iniziale da CSV: serve solo al seed verso Trakt
writeJson(p('data', 'state', 'ambiguous.json'), { ambiguous: [...ambiguous.values()], unresolved: [...unresolved.values()], accepted_with_year_diff: [...accepted.values()] });
const c = s => list.filter(t => t.status === s).length;
console.log(`Titoli unici: ${list.length} (visti: ${c('seen')}, watchlist: ${c('watchlist')}, di cui con voto: ${list.filter(t => t.my_rating != null).length})`);
console.log(`Ambigui: ${ambiguous.size} — Non risolti: ${unresolved.size} — Accettati con anno diverso: ${accepted.size} → data/state/ambiguous.json`);
