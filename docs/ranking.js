// Ranking: funzioni pure, senza dipendenze Node, usate sia dalla build sia dal browser.
// Un "item" è { key, media, title, d } dove d = dati TMDB compattati (vedi enrich.js).
// Un item votato ha in più `my` (voto 0-10).

export const TYPES = ['genres', 'directors', 'cast', 'countries', 'decade', 'keywords'];

/** Caratteristiche di un titolo come liste di id. */
export function featuresOf(d) {
  return {
    genres: (d.genres ?? []).map(x => x.id),
    directors: (d.directors ?? []).map(x => x.id),
    cast: (d.cast ?? []).map(x => x.id),
    countries: d.countries ?? [],
    decade: d.year ? [Math.floor(d.year / 10) * 10] : [],
    keywords: (d.keywords ?? []).map(x => x.id),
  };
}

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/**
 * Profilo di gusto. Per ogni titolo votato: segnale = (mio - media TMDB) + lambda * (mio - mia media).
 * Peso di una caratteristica = somma(segnale) / (n + k).
 * `exclude` (key) serve alla validazione leave-one-out.
 */
export function buildProfile(rated, cfg, exclude = null) {
  const { k, lambda } = cfg.profile;
  const items = rated.filter(r => r.key !== exclude && r.my != null);
  const meanMy = mean(items.map(r => r.my));
  const table = Object.fromEntries(TYPES.map(t => [t, new Map()]));
  for (const r of items) {
    const avg = r.d.vote_average > 0 ? r.d.vote_average : cfg.quality.global_mean;
    const s = (r.my - avg) + lambda * (r.my - meanMy);
    const f = featuresOf(r.d);
    for (const t of TYPES) {
      for (const id of new Set(f[t])) {
        const e = table[t].get(id) ?? { sum: 0, n: 0, sumMy: 0, best: null };
        e.sum += s; e.n += 1; e.sumMy += r.my;
        if (!e.best || r.my > e.best.my) e.best = { t: r.title, my: r.my };
        table[t].set(id, e);
      }
    }
  }
  for (const t of TYPES) for (const e of table[t].values()) { e.w = e.sum / (e.n + k); e.mean = e.sumMy / e.n; }
  const tvRated = items.filter(r => r.media === 'tv').length;
  return { table, meanMy, count: items.length, tvRated };
}

const w = (profile, t, id) => profile.table[t].get(id)?.w ?? 0;

/** Valori grezzi per componente (prima della standardizzazione). */
export function rawComponents(d, profile) {
  const f = featuresOf(d);
  const ws = t => f[t].map(id => w(profile, t, id));
  const known = t => f[t].filter(id => profile.table[t].has(id)).map(id => w(profile, t, id));
  return {
    genres: mean(ws('genres')),
    directors: f.directors.length ? Math.max(...ws('directors')) : 0,
    cast: mean(ws('cast')),
    countries: mean(ws('countries')),
    decade: ws('decade')[0] ?? 0,
    keywords: mean(known('keywords')), // media dei soli keyword presenti nel profilo
  };
}

/** Qualità 0-1: media bayesiana sul numero di voti. */
export function quality(d, cfg) {
  const { m, global_mean: C, floor, ceiling } = cfg.quality;
  const v = d.vote_count ?? 0, R = d.vote_average ?? 0;
  const bayes = (v / (v + m)) * R + (m / (v + m)) * C;
  return Math.min(1, Math.max(0, (bayes - floor) / (ceiling - floor)));
}

/**
 * Crea lo scorer. `pool` (di solito la watchlist) fissa media e deviazione di ogni componente,
 * così le componenti con scale diverse (es. regista vs genere) sono confrontabili prima dei pesi.
 */
