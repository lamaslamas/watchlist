// Calcola profilo di gusto, punteggi, fasce e spiegazioni → data/state/ranking.json
import { p, writeJson } from './lib/util.js';
import { loadItems } from './lib/data.js';
import { buildProfile, makeScorer, bandCutoffs, bandOf, explain, TYPES } from './ranking.js';

const { cfg, rated, watchlist, cache, seenKeys } = loadItems();
const profile = buildProfile(rated, cfg);
const scorer = makeScorer(watchlist, profile, cfg);

const stars = v => String(v / 2).replace('.', ',');
const out = (it, res, extra = {}) => ({
  key: it.key, media: it.media, tmdb_id: it.tmdb_id, imdb_id: it.d.imdb_id, title: it.title, year: it.d.year,
  score: Math.round(res.score * 10) / 10, T: Math.round(res.T * 1000) / 1000, Q: Math.round(res.Q * 1000) / 1000, ...extra,
});

// Watchlist
const wl = watchlist.map(it => ({ it, res: scorer(it) }));
const cutoffs = bandCutoffs(wl.map(x => x.res.score), cfg);
const watchlistOut = wl.map(({ it, res }) => {
  const ex = explain(it, res, profile);
  return out(it, res, { band: bandOf(res.score, cutoffs), why: ex.text, reasons: ex.reasons });
}).sort((a, b) => b.score - a.score);

// Suggeriti
import fs from 'node:fs';
const cands = JSON.parse(fs.existsSync(p('data', 'state', 'suggestions.json')) ? fs.readFileSync(p('data', 'state', 'suggestions.json'), 'utf8') : '[]');
const scored = [];
for (const c of cands) {
  const e = cache[c.key]; if (!e || seenKeys.has(c.key)) continue;
  const it = { key: c.key, media: c.media, tmdb_id: c.tmdb_id, title: e.data.title, d: e.data };
  if ((e.data.vote_count ?? 0) < (c.media === 'tv' ? cfg.suggestions.min_vote_count_tv : cfg.suggestions.min_vote_count)) continue;
  const res = scorer(it);
  const ex = explain(it, res, profile);
  // Perché è stato suggerito: il seed votato più alto che lo ha portato qui
  const via = [...c.via].sort((a, b) => b.my - a.my)[0];
  const viaText = via.type === 'director'
    ? `altro film di ${via.seed}, di cui hai amato «${via.bestTitle}» (${stars(via.my)})`
    : `consigliato da TMDB a chi ha amato «${via.seed}» (${stars(via.my)})`;
  scored.push(out(it, res, { band: bandOf(res.score, cutoffs), why: ex.text, reasons: [viaText, ...ex.reasons], via: viaText, sources: [...new Set(c.via.map(v => v.type))] }));
}
const suggestionsOut = scored.sort((a, b) => b.score - a.score).slice(0, cfg.suggestions.max_items);

// Riassunto del profilo (per il sito e per controllarlo a occhio)
const names = { genres: new Map(), directors: new Map(), cast: new Map(), keywords: new Map() };
for (const r of rated) for (const t of Object.keys(names)) for (const x of r.d[t] ?? []) names[t].set(x.id, x.name);
const regions = new Intl.DisplayNames(['it'], { type: 'region' });
const label = (t, id) => t === 'countries' ? regions.of(id) : t === 'decade' ? `${id}s` : names[t]?.get(id) ?? String(id);
const summary = {};
for (const t of TYPES) {
  const minN = ['directors', 'cast', 'keywords'].includes(t) ? 2 : 1;
  const rows = [...profile.table[t]].filter(([, e]) => e.n >= minN).map(([id, e]) => ({ id, name: label(t, id), w: +e.w.toFixed(2), n: e.n, mean: +(e.mean / 2).toFixed(2) }));
  rows.sort((a, b) => b.w - a.w);
  summary[t] = { top: rows.slice(0, 8), bottom: rows.slice(-4).reverse() };
}

writeJson(p('data', 'state', 'ranking.json'), {
  cutoffs, profile: { rated: profile.count, meanMy: +profile.meanMy.toFixed(2), tvRated: profile.tvRated, summary },
  watchlist: watchlistOut, suggestions: suggestionsOut,
});

// ---- Report a terminale ----
const dist = watchlistOut.map(x => x.score);
console.log(`Profilo: ${profile.count} voti, media ${profile.meanMy.toFixed(2)}/10, serie votate ${profile.tvRated}`);
console.log(`Watchlist: ${watchlistOut.length} titoli — score min ${Math.min(...dist)} / mediana ${dist.sort((a, b) => a - b)[dist.length >> 1]} / max ${Math.max(...dist)}`);
console.log('Fasce (soglia minima):', cutoffs.map(c => `${c.name} ≥ ${c.min.toFixed(1)}`).join(' | '));
console.log('Titoli per fascia:', cfg.bands.map((b, i) => `${b.name}: ${watchlistOut.filter(x => x.band === i).length}`).join(' | '));
const show = (l, n) => l.slice(0, n).forEach((x, i) => console.log(`${String(i + 1).padStart(3)}. ${x.score.toFixed(1)} [${cutoffs[x.band].name.slice(0, 6)}] ${x.title} (${x.year}, ${x.media}) — ${x.why}`));
console.log('\n== TOP watchlist'); show(watchlistOut, 12);
console.log('\n== CODA watchlist'); show(watchlistOut.slice(-6), 6);
console.log(`\n== TOP suggeriti (${suggestionsOut.length}; film ${suggestionsOut.filter(x => x.media === 'movie').length}, serie ${suggestionsOut.filter(x => x.media === 'tv').length})`); show(suggestionsOut, 8);
console.log('\n== Profilo: generi / registi in cima');
for (const t of ['genres', 'directors', 'cast', 'countries', 'decade', 'keywords']) console.log(t.padEnd(10), summary[t].top.slice(0, 5).map(x => `${x.name} ${x.w}(${x.n})`).join(', '), ' || ultimi:', summary[t].bottom.slice(0, 2).map(x => `${x.name} ${x.w}(${x.n})`).join(', '));
