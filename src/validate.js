// Validazione leave-one-out: per ogni titolo votato ricostruisce il profilo SENZA quel titolo e guarda
// se T (e il punteggio) ordinano i voti come li ho dati io. Correlazione di Spearman.
import { loadItems } from './lib/data.js';
import { buildProfile, makeScorer } from './ranking.js';

const { cfg, rated, watchlist } = loadItems();
const rank = xs => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x) / n, mb = b.reduce((s, x) => s + x) / n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
const spearman = (a, b) => pearson(rank(a), rank(b));

const my = [], T = [], S = [], Q = [], R = [];
for (const it of rated) {
  const prof = buildProfile(rated, cfg, it.key);
  const sc = makeScorer(watchlist, prof, cfg)(it);
  my.push(it.my); T.push(sc.T); Q.push(sc.Q); S.push(sc.score);
}
const avgMy = my.reduce((s, x) => s + x) / my.length;
console.log(`Titoli votati: ${rated.length}, voto medio ${avgMy.toFixed(2)}/10`);
console.log(`Spearman(voto, T gusto)       = ${spearman(my, T).toFixed(3)}`);
console.log(`Spearman(voto, Q qualità)     = ${spearman(my, Q).toFixed(3)}`);
console.log(`Spearman(voto, score finale)  = ${spearman(my, S).toFixed(3)}`);
// precisione sui "top": dei 50 con score più alto, quanti hanno voto >= 8?
const top = S.map((s, i) => [s, my[i]]).sort((a, b) => b[0] - a[0]).slice(0, 50);
console.log(`Tra i 50 con score più alto, voto medio reale: ${(top.reduce((s, x) => s + x[1], 0) / 50).toFixed(2)} (base ${avgMy.toFixed(2)})`);
