import fs from 'node:fs';
import { p, sleep } from './util.js';

// Token da variabile d'ambiente o da .env locale (mai nel codice, .env è in .gitignore)
function token() {
  if (process.env.TMDB_TOKEN) return process.env.TMDB_TOKEN.trim();
  try {
    const m = fs.readFileSync(p('.env'), 'utf8').match(/^TMDB_TOKEN=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  throw new Error('TMDB_TOKEN mancante: impostalo come variabile d\'ambiente o nel file .env');
}

const BASE = 'https://api.themoviedb.org/3';

/** GET con retry su 429/5xx. Ritorna null su 404. */
export async function tmdb(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token()}`, accept: 'application/json' } });
    } catch (e) {
      await sleep(500 * 2 ** attempt); continue;
    }
    if (res.status === 404) return null;
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 2) * 1000); continue; }
    if (res.status >= 500) { await sleep(500 * 2 ** attempt); continue; }
    if (res.status === 401) throw new Error('TMDB: token non valido (401)');
    if (!res.ok) throw new Error(`TMDB ${res.status} su ${path}`);
    return res.json();
  }
  throw new Error(`TMDB: troppi tentativi su ${path}`);
}

/** Esegue `fn` su ogni elemento con concorrenza limitata. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n); }
  }));
  return out;
}
