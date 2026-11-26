import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/lib/util.js';
import { buildProfile, quality, bandCutoffs, bandOf, makeScorer } from '../src/ranking.js';

const cfg = loadConfig();
const mk = (key, my, avg, extra = {}) => ({ key, media: 'movie', title: key, my, d: { vote_average: avg, vote_count: 1000, year: 1999, directors: [{ id: 1, name: 'A' }], genres: [], cast: [], countries: [], keywords: [], ...extra } });

test('la config è coerente: pesi T e fasce sommano 1', () => {
  const sum = o => Object.values(o).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum(cfg.affinity.weights) - 1) < 1e-9);
  assert.ok(Math.abs(cfg.bands.reduce((s, b) => s + b.share, 0) - 1) < 1e-9);
  for (const m of ['movie', 'tv']) assert.ok(Math.abs(cfg.score[m].taste + cfg.score[m].quality - 1) < 1e-9);
});

test('peso = somma(segnali)/(n+k), con segnale = scarto + lambda*(mio - mia media)', () => {
  const rated = [mk('x', 10, 6), mk('y', 8, 8)]; // media mia = 9
  const prof = buildProfile(rated, cfg);
  const { k, lambda } = cfg.profile;
  const s = (my, avg) => (my - avg) + lambda * (my - 9);
  assert.ok(Math.abs(prof.table.directors.get(1).w - (s(10, 6) + s(8, 8)) / (2 + k)) < 1e-9);
  assert.equal(prof.table.directors.get(1).n, 2);
});

test('più campioni, meno smorzamento: stesso scarto medio pesa di più con n maggiore', () => {
  const one = buildProfile([mk('a', 10, 6), mk('z', 7, 7, { directors: [{ id: 9 }] })], cfg).table.directors.get(1).w;
  const four = buildProfile([mk('a', 10, 6), mk('b', 10, 6), mk('c', 10, 6), mk('d', 10, 6), mk('z', 7, 7, { directors: [{ id: 9 }] })], cfg).table.directors.get(1).w;
  assert.ok(four > one);
});

test('leave-one-out esclude il titolo', () => {
  const rated = [mk('x', 10, 6), mk('y', 8, 8)];
  assert.equal(buildProfile(rated, cfg, 'x').table.directors.get(1).n, 1);
});

test('qualità: senza voti torna alla media globale; molti voti e 10 → ~1; sempre in 0-1', () => {
  const q0 = quality({ vote_average: 9.9, vote_count: 0 }, cfg);
  assert.ok(Math.abs(q0 - (cfg.quality.global_mean - cfg.quality.floor) / (cfg.quality.ceiling - cfg.quality.floor)) < 1e-9);
  assert.ok(quality({ vote_average: 10, vote_count: 1e7 }, cfg) > 0.99);
  assert.equal(quality({ vote_average: 1, vote_count: 1e6 }, cfg), 0);
});

test('fasce per percentile: 10/25/35/30 su 100 titoli', () => {
  const scores = Array.from({ length: 100 }, (_, i) => i + 1);
  const cut = bandCutoffs(scores, cfg);
  const counts = [0, 0, 0, 0];
  for (const s of scores) counts[bandOf(s, cut)]++;
  assert.deepEqual(counts, [10, 25, 35, 30]);
});

test('lo scorer premia ciò che il profilo ama e penalizza il contrario', () => {
  const rated = [mk('a', 10, 6), mk('b', 10, 6), mk('c', 3, 7, { directors: [{ id: 2 }] }), mk('d', 3, 7, { directors: [{ id: 2 }] })];
  const prof = buildProfile(rated, cfg);
  const good = mk('g', null, 7, { directors: [{ id: 1 }] }), bad = mk('h', null, 7, { directors: [{ id: 2 }] });
  const sc = makeScorer([good, bad], prof, cfg);
  assert.ok(sc(good).score > sc(bad).score);
});
