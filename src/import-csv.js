// Legge gli export iniziali (IMDb + Letterboxd) e produce data/state/sources.json:
// un record per riga, con voti già portati su scala 0-10. Nessuna chiamata di rete.
import { p, readCsv, writeJson } from './lib/util.js';

const RAW = p('data', 'raw');
const imdbKind = t => (/^TV (Mini )?Series$/.test(t) ? 'tv' : 'movie'); // TV Movie, Short, Video → film

const records = [];

// IMDb: voti
for (const r of readCsv(`${RAW}/imdb-ratings.csv`)) {
  const rating = Number(r['Your Rating']);
  if (!r.Const || !(rating >= 1 && rating <= 10)) continue;
  records.push({
    src: 'imdb', kind: 'rating', imdb: r.Const, media: imdbKind(r['Title Type']),
    title: r.Title, original: r['Original Title'], year: Number(r.Year) || null,
    rating, date: r['Date Rated'] || null,
  });
}
// IMDb: watchlist (alcune righe hanno anche un voto: diventano voti)
for (const r of readCsv(`${RAW}/imdb-watchlist.csv`)) {
  if (!r.Const) continue;
  const base = {
    src: 'imdb', imdb: r.Const, media: imdbKind(r['Title Type']),
    title: r.Title, original: r['Original Title'], year: Number(r.Year) || null,
  };
  const rating = Number(r['Your Rating']);
  if (rating >= 1 && rating <= 10) records.push({ ...base, kind: 'rating', rating, date: r['Date Rated'] || null });
  records.push({ ...base, kind: 'watchlist', date: r.Created || null });
}

// Letterboxd (solo nome+anno+URI: gli ID si risolvono dopo, via TMDB)
const lb = (name, header) => readCsv(`${RAW}/letterboxd/${name}`, header);
const lbBase = r => ({ src: 'letterboxd', title: r.Name, original: r.Name, year: Number(r.Year) || null, lbUri: r['Letterboxd URI'] || r.URL });
for (const r of lb('ratings.csv', 'Date,')) {
  const stars = Number(r.Rating);
  if (stars > 0) records.push({ ...lbBase(r), kind: 'rating', media: 'movie', rating: stars * 2, date: r.Date });
}
for (const r of lb('watched.csv', 'Date,')) records.push({ ...lbBase(r), kind: 'watched', media: 'movie', date: r.Date });
for (const r of lb('watchlist.csv', 'Date,')) records.push({ ...lbBase(r), kind: 'watchlist', media: 'movie', date: r.Date });
// Lista "Series" di Letterboxd: da trattare come watchlist (contiene però solo film: vedi il tipo "unknown" → prova film, poi serie)
for (const r of lb('lists/series.csv', 'Position,')) records.push({ ...lbBase(r), kind: 'watchlist', media: 'unknown', list: 'series' });
// lists/horror-p.csv: ignorata su richiesta

const counts = {};
for (const r of records) counts[`${r.src}/${r.kind}`] = (counts[`${r.src}/${r.kind}`] ?? 0) + 1;
writeJson(p('data', 'state', 'sources.json'), records);
console.log('Record letti:', records.length);
console.table(counts);
