// Client Trakt: header richiesti, limiti di richieste, token con rinnovo.
// Nessun segreto nel codice: client ID da TRAKT_CLIENT_ID (ambiente o .env locale),
// token in .trakt-token.json (ignorato da git) o, nella Action, dal secret TRAKT_REFRESH_TOKEN.
import fs from 'node:fs';
import { p, sleep } from './util.js';

export const API = 'https://api.trakt.tv';
export const REDIRECT_URI = 'http://localhost:8080/callback';
export const TOKEN_FILE = process.env.TRAKT_TOKEN_FILE || p('.trakt-token.json');

function envValue(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const m = fs.readFileSync(p('.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return null;
}
export function clientId() {
  const id = envValue('TRAKT_CLIENT_ID');
  if (!id) throw new Error('TRAKT_CLIENT_ID mancante: impostalo come variabile d\'ambiente o nel file .env');
  return id;
}

// ---- Token ----
export function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch {}
  const rt = envValue('TRAKT_REFRESH_TOKEN'); // Action: parte dal refresh token nei Secrets
  return rt ? { refresh_token: rt, expires_at: 0 } : null;
}
export function saveToken(t) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
}
const toStored = r => ({ access_token: r.access_token, refresh_token: r.refresh_token, expires_at: (r.created_at ?? Math.floor(Date.now() / 1000)) + r.expires_in });

async function tokenRequest(body) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'watchlist-personal/1.0' },
    body: JSON.stringify({ client_id: clientId(), redirect_uri: REDIRECT_URI, ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Trakt /oauth/token → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
/** Scambia il code PKCE con i token (login). */
export async function exchangeCode(code, verifier) {
  const t = toStored(await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier }));
  saveToken(t); return t;
}
/** Rinnova: il refresh token può essere ruotato, quindi si salva SEMPRE quello nuovo subito. */
export async function refreshToken(tok = loadToken()) {
  if (!tok?.refresh_token) throw new Error('Nessun token Trakt: esegui prima `npm run trakt:login`');
  const t = toStored(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }));
  saveToken(t); return t;
}
async function accessToken(force = false) {
  let tok = loadToken();
  if (!tok) throw new Error('Nessun token Trakt: esegui prima `npm run trakt:login`');
  if (force || !tok.access_token || tok.expires_at - Date.now() / 1000 < 3600) tok = await refreshToken(tok);
  return tok.access_token;
}

// ---- Richieste ----
// Limiti Trakt: GET 1000 ogni 5 minuti, scritture 1 al secondo. Resto sotto con margine.
const MIN_GAP = { GET: 400, WRITE: 1200 };
let lastAt = 0;
async function throttle(method) {
  const gap = method === 'GET' ? MIN_GAP.GET : MIN_GAP.WRITE, wait = lastAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

/** Ritorna { data, headers }. */
export async function trakt(method, path, { query, body } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, v);
  let refreshed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle(method);
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId(),
        Authorization: `Bearer ${await accessToken()}`, 'User-Agent': 'watchlist-personal/1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res) { await sleep(1000 * 2 ** attempt); continue; }
    if (res.status === 401 && !refreshed) { refreshed = true; await accessToken(true); continue; }
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 5) * 1000); continue; }
    if (res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`Trakt ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return { data: text ? JSON.parse(text) : null, headers: res.headers };
  }
  throw new Error(`Trakt ${method} ${path}: troppi tentativi`);
}

/** GET con paginazione (header X-Pagination-Page-Count). */
export async function getAll(path, query = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const { data, headers } = await trakt('GET', path, { query: { ...query, page, limit: 1000 } });
    out.push(...(data ?? []));
    if (page >= Number(headers.get('x-pagination-page-count') || 1)) break;
  }
  return out;
}

// ---- Lettura dello stato completo (normalizzato) ----
const ids = (o, media, extra = {}) => ({ media, tmdb: o?.ids?.tmdb ?? null, imdb: o?.ids?.imdb ?? null, title: o?.title, year: o?.year ?? null, ...extra });

export async function readState() {
  // in sequenza: il limitatore di richieste è unico e le chiamate sono poche
  const rm = await getAll('/sync/ratings/movies'), rs = await getAll('/sync/ratings/shows');
  const wm = await getAll('/sync/watchlist/movies'), ws = await getAll('/sync/watchlist/shows');
  const vm = await getAll('/sync/watched/movies'), vs = await getAll('/sync/watched/shows');
  return {
    fetched_at: new Date().toISOString(),
    ratings: [...rm.map(x => ids(x.movie, 'movie', { rating: x.rating, at: x.rated_at })), ...rs.map(x => ids(x.show, 'tv', { rating: x.rating, at: x.rated_at }))],
    watchlist: [...wm.map(x => ids(x.movie, 'movie', { at: x.listed_at })), ...ws.map(x => ids(x.show, 'tv', { at: x.listed_at }))],
    watched: [
      ...vm.map(x => ids(x.movie, 'movie', { plays: x.plays, at: x.last_watched_at })),
      ...vs.map(x => ids(x.show, 'tv', {
        plays: x.plays, at: x.last_watched_at,
        // episodi distinti visti, speciali (stagione 0) esclusi
        episodes_watched: (x.seasons ?? []).filter(s => s.number > 0).reduce((n, s) => n + (s.episodes ?? []).length, 0),
      })),
    ],
  };
}
