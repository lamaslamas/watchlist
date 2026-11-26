// Primo avvio: confronta i CSV (titles-csv.json) con il tuo account Trakt e propone cosa caricare.
//   node src/trakt-seed.js                    → riepilogo (NON scrive nulla su Trakt)
//   node src/trakt-seed.js --apply            → scrive su Trakt voti e watchlist mancanti
//   node src/trakt-seed.js --apply --include-watched   → aggiunge anche i "visti senza voto" alla cronologia
import { p, readJson, writeJson } from './lib/util.js';
import { readState, trakt } from './lib/trakt.js';
import { planSeed, seedPayloads, chunkBody } from './lib/trakt-logic.js';

const apply = process.argv.includes('--apply'), includeWatched = process.argv.includes('--include-watched');
const csv = readJson(p('data', 'state', 'titles-csv.json'));
if (!csv) throw new Error('Manca data/state/titles-csv.json (esegui npm run import && npm run resolve)');

console.log('Leggo lo stato del tuo account Trakt…');
const state = await readState();
writeJson(p('data', 'state', 'trakt.json'), state);
console.log(`Trakt oggi: ${state.ratings.length} voti, ${state.watchlist.length} in watchlist, ${state.watched.length} visti.\n`);

const plan = planSeed(csv, state);
const sample = (l, f = t => `${t.name} (${t.year})`) => l.slice(0, 8).map(f).join('; ') + (l.length > 8 ? `; … (+${l.length - 8})` : '');
console.log('=== RIEPILOGO (da CSV a Trakt) ===');
console.log(`Voti già su Trakt e uguali: ${plan.ok.ratings}`);
console.log(`Voti da caricare:           ${plan.ratingsMissing.length}  ${sample(plan.ratingsMissing, t => `${t.name} ${t.my_rating}/10`)}`);
console.log(`Voti diversi (NON tocco, vale Trakt): ${plan.ratingConflicts.length}  ${sample(plan.ratingConflicts, c => `${c.title.name}: CSV ${c.csv} / Trakt ${c.trakt}`)}`);
console.log(`Watchlist già su Trakt:     ${plan.ok.watchlist}`);
console.log(`Watchlist da caricare:      ${plan.watchlistMissing.length}  ${sample(plan.watchlistMissing)}`);
console.log(`In watchlist CSV ma già visti/votati su Trakt (non aggiungo): ${plan.alreadySeenOnTrakt.length}`);
console.log(`Visti senza voto (Letterboxd), assenti su Trakt: ${plan.watchedMissing.length}  ${sample(plan.watchedMissing)}  ${includeWatched ? '→ verranno aggiunti' : '→ solo con --include-watched'}`);

const payloads = seedPayloads(plan, { includeWatched });
const series = list => list.filter(t => t.media === 'tv').length;
console.log(`\nSerie incluse: voti ${series(plan.ratingsMissing)}, watchlist ${series(plan.watchlistMissing)}.`);
writeJson(p('data', 'state', 'trakt-seed-plan.json'), { generated_at: new Date().toISOString(), counts: payloads.map(x => [x.label, x.count]) });

if (!apply) { console.log('\nDry-run: non ho scritto nulla. Per caricare: node src/trakt-seed.js --apply'); process.exit(0); }

console.log('\n=== SCRITTURA SU TRAKT ===');
for (const pl of payloads) {
  const added = { movies: 0, shows: 0 }, notFound = [];
  for (const body of chunkBody(pl.body)) {
    const { data } = await trakt('POST', pl.path, { body });
    for (const k of ['movies', 'shows']) added[k] += data?.added?.[k] ?? 0;
    for (const k of ['movies', 'shows']) notFound.push(...(data?.not_found?.[k] ?? []).map(x => x.ids?.tmdb));
  }
  console.log(`${pl.label}: inviati ${pl.count}, aggiunti film ${added.movies} / serie ${added.shows}${notFound.length ? `, NON trovati (tmdb): ${notFound.join(', ')}` : ''}`);
}
console.log('Fatto. Rilancia senza --apply per verificare che il riepilogo sia a zero.');
