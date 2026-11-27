// Classificazione per età dalle risposte TMDB (funzione pura, testabile).
/** Classificazione per età: { IT, US } (null se TMDB non la ha). Film: release_dates (preferisce l'uscita al cinema); serie: content_ratings. */
export function certsOf(media, d) {
  const out = { IT: null, US: null };
  for (const cc of Object.keys(out)) {
    if (media === 'movie') {
      const rel = (d?.results ?? []).find(r => r.iso_3166_1 === cc)?.release_dates ?? [];
      const withCert = rel.filter(x => x.certification);
      out[cc] = (withCert.find(x => x.type === 3) ?? withCert[0])?.certification ?? null;
    } else {
      out[cc] = (d?.results ?? []).find(r => r.iso_3166_1 === cc)?.rating || null;
    }
  }
  return out;
}
