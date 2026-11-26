// Ricerca dei pesi con validazione leave-one-out.
//  - per ogni coppia (lambda, k) calcola, per ogni titolo votato, le componenti z con un profilo SENZA quel titolo
//  - poi cerca pesi delle componenti / peso T / ripidezza con campionamento casuale (seme fisso: riproducibile)
//  - i parametri si scelgono sul 70% dei titoli; il restante 30% serve a controllare che non sia overfitting
// Uso: node src/tune.js   → data/state/tuning.json + reports/tuning.md
import fs from 'node:fs';
import { p, writeJson } from './lib/util.js';
import { loadItems } from './lib/data.js';
import { buildProfile, makeScorer, quality, TYPES } from './ranking.js';

const { cfg, rated, watchlist } = loadItems();
const MIN_T = 0.40;
const LAMBDAS = [0.4, 0.6, 0.8, 1.0, 1.25, 1.5];
const KS = [1, 2, 3, 5, 8];
const SAMPLES = 2500;

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261126);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const rankOf = xs => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
const spearman = (a, b) => pearson(rankOf(a), rankOf(b));

const my = rated.map(r => r.my);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const isTrain = rated.map((_, i) => i % 10 < 7);
const pick = (arr, mask, want) => arr.filter((_, i) => mask[i] === want);
const Q = rated.map(r => quality(r.d, cfg));
const baseTop = mean(my);

// ---- 1. componenti z in leave-one-out per ogni (lambda, k) ----
console.log(`Calcolo LOO per ${LAMBDAS.length * KS.length} combinazioni (lambda, k) su ${rated.length} titoli…`);
const grid = [];
for (const lambda of LAMBDAS) for (const k of KS) {
  const c = structuredClone(cfg); c.profile.lambda = lambda; c.profile.k = k;
  const Z = TYPES.map(() => new Float64Array(rated.length));
  rated.forEach((it, i) => {
    const sc = makeScorer(watchlist, buildProfile(rated, c, it.key), c)(it);
    TYPES.forEach((t, j) => { Z[j][i] = sc.contrib[t] / c.affinity.weights[t]; });
  });
  grid.push({ lambda, k, Z });
}

// ---- 2. valutazione di un set di pesi ----
function evaluate(Z, set) {
  const n = rated.length, sc = new Array(n);
  for (let i = 0; i < n; i++) {
    let R = 0; for (let j = 0; j < TYPES.length; j++) R += set.weights[TYPES[j]] * Z[j][i];
    const T = 1 / (1 + Math.exp(-set.steep * R));
    sc[i] = 100 * (set.wT * T + (1 - set.wT) * Q[i]);
  }
  const top50 = sc.map((s, i) => [s, my[i]]).sort((a, b) => b[0] - a[0]).slice(0, 50);
  return {
    spearman: spearman(my, sc),
    train: spearman(pick(my, isTrain, true), pick(sc, isTrain, true)),
    test: spearman(pick(my, isTrain, false), pick(sc, isTrain, false)),
    top50: mean(top50.map(x => x[1])),
  };
}
const normalize = w => { const s = TYPES.reduce((a, t) => a + w[t], 0); return Object.fromEntries(TYPES.map(t => [t, w[t] / s])); };
const round = (w, d = 3) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(d)]));

const current = { weights: cfg.affinity.weights, steep: cfg.affinity.sigmoid_steepness, wT: cfg.score.movie.taste };
const results = [];
for (const g of grid) {
  // il punto di partenza (pesi attuali) entra sempre nel campione, con lo stesso lambda/k
  const cands = [current];
  for (let s = 0; s < SAMPLES; s++) {
    const w = {};
    for (const t of TYPES) w[t] = cfg.affinity.weights[t] * Math.exp(0.9 * gauss());
    if (rand() < 0.5) w.countries = 0; // il paese può azzerarsi
    cands.push({ weights: normalize(w), steep: +(0.5 + rand() * 2.5).toFixed(2), wT: +(MIN_T + rand() * (0.9 - MIN_T)).toFixed(3) });
  }
  for (const set of cands) results.push({ lambda: g.lambda, k: g.k, ...set, m: evaluate(g.Z, set), gz: g });
}
console.log(`Configurazioni valutate: ${results.length}`);

