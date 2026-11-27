// Client Trakt nel browser: login OAuth con PKCE (nessun client secret) e azioni dirette (voti, visti, watchlist, lista "insieme").
// I token stanno SOLO nel localStorage di questo browser: non finiscono mai nel repo né nei file pubblicati.
// Il client ID non è un segreto (compare anche nell'URL di autorizzazione): arriva da items.json.
const API = 'https://api.trakt.tv';
const KEY = 'wl-trakt', PKCE = 'wl-trakt-pkce';
let CID = null;

export class TraktError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const ss = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

export const configure = id => { CID = id || null; };
export const canLogin = () => !!CID;
export const isLoggedIn = () => !!ls.get(KEY)?.refresh_token;
export const username = () => ls.get(KEY)?.user ?? null;
/** Dove Trakt rimanda dopo il login: va registrato tra i "Redirect URIs" dell'app Trakt. */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

// ---- Login ----
export async function login() {
  if (!CID) throw new TraktError('Accesso a Trakt non configurato (manca il client ID).');
  const verifier = rand(48), state = rand(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  ss.set(PKCE, { verifier, state, redirect: redirectUri() });
  const u = new URL('https://trakt.tv/oauth/authorize');
  Object.entries({ response_type: 'code', client_id: CID, redirect_uri: redirectUri(), state, code_challenge: challenge, code_challenge_method: 'S256' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  location.assign(u);
}

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CID, ...body }) });
  } catch { throw new TraktError('Trakt non raggiungibile (rete o origine non consentita).'); }
  if (!res.ok) throw new TraktError(`Trakt ha rifiutato l'accesso (${res.status}).`, res.status, 'auth');
  return res.json();
}
const stored = r => ({ access_token: r.access_token, refresh_token: r.refresh_token, expires_at: (r.created_at ?? Math.floor(Date.now() / 1000)) + r.expires_in });

/** Da chiamare all'avvio: se la pagina è il ritorno da Trakt (?code=…) completa il login. Ritorna null se non lo è. */
export async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const pk = ss.get(PKCE); ss.del(PKCE);
  history.replaceState(history.state, '', location.pathname + location.hash); // via code e state dall'indirizzo
  if (q.get('error')) throw new TraktError(`Trakt: ${q.get('error_description') || q.get('error')}`);
  if (!pk || pk.state !== q.get('state')) throw new TraktError('Accesso annullato: richiesta non valida. Riprova.');
  const tok = stored(await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: pk.verifier, redirect_uri: pk.redirect }));
  ls.set(KEY, tok);
  try { ls.set(KEY, { ...tok, user: (await api('GET', '/users/settings')).user.username }); } catch {}
  return username();
}
export function logout() { ls.del(KEY); listId = null; }

// ---- Token (il refresh token ruota: si salva subito quello nuovo; un solo rinnovo alla volta, anche tra schede) ----
let refreshing = null;
async function doRefresh(force) {
  const t = ls.get(KEY); if (!t?.refresh_token) throw new TraktError('Non hai fatto l\'accesso a Trakt.', 401, 'expired');
  if (!force && t.expires_at - Date.now() / 1000 > 3600) return; // un'altra scheda l'ha appena rinnovato
  try {
    const n = stored(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, redirect_uri: redirectUri() }));
    ls.set(KEY, { ...t, ...n });
  } catch (e) {
    if (e.code === 'auth') { logout(); throw new TraktError('Sessione Trakt scaduta: accedi di nuovo.', 401, 'expired'); }
    throw e;
  }
}
function refresh(force = false) {
  refreshing ??= (navigator.locks ? navigator.locks.request('wl-trakt-refresh', () => doRefresh(force)) : doRefresh(force)).finally(() => { refreshing = null; });
  return refreshing;
}
async function accessToken(force = false) {
  let t = ls.get(KEY); if (!t) throw new TraktError('Non hai fatto l\'accesso a Trakt.', 401, 'expired');
  if (force || !t.access_token || t.expires_at - Date.now() / 1000 < 3600) {
    await refresh(force);
    t = ls.get(KEY); if (!t) throw new TraktError('Sessione Trakt scaduta: accedi di nuovo.', 401, 'expired');
  }
  return t.access_token;
}