export function makeScorer(pool, profile, cfg) {
  const rows = pool.map(it => rawComponents(it.d, profile));
  const stats = {};
  for (const t of TYPES) {
    const xs = rows.map(r => r[t]);
    const mu = mean(xs);
    const sd = Math.sqrt(mean(xs.map(x => (x - mu) ** 2)));
    stats[t] = { mu, sd };
  }
  const useMovieWeights = profile.tvRated >= cfg.score.tv_min_rated_for_movie_weights;
  const weights = media => (media === 'tv' && !useMovieWeights ? cfg.score.tv : cfg.score.movie);
  const sig = x => 1 / (1 + Math.exp(-cfg.affinity.sigmoid_steepness * x));

  return function score(item) {
    const raw = rawComponents(item.d, profile);
    const z = {}, contrib = {};
    let R = 0;
    for (const t of TYPES) {
      z[t] = stats[t].sd > 1e-9 ? (raw[t] - stats[t].mu) / stats[t].sd : 0;
      contrib[t] = cfg.affinity.weights[t] * z[t];
      R += contrib[t];
    }
    const T = sig(R), Q = quality(item.d, cfg), wt = weights(item.media);
    return { T, Q, score: 100 * (wt.taste * T + wt.quality * Q), contrib };
  };
}

/** Soglie di fascia: punteggio minimo di ogni fascia, per percentile sul pool. */
export function bandCutoffs(scores, cfg) {
  const sorted = [...scores].sort((a, b) => b - a), n = sorted.length;
  let cum = 0;
  return cfg.bands.map(b => {
    cum += b.share;
    const lastIdx = Math.min(n - 1, Math.max(0, Math.round(cum * n) - 1));
    return { name: b.name, min: sorted[lastIdx] ?? 0 };
  });
}
export function bandOf(score, cutoffs) {
  for (let i = 0; i < cutoffs.length - 1; i++) if (score >= cutoffs[i].min) return i;
  return cutoffs.length - 1;
}

