// "Suggeriti per te": candidati fuori da watchlist/visti, ottenuti da
//  - raccomandazioni e "simili" TMDB dei miei titoli votati più alto (seed)
//  - altre opere dei registi con peso più alto nel profilo
// Salva i candidati in data/state/suggestions.json; i dati completi li prende enrich.js e li ordina rank.js.
import { p, writeJson } from './lib/util.js';
import { tmdb, pool } from './lib/tmdb.js';
import { loadItems } from './lib/data.js';
import { buildProfile } from './ranking.js';

const { cfg, rated, seenKeys } = loadItems();
const S = cfg.suggestions;
const profile = buildProfile(rated, cfg);

const seedScore = r => r.my * 100 + (r.my - (r.d.vote_average || cfg.quality.global_mean));
const byScore = [...rated].sort((a, b) => seedScore(b) - seedScore(a));
const seeds = byScore.slice(0, S.seed_top_rated);
for (const r of byScore.filter(r => r.media === 'tv' && r.my >= 7).slice(0, S.seed_top_rated_tv ?? 0)) if (!seeds.includes(r)) seeds.push(r);
console.log(`Seed: ${seeds.length} (voto minimo ${seeds.at(-1).my})`);

const cands = new Map(); // key → { key, media, tmdb_id, votes, via: [...] }
const add = (media, r, via) => {
  const key = `${media}:${r.id}`;
  if (seenKeys.has(key) || r.adult) return;
  if ((r.vote_count ?? 0) < (media === 'tv' ? S.min_vote_count_tv : S.min_vote_count)) return;
  const c = cands.get(key) ?? { key, media, tmdb_id: r.id, via: [] };
  c.via.push(via);
  cands.set(key, c);
};

const jobs = [];
for (const seed of seeds) for (const src of ['recommendations', 'similar'].filter(x => S.sources.includes(x)))
  jobs.push(async () => {
    const res = await tmdb(`/${seed.media}/${seed.tmdb_id}/${src}`, { language: cfg.tmdb.language });
    for (const r of res?.results ?? []) add(seed.media, r, { type: src, seed: seed.title, my: seed.my });
  });

if (S.sources.includes('top_director_filmography')) {
  // nomi dei registi dai titoli votati
  const names = new Map();
  for (const r of rated) for (const x of r.d.directors) names.set(x.id, x.name);
  const top = [...profile.table.directors].filter(([, e]) => e.w > 0).sort((a, b) => b[1].w - a[1].w).slice(0, S.top_directors);
  console.log('Registi con peso più alto:', top.map(([id, e]) => `${names.get(id)} (${e.w.toFixed(2)}, ${e.n})`).join(', '));
  for (const [id, e] of top) jobs.push(async () => {
    const res = await tmdb(`/person/${id}/movie_credits`, { language: cfg.tmdb.language });
    for (const r of (res?.crew ?? []).filter(c => c.job === 'Director'))
      add('movie', r, { type: 'director', seed: names.get(id), my: e.best.my, bestTitle: e.best.t });
  });
}
await pool(jobs, 6, j => j());

const list = [...cands.values()];
writeJson(p('data', 'state', 'suggestions.json'), list);
console.log(`Candidati: ${list.length} (film ${list.filter(c => c.media === 'movie').length}, serie ${list.filter(c => c.media === 'tv').length})`);