// ---- Richieste (le scritture stanno sotto 1 al secondo, il limite di Trakt) ----
let lastWrite = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MSG = { 401: 'Sessione Trakt scaduta: accedi di nuovo.', 403: 'Trakt ha negato l\'operazione.', 404: 'Non trovato su Trakt.', 420: 'Limite del tuo account Trakt raggiunto (account gratuito).', 423: 'Account Trakt bloccato.', 429: 'Troppe richieste a Trakt: riprova tra un minuto.' };
async function api(method, path, body, tries = 0) {
  const write = method !== 'GET';
  if (write) { const wait = lastWrite + 1100 - Date.now(); if (wait > 0) await sleep(wait); lastWrite = Date.now(); }
  const token = await accessToken();
  let res;
  try {
    res = await fetch(API + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': CID, Authorization: `Bearer ${token}` },
    });
  } catch { throw new TraktError('Trakt non raggiungibile (rete o origine non consentita).'); }
  if (res.status === 401 && tries === 0) { if (ls.get(KEY)?.access_token === token) await accessToken(true); return api(method, path, body, 1); } // se un'altra scheda ha già rinnovato basta riprovare
  if (res.status === 429 && tries < 2) { await sleep((Number(res.headers.get('retry-after')) || 3) * 1000); return api(method, path, body, tries + 1); }
  if (!res.ok) throw new TraktError(MSG[res.status] ?? `Trakt ha risposto con errore ${res.status}.`, res.status, res.status === 420 ? 'limit' : '');
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- Azioni sui titoli ----
const one = (it, extra = {}) => { const o = { ids: { tmdb: it.tmdb_id }, ...extra }; return it.media === 'movie' ? { movies: [o] } : { shows: [o] }; };
const notFound = r => (r?.not_found?.movies?.length || 0) + (r?.not_found?.shows?.length || 0) > 0;
const check = r => { if (notFound(r)) throw new TraktError('Titolo non trovato su Trakt.', 404); return r; };

/** Voto 1-10 (le mezze stelle sono interi: 0,5★ = 1). */
export const rate = (it, rating10, at) => api('POST', '/sync/ratings', one(it, { rating: Math.round(rating10), rated_at: at })).then(check);
/** Segna un film come visto (Trakt lo toglie da solo dalla watchlist). Le serie non si segnano qui: andrebbero tutti gli episodi. */
export const markWatched = (it, at) => (it.media === 'movie' ? api('POST', '/sync/history', one(it, { watched_at: at })).then(check) : Promise.resolve(null));
export const removeFromWatchlist = it => api('POST', '/sync/watchlist/remove', one(it));
export async function addToWatchlist(it) {
  const r = check(await api('POST', '/sync/watchlist', one(it)));
  return { existed: ((r.existing?.movies ?? 0) + (r.existing?.shows ?? 0)) > 0 };
}

// ---- Lista personale "insieme" ----
let listId = null;
async function findList(name, create) {
  if (listId) return listId;
  const lists = await api('GET', '/users/me/lists');
  let l = (lists ?? []).find(x => String(x.name).trim().toLowerCase() === name.trim().toLowerCase());
  if (!l && create) l = await api('POST', '/users/me/lists', { name, privacy: 'private', display_numbers: false, allow_comments: false });
  return (listId = l?.ids?.trakt ?? null);
}
/** Chiavi ("movie:123") dei titoli nella lista. */
export async function getTogether(name) {
  const id = await findList(name, false); if (!id) return [];
  const items = await api('GET', `/users/me/lists/${id}/items?limit=1000`);
  return (items ?? []).filter(x => x.type === 'movie' || x.type === 'show').map(x => `${x.type === 'movie' ? 'movie' : 'tv'}:${(x.movie ?? x.show)?.ids?.tmdb}`);
}
export async function setTogether(name, it, on) {
  const id = await findList(name, on);
  if (!id) return; // niente lista = niente da togliere
  check(await api('POST', `/users/me/lists/${id}/items${on ? '' : '/remove'}`, one(it)));
}
