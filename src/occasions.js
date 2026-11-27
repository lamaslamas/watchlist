// Occasioni (famiglia, compagna, umore): regole pure, lette da config/ranking.yml (blocco `occasions`).
// Stesso file per build, test e browser (copiato in docs/occasions.js). Nessun import.
const names = l => (l ?? []).map(x => x.name);
// "NR" (non classificato) vale come classificazione assente
const clean = v => (!v || /^(NR|UR|Unrated)$/i.test(String(v).trim()) ? null : String(v).trim());
const hasAny = (list, wanted) => list.some(n => wanted.includes(n));

/** In famiglia: classificazione per età ammessa (IT, e US se presente con `strict`; US se manca l'IT), niente generi esclusi. */
export function isFamily(it, cfg) {
  const f = cfg.occasions.family, genres = names(it.d.genres);
  if (hasAny(genres, f.exclude_genres ?? []) || hasAny(names(it.d.keywords), f.exclude_keywords ?? [])) return false;
  if (f.require_genres?.length && !hasAny(genres, f.require_genres)) return false;
  const itc = clean(it.certs?.IT), usc = clean(it.certs?.US);
  if (!itc && !usc) return f.unknown === 'genres' && hasAny(genres, f.unknown_genres ?? []);
  const okIT = itc ? f.certifications.IT.includes(itc) : null, okUS = usc ? f.certifications.US.includes(usc) : null;
  if (f.strict) return okIT !== false && okUS !== false;
  return okIT ?? okUS;
}
/** Bonus di ordinamento (punti) per i generi preferiti dalla famiglia. */
export function familyBonus(it, cfg) {
  const f = cfg.occasions.family;
  return hasAny(names(it.d.genres), f.prefer_genres ?? []) ? f.prefer_bonus ?? 0 : 0;
}
/** Con la compagna: nessun genere escluso e, per i film, durata entro il massimo (durata ignota = ammesso). */
export function isPartner(it, cfg) {
  const p = cfg.occasions.partner;
  if (hasAny(names(it.d.genres), p.exclude_genres ?? [])) return false;
  if (it.media === 'movie' && p.max_runtime && it.runtime && it.runtime > p.max_runtime) return false;
  return true;
}
/** Umore: 'light', 'heavy' o null (nessuno prevale di almeno `margin`). */
export function mood(it, cfg) {
  const m = cfg.occasions.mood, genres = names(it.d.genres), kw = names(it.d.keywords);
  const score = side => genres.filter(g => side.genres.includes(g)).length * m.genre_weight + kw.filter(k => side.keywords.includes(k)).length * m.keyword_weight;
  const l = score(m.light), h = score(m.heavy);
  return l - h >= m.margin ? 'light' : h - l >= m.margin ? 'heavy' : null;
}