// ---- 3. scelta dei tre set ----
const byTrain = [...results].sort((a, b) => b.m.train - a.m.train);
const best = byTrain[0];
const A = best;
const B = byTrain.filter(r => r.m.train >= best.m.train - 0.01).sort((a, b) => b.m.top50 - a.m.top50)[0];
const C = byTrain.find(r => r.wT >= 0.60);
const baseline = results.find(r => r.weights === current.weights && r.lambda === 0.4 && r.k === 3);

// controllo del paese: se il suo contributo isolato è negativo in LOO, lo azzero (richiesta)
function countryCorr(set) {
  const g = set.gz, j = TYPES.indexOf('countries');
  return spearman(my, Array.from(g.Z[j]));
}
const sets = { A, B, C };
for (const [name, s] of Object.entries(sets)) {
  s.countryCorr = countryCorr(s);
  if (s.countryCorr < 0 && s.weights.countries > 0) {
    const w = normalize({ ...s.weights, countries: 0 });
    s.weights = w; s.m = evaluate(s.gz.Z, s); s.countryZeroed = true;
  }
}

// ---- 4. top 20 della watchlist per ogni set ----
function applyTo(set) {
  const c = structuredClone(cfg);
  c.profile.lambda = set.lambda; c.profile.k = set.k;
  c.affinity.weights = set.weights; c.affinity.sigmoid_steepness = set.steep;
  c.score.movie = { taste: set.wT, quality: +(1 - set.wT).toFixed(3) };
  const prof = buildProfile(rated, c), scorer = makeScorer(watchlist, prof, c);
  return watchlist.map(it => ({ it, s: scorer(it).score })).sort((a, b) => b.s - a.s);
}
const out = { baseline: baseline && { lambda: 0.4, k: 3, ...current, m: baseline.m } };
const ranked = {};
for (const [name, s] of Object.entries({ attuale: baseline, ...sets })) ranked[name] = applyTo(s);
for (const [name, s] of Object.entries(sets)) out[name] = { lambda: s.lambda, k: s.k, steep: s.steep, wT: s.wT, weights: round(s.weights), m: s.m, countryCorr: +s.countryCorr.toFixed(3), countryZeroed: !!s.countryZeroed };
writeJson(p('data', 'state', 'tuning.json'), out);

const f = x => x.toFixed(3);
const lines = ['# Ricerca pesi (leave-one-out)\n', `Titoli votati: ${rated.length}. Base voto medio: ${baseTop.toFixed(2)}. Sets valutati: ${results.length}. Spearman train = 70% titoli (usato per scegliere), test = 30% mai usato.\n`,
  '| set | λ | k | peso T | ripidezza | Spearman tutti | train | test | voto medio top 50 |', '|---|---|---|---|---|---|---|---|---|'];
const row = (n, s) => `| ${n} | ${s.lambda} | ${s.k} | ${s.wT} | ${s.steep} | ${f(s.m.spearman)} | ${f(s.m.train)} | ${f(s.m.test)} | ${s.m.top50.toFixed(2)} |`;
lines.push(row('attuale', { ...baseline, lambda: 0.4, k: 3, wT: current.wT, steep: current.steep }), row('A (max Spearman)', A), row('B (max top 50)', B), row('C (T ≥ 0.60)', C));
lines.push('\n## Pesi delle componenti\n', '| set | ' + TYPES.join(' | ') + ' |', '|---|' + TYPES.map(() => '---').join('|') + '|');
lines.push(`| attuale | ${TYPES.map(t => cfg.affinity.weights[t].toFixed(2)).join(' | ')} |`);
for (const [n, s] of Object.entries(sets)) lines.push(`| ${n} | ${TYPES.map(t => s.weights[t].toFixed(2)).join(' | ')} |`);
lines.push(`\nCorrelazione del solo paese (LOO): ` + Object.entries(sets).map(([n, s]) => `${n} ${s.countryCorr.toFixed(3)}${s.countryZeroed ? ' (azzerato)' : ''}`).join(', ') + '\n');
lines.push('## Top 20 watchlist\n', '| # | attuale | A | B | C |', '|---|---|---|---|---|');
for (let i = 0; i < 20; i++) lines.push(`| ${i + 1} | ${['attuale', 'A', 'B', 'C'].map(n => `${ranked[n][i].it.title} (${ranked[n][i].it.d.year})`).join(' | ')} |`);
fs.mkdirSync(p('reports'), { recursive: true });
fs.writeFileSync(p('reports', 'tuning.md'), lines.join('\n') + '\n');
console.log(lines.slice(2, 12).join('\n'));
