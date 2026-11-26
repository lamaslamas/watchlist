// Aggiornamento da Trakt (fonte principale): legge voti, watchlist e visti e riscrive data/state/titles.json.
//   node src/trakt-sync.js [--force]
// Protezione: se il risultato ha molti meno titoli di quello attuale (es. account vuoto o errore) non scrive, salvo --force.
import { p, readJson, writeJson, loadConfig } from './lib/util.js';
import { readState } from './lib/trakt.js';
import { buildTitles } from './lib/trakt-logic.js';

const force = process.argv.includes('--force');
const cfg = loadConfig();
const state = await readState();
writeJson(p('data', 'state', 'trakt.json'), state);

const cache = readJson(p('data', 'cache', 'tmdb.json'), {});
const extra = readJson(p('config', 'extra-watchlist.json'), {});
const titles = buildTitles(state, cache, { completionRatio: cfg.trakt?.show_completion_ratio ?? 0.9, extra });
const prev = readJson(p('data', 'state', 'titles.json'), []);
const relevant = titles.filter(t => t.status !== 'other');
if (!force && prev.length && relevant.length < prev.length * 0.5) {
  console.error(`✖ Trakt ha ${relevant.length} titoli contro ${prev.length} attuali: non sovrascrivo (usa --force se è voluto).`);
  process.exit(1);
}
writeJson(p('data', 'state', 'titles.json'), relevant);
const c = s => relevant.filter(t => t.status === s).length;
console.log(`(extra dal repo: ${(extra.watchlist ?? []).length} in watchlist, ${(extra.seen ?? []).length} visti)`);
console.log(`Trakt → titles.json: ${relevant.length} titoli (visti ${c('seen')}, watchlist ${c('watchlist')}, con voto ${relevant.filter(t => t.my_rating != null).length}, serie in corso ${relevant.filter(t => t.in_progress).length}).`);