// ---- Spiegazioni in italiano ----
const stars = v => String((Math.round(v) / 2)).replace('.', ','); // 0-10 → mezze stelle
const stars1 = v => (v / 2).toFixed(1).replace('.', ',').replace(/,0$/, '');
const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['it'], { type: 'region' }) : null;
const countryName = c => { try { return regionNames?.of(c) ?? c; } catch { return c; } };
// Titoli lunghi (es. "Il dottor Stranamore, ovvero: …") accorciati al primo separatore
const short = t => { if (!t || t.length <= 36) return t; const m = t.slice(0, 40).search(/(: | - |, | \()/); return m > 8 ? t.slice(0, m) : t.slice(0, 34) + '…'; };
const decadeName = n => (n >= 2000 ? `anni ${n}` : `anni '${String(n % 100).padStart(2, '0')}`);

const MIN_REASON_W = 0.15; // sotto questo peso una caratteristica non è un buon motivo da citare
function phraseFor(type, item, profile) {
  const { d } = item, f = featuresOf(d);
  const pick = (ids, nameOf) => {
    let best = null;
    for (const id of ids) {
      const e = profile.table[type].get(id);
      if (e && e.w >= MIN_REASON_W && (!best || e.w > best.e.w)) best = { id, e, name: nameOf(id) };
    }
    return best;
  };
  const nameIn = (list, id) => list?.find(x => x.id === id)?.name ?? '';
  let b;
  switch (type) {
    case 'directors': {
      b = pick(f.directors, id => nameIn(d.directors, id)); if (!b) return null;
      const who = item.media === 'tv' ? 'creatore' : 'regista';
      return b.e.n === 1
        ? `stesso ${who} di «${short(b.e.best.t)}», che hai votato ${stars(b.e.best.my)}`
        : `${who} che ami: ${b.name}, ${b.e.n} titoli visti con voto medio ${stars1(b.e.mean)}`;
    }
    case 'cast':
      b = pick(f.cast, id => nameIn(d.cast, id)); if (!b) return null;
      return `con ${b.name}, già apprezzato in «${short(b.e.best.t)}» (${stars(b.e.best.my)})`;
    case 'genres':
      b = pick(f.genres, id => nameIn(d.genres, id)); if (!b) return null;
      return `genere ${b.name.toLowerCase()}: ${b.e.n} titoli votati, media ${stars1(b.e.mean)}`;
    case 'countries':
      b = pick(f.countries, c => countryName(c)); if (!b) return null;
      return `cinema da ${b.name}, che ti piace (media ${stars1(b.e.mean)} su ${b.e.n})`;
    case 'decade':
      b = pick(f.decade, id => decadeName(id)); if (!b) return null;
      return `${b.name}, un periodo che apprezzi (media ${stars1(b.e.mean)})`;
    case 'keywords':
      b = pick(f.keywords, id => nameIn(d.keywords, id)); if (!b) return null;
      return `tema «${b.name}», come in «${short(b.e.best.t)}»`;
  }
  return null;
}

/** Elenco di motivi (max 2 di gusto + 1 di qualità), in ordine di contributo. */
export function explain(item, result, profile, maxReasons = 2) {
  // I temi (keyword TMDB) pesano molto ma come motivo dicono poco: a parità li metto dopo regista, cast, generi, periodo
  const rankKey = t => result.contrib[t] * (t === 'keywords' ? 0.4 : 1);
  const order = TYPES.filter(t => result.contrib[t] > 0).sort((a, b) => rankKey(b) - rankKey(a));
  const reasons = [];
  for (const t of order) {
    const p = phraseFor(t, item, profile);
    if (p) reasons.push(p);
    if (reasons.length >= maxReasons) break;
  }
  const { vote_average: va, vote_count: vc } = item.d;
  if (!reasons.length) {
    // niente di positivo: dillo, citando la caratteristica più sfavorevole se c'è
    const worst = TYPES.filter(t => result.contrib[t] < 0).sort((a, b) => result.contrib[a] - result.contrib[b])[0];
    reasons.push(worst ? `poco vicino ai tuoi gusti (${labelOf(worst)} meno in linea con i tuoi voti)` : 'nessun legame forte con i titoli che hai votato');
  }
  if (result.Q >= 0.6 && vc >= 500) reasons.push(`molto apprezzato dal pubblico (${va.toFixed(1).replace('.', ',')} su ${vc.toLocaleString('it-IT')} voti)`);
  else if (result.Q < 0.3 && vc >= 500) reasons.push(`accoglienza tiepida del pubblico (${va.toFixed(1).replace('.', ',')})`);
  const text = reasons.join('; ');
  return { reasons, text: text.charAt(0).toUpperCase() + text.slice(1) + '.' };
}
const labelOf = t => ({ genres: 'i generi', directors: 'il regista', cast: 'il cast', countries: 'il paese', decade: 'il periodo', keywords: 'i temi' }[t]);

/**
 * Calcolo completo a partire dai dati del sito (items.json) — usato dal browser e dai test.
 * `seen` = titoli segnati come visti in locale: { key: { my } } (my su scala 0-10).
 * I visti escono da watchlist/suggeriti ed entrano nel profilo con il loro voto.
 */
export function computeAll(data, seen = {}) {
  const cfg = data.cfg;
  const everything = [...data.watchlist, ...data.suggestions];
  const localRated = [];
  for (const it of everything) if (seen[it.key]?.my != null) localRated.push({ key: it.key, media: it.media, title: it.title, my: seen[it.key].my, d: it.d });
  const profile = buildProfile([...data.rated, ...localRated], cfg);
  const pool = data.watchlist.filter(it => !seen[it.key]);
  const scorer = makeScorer(pool, profile, cfg);
  const wl = pool.map(it => ({ it, res: scorer(it) }));
  const cutoffs = bandCutoffs(wl.map(x => x.res.score), cfg);
  const wrap = ({ it, res }) => { const ex = explain(it, res, profile); return { it, score: res.score, T: res.T, Q: res.Q, band: bandOf(res.score, cutoffs), why: ex.text }; };
  const sg = data.suggestions.filter(it => !seen[it.key]).map(it => ({ it, res: scorer(it) }));
  const byScore = (a, b) => b.score - a.score;
  return { profile, cutoffs, watchlist: wl.map(wrap).sort(byScore), suggestions: sg.map(wrap).sort(byScore) };
}
