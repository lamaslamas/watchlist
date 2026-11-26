import test from 'node:test';
import assert from 'node:assert/strict';
import { planSeed, seedPayloads, chunkBody, buildTitles } from '../src/lib/trakt-logic.js';

const T = (media, id, o = {}) => ({ key: `${media}:${id}`, media, tmdb_id: id, name: `T${id}`, year: 2000, my_rating: null, rated_at: null, status: 'watchlist', ...o });
const state = (o = {}) => ({ ratings: [], watchlist: [], watched: [], ...o });
const X = (media, tmdb, o = {}) => ({ media, tmdb, imdb: `tt${tmdb}`, title: `T${tmdb}`, year: 2000, ...o });

test('planSeed: separa voti mancanti, uguali e in conflitto (vale Trakt)', () => {
  const csv = [T('movie', 1, { my_rating: 8, status: 'seen' }), T('movie', 2, { my_rating: 6, status: 'seen' }), T('movie', 3, { my_rating: 9, status: 'seen' })];
  const plan = planSeed(csv, state({ ratings: [X('movie', 2, { rating: 6 }), X('movie', 3, { rating: 7 })] }));
  assert.deepEqual(plan.ratingsMissing.map(t => t.tmdb_id), [1]);
  assert.equal(plan.ok.ratings, 1);
  assert.deepEqual(plan.ratingConflicts.map(c => [c.title.tmdb_id, c.csv, c.trakt]), [[3, 9, 7]]);
});

test('planSeed: watchlist — non carica ciò che è già in lista o già visto su Trakt; distingue film e serie con lo stesso id', () => {
  const csv = [T('movie', 1), T('movie', 2), T('movie', 3), T('tv', 1)];
  const plan = planSeed(csv, state({ watchlist: [X('movie', 1)], watched: [X('movie', 2, { plays: 1 })] }));
  assert.deepEqual(plan.watchlistMissing.map(t => t.key), ['movie:3', 'tv:1']);
  assert.deepEqual(plan.alreadySeenOnTrakt.map(t => t.key), ['movie:2']);
  assert.equal(plan.ok.watchlist, 1);
});

test('planSeed: visti senza voto assenti su Trakt finiscono a parte', () => {
  const plan = planSeed([T('movie', 5, { status: 'seen' }), T('movie', 6, { status: 'seen' })], state({ watched: [X('movie', 6)] }));
  assert.deepEqual(plan.watchedMissing.map(t => t.key), ['movie:5']);
});

test('seedPayloads: usa id TMDB, conserva la data del voto, "released" per i visti senza data; la cronologia solo se richiesta', () => {
  const plan = planSeed([T('movie', 1, { my_rating: 8, rated_at: '2026-02-03', status: 'seen' }), T('tv', 2, { my_rating: 9, status: 'seen' }), T('movie', 3), T('movie', 4, { status: 'seen' })], state());
  const base = seedPayloads(plan);
  assert.deepEqual(base.map(x => x.path), ['/sync/ratings', '/sync/watchlist']);
  assert.deepEqual(base[0].body.movies, [{ ids: { tmdb: 1 }, rating: 8, rated_at: '2026-02-03T00:00:00.000Z' }]);
  assert.deepEqual(base[0].body.shows, [{ ids: { tmdb: 2 }, rating: 9 }]);
  assert.deepEqual(base[1].body, { movies: [{ ids: { tmdb: 3 } }], shows: [] });
  const withHist = seedPayloads(plan, { includeWatched: true });
  assert.deepEqual(withHist.at(-1).body.movies, [{ ids: { tmdb: 4 }, watched_at: 'released' }]);
});

test('chunkBody: blocchi da massimo `size`, senza perdere elementi', () => {
  const body = { movies: Array.from({ length: 250 }, (_, i) => ({ ids: { tmdb: i } })), shows: [{ ids: { tmdb: 1 } }] };
  const chunks = chunkBody(body, 100);
  assert.equal(chunks.length, 4);
  assert.equal(chunks.reduce((n, c) => n + (c.movies?.length ?? 0) + (c.shows?.length ?? 0), 0), 251);
});

test('buildTitles: voto o film guardato = visto, e esce dalla watchlist', () => {
  const titles = buildTitles(state({
    ratings: [X('movie', 1, { rating: 9, at: '2026-01-01T00:00:00.000Z' })],
    watchlist: [X('movie', 1), X('movie', 2), X('movie', 3)],
    watched: [X('movie', 2, { plays: 1, at: '2026-02-02T10:00:00.000Z' })],
  }));
  const by = Object.fromEntries(titles.map(t => [t.key, t]));
  assert.equal(by['movie:1'].status, 'seen'); assert.equal(by['movie:1'].my_rating, 9); assert.equal(by['movie:1'].watchlisted, false);
  assert.equal(by['movie:2'].status, 'seen'); assert.equal(by['movie:2'].watched_at, '2026-02-02T10:00:00.000Z');
  assert.equal(by['movie:3'].status, 'watchlist');
});

test('buildTitles: una serie esce solo se completata; iniziata resta in watchlist', () => {
  const cache = { 'tv:10': { data: { episodes: 10 } }, 'tv:11': { data: { episodes: 10 } } };
  const titles = buildTitles(state({
    watchlist: [X('tv', 10), X('tv', 11), X('tv', 12)],
    watched: [X('tv', 10, { episodes_watched: 3 }), X('tv', 11, { episodes_watched: 10 }), X('tv', 12, { episodes_watched: 5 })],
  }), cache, { completionRatio: 0.9 });
  const by = Object.fromEntries(titles.map(t => [t.key, t.status]));
  assert.deepEqual(by, { 'tv:10': 'watchlist', 'tv:11': 'seen', 'tv:12': 'watchlist' }); // tv:12 senza dati TMDB: non si può dire che sia completata
});

test('buildTitles: ignora elementi senza id TMDB e distingue serie/film con lo stesso id', () => {
  const titles = buildTitles(state({ watchlist: [X('movie', 7), X('tv', 7), { media: 'movie', tmdb: null, title: 'x' }] }));
  assert.deepEqual(titles.map(t => t.key).sort(), ['movie:7', 'tv:7']);
});

test('buildTitles: i titoli extra del repo entrano in watchlist o tra i visti, e Trakt ha la precedenza sui visti', () => {
  const extra = { watchlist: [X('tv', 20), X('movie', 21)], seen: [X('movie', 22)] };
  const titles = buildTitles(state({ ratings: [X('movie', 21, { rating: 8, at: '2026-03-03T00:00:00.000Z' })] }), {}, { extra });
  const by = Object.fromEntries(titles.map(t => [t.key, t]));
  assert.equal(by['tv:20'].status, 'watchlist');
  assert.equal(by['movie:21'].status, 'seen'); // votato su Trakt: esce anche se è nell'elenco extra
  assert.equal(by['movie:21'].watchlisted, false);
  assert.equal(by['movie:22'].status, 'seen');
  assert.ok(by['tv:20'].sources.includes('extra'));
});

test('buildTitles: le voci in elenco "ignore" non entrano nei titoli', () => {
  const titles = buildTitles(state({ watchlist: [X('movie', 1), X('movie', 2)] }), {}, { ignore: ['movie:2'] });
  assert.deepEqual(titles.map(t => t.key), ['movie:1']);
});
