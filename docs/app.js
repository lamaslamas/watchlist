// watchlist — interfaccia. Il ranking si ricalcola qui con lo stesso ranking.js della build.
import { computeAll } from './ranking.js';
import { isFamily, familyBonus, isPartner, mood } from './occasions.js';
import * as T from './trakt-web.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const IMG = 'https://image.tmdb.org/t/p/';
const regions = new Intl.DisplayNames(['it'], { type: 'region' });
const countryName = c => { try { return regions.of(c); } catch { return c; } };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let DATA, R, tab = location.hash === '#suggeriti' ? 'sg' : 'wl';
let seen = store.get('wl-seen', {}); // { key: { my (0-10), at (ISO), synced } } — visti segnati in questo browser (synced: già inviato a Trakt)
let added = store.get('wl-added', {}); // { key: ISO } — suggeriti aggiunti alla watchlist Trakt da qui (la build notturna li conferma)
let togetherOv = store.get('wl-together', {}); // { key: true|false } — "da vedere insieme" cambiati da qui, in attesa della build
let togetherBase = new Set(); // lista Trakt "insieme": dalla build, poi dal vivo se hai fatto l'accesso
const F = { occ: new Set(), media: '', prov: '', dur: '', sort: 'rank', bands: new Set(), genre: '', decade: '', yfrom: '', yto: '', country: '', dir: '', actor: '', q: '' };
let view = []; // elenco attualmente mostrato (dopo filtri e ordinamento)

// ---- Tema ----
const root = document.documentElement;
const setTheme = t => { root.dataset.theme = t; $('meta[name=theme-color]').content = t === 'dark' ? '#0d0d0f' : '#f6f4ef'; store.set('wl-theme', t); };
setTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
$('#theme').onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');

// ---- Accesso ai dati di un elemento ----
const names = l => (l ?? []).map(x => x.name);
const provNames = it => [...new Set([...it.providers.flatrate, ...it.providers.free, ...it.providers.ads].map(p => p[0]))];
const fmtRuntime = it => it.media === 'tv'
  ? [it.seasons ? `${it.seasons} stagion${it.seasons === 1 ? 'e' : 'i'}` : '', it.runtime ? `${it.runtime} min a ep.` : ''].filter(Boolean).join(' · ')
  : it.runtime ? `${it.runtime} min` : '';
const stars = v => String(v / 2).replace('.', ',');
const list = () => (tab === 'wl' ? R.watchlist : R.suggestions);

// I suggeriti aggiunti alla watchlist contano come watchlist (come farà la build notturna)
function dataNow() {
  const add = DATA.suggestions.filter(i => added[i.key]);
  return add.length ? { ...DATA, watchlist: [...DATA.watchlist, ...add], suggestions: DATA.suggestions.filter(i => !added[i.key]) } : DATA;
}
function recompute() { R = computeAll(dataNow(), seen); }
const isTogether = key => togetherOv[key] ?? togetherBase.has(key);
const SHORT = () => String(DATA.cfg.occasions.short_runtime);
const OCC = {
  family: it => isFamily(it, DATA.cfg), partner: it => isPartner(it, DATA.cfg), together: it => isTogether(it.key),
  light: it => mood(it, DATA.cfg) === 'light', heavy: it => mood(it, DATA.cfg) === 'heavy',
};

function matches(x) {
  const it = x.it, d = it.d;
  if (F.media && it.media !== F.media) return false;
  if (F.prov && !provNames(it).includes(F.prov)) return false;
  if (F.dur && !(it.media === 'movie' && it.runtime && it.runtime < +F.dur)) return false; // la durata vale solo per i film
  for (const o of F.occ) if (!OCC[o](it)) return false;
  if (F.bands.size && !F.bands.has(x.band)) return false;
  if (F.genre && !names(d.genres).includes(F.genre)) return false;
  if (F.decade && Math.floor((d.year || 0) / 10) * 10 !== +F.decade) return false;
  if (F.yfrom && !(d.year >= +F.yfrom)) return false;
  if (F.yto && !(d.year <= +F.yto)) return false;
  if (F.country && !d.countries.map(countryName).includes(F.country)) return false;
  if (F.dir && !names(d.directors).some(n => norm(n).includes(norm(F.dir)))) return false;
  if (F.actor && !names(d.cast).some(n => norm(n).includes(norm(F.actor)))) return false;
  if (F.q) {
    const hay = norm([it.title, it.original_title, ...names(d.directors), ...names(d.cast)].join(' '));
    if (!norm(F.q).split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
// Con "In famiglia" attivo, i generi preferiti dalla famiglia salgono nell'ordinamento per ranking
const adj = x => x.score + (F.occ.has('family') ? familyBonus(x.it, DATA.cfg) : 0);
const sorters = {
  rank: (a, b) => adj(b) - adj(a), year: (a, b) => (b.it.d.year || 0) - (a.it.d.year || 0),
  runtime: (a, b) => (a.it.runtime || 1e9) - (b.it.runtime || 1e9), vote: (a, b) => (b.it.d.vote_average || 0) - (a.it.d.vote_average || 0),
};
const panelFilters = () => F.bands.size + ['genre', 'decade', 'yfrom', 'yto', 'country', 'dir', 'actor'].filter(k => F[k]).length + (F.sort !== 'rank' ? 1 : 0);
const anyFilter = () => panelFilters() + (F.prov ? 1 : 0) + (F.dur ? 1 : 0) + (F.media ? 1 : 0) + (F.q ? 1 : 0) + F.occ.size;

// ---- Griglia ----
function card(x, i) {
  const it = x.it;
  const meta = [it.d.year, it.media === 'tv' ? 'Serie' : fmtRuntime(it)].filter(Boolean).join(' · ');
  const band = DATA.bands[x.band];
  const img = it.poster
    ? `<img ${i < 8 ? '' : 'loading="lazy"'} decoding="async" alt="" src="${IMG}w342${it.poster}" srcset="${IMG}w185${it.poster} 185w, ${IMG}w342${it.poster} 342w, ${IMG}w500${it.poster} 500w" sizes="(min-width: 900px) 180px, 45vw">`
    : `<div class="noimg">${esc(it.title)}</div>`;
  return `<button class="card" data-key="${esc(it.key)}" aria-label="${esc(it.title)}, ${esc(String(it.d.year))}, punteggio ${Math.round(x.score)}, ${esc(band.name)}">
    <div class="poster">${img}<div class="chip"><b>${Math.round(x.score)}</b><span>${esc(band.short)}</span></div></div>
    <h3>${esc(it.title)}</h3><div class="meta">${esc(meta)}</div></button>`;
}
function render() {
  view = list().filter(matches).sort(sorters[F.sort]);
  $('#grid').innerHTML = view.length ? view.map(card).join('')
    : `<div class="empty"><b>Nessun titolo con questi filtri</b>${F.occ.has('together') ? 'Per riempire «Scelti insieme» apri un titolo e premi «Da vedere insieme» (serve l\'accesso a Trakt).' : 'Prova ad allargare la ricerca o ad azzerare i filtri.'}</div>`;
  for (const img of document.querySelectorAll('.poster img')) { if (img.complete) img.classList.add('ok'); else img.onload = () => img.classList.add('ok'); }
  const hidden = Object.keys(seen).length;
  $('#summary').innerHTML = `${view.length} ${view.length === 1 ? 'titolo' : 'titoli'}${anyFilter() ? ` <button id="clear">Azzera filtri</button>` : ''}`;
  $('#x-undo').hidden = !hidden;
  const pn = panelFilters(); const badge = $('#fbadge'); badge.hidden = pn <= 0; badge.textContent = pn;
  $('#apply').textContent = `Mostra ${view.length} ${view.length === 1 ? 'titolo' : 'titoli'}`;
  $('#n-wl').textContent = R.watchlist.length; $('#n-sg').textContent = R.suggestions.length;
}
document.addEventListener('click', e => { if (e.target.id === 'clear') resetFilters(); });

// ---- Filtri ----
const fillSelect = (el, first, values, keep) => { el.innerHTML = `<option value="">${first}</option>` + values.map(v => `<option value="${esc(v[0])}">${esc(v[1])}</option>`).join(''); el.value = values.some(v => String(v[0]) === String(keep)) ? keep : ''; };
function buildFacets() {
  const L = list();
  const count = fn => { const m = new Map(); L.forEach(x => new Set(fn(x.it)).forEach(v => m.set(v, (m.get(v) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0], 'it')); };
  fillSelect($('#f-prov'), 'Ovunque in Italia', count(provNames).map(([n, c]) => [n, `${n} (${c})`]), F.prov);
  fillSelect($('#f-genre'), 'Tutti i generi', count(i => names(i.d.genres)).map(([n, c]) => [n, `${n} (${c})`]), F.genre);
  fillSelect($('#f-country'), 'Tutti i paesi', count(i => i.d.countries.map(countryName)).map(([n, c]) => [n, `${n} (${c})`]), F.country);
  fillSelect($('#f-decade'), 'Tutti i decenni', count(i => (i.d.year ? [Math.floor(i.d.year / 10) * 10] : [])).sort((a, b) => b[0] - a[0]).map(([d, c]) => [d, `Anni ${d} (${c})`]), F.decade);
  $('#dl-dir').innerHTML = count(i => names(i.d.directors)).map(([n]) => `<option value="${esc(n)}">`).join('');
  $('#dl-actor').innerHTML = count(i => names(i.d.cast)).map(([n]) => `<option value="${esc(n)}">`).join('');
  F.prov = $('#f-prov').value; F.genre = $('#f-genre').value; F.country = $('#f-country').value; F.decade = $('#f-decade').value;
  $('#g-band').innerHTML = DATA.bands.map((b, i) => `<button class="pill" data-band="${i}" aria-pressed="${F.bands.has(i)}">${esc(b.name)}</button>`).join('');
}
function syncControls() {
  $('#q').value = F.q; $('#f-dur').value = F.dur; $('#f-yfrom').value = F.yfrom; $('#f-yto').value = F.yto; $('#f-dir').value = F.dir; $('#f-actor').value = F.actor;
  document.querySelectorAll('#occasions .occ').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.occ === 'short' ? F.dur === SHORT() : F.occ.has(b.dataset.occ))));
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.media === F.media)));
  document.querySelectorAll('#g-sort .pill').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === F.sort)));
  document.querySelectorAll('#g-band .pill').forEach(b => b.setAttribute('aria-pressed', String(F.bands.has(+b.dataset.band))));
}
function resetFilters() { F.occ.clear(); Object.assign(F, { media: '', prov: '', dur: '', sort: 'rank', genre: '', decade: '', yfrom: '', yto: '', country: '', dir: '', actor: '', q: '' }); F.bands.clear(); buildFacets(); syncControls(); render(); }
const bind = (sel, key) => $(sel).addEventListener('input', e => { F[key] = e.target.value.trim(); render(); });
let qTimer; $('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = e.target.value.trim(); render(); }, 120); });
for (const [s, k] of [['#f-prov', 'prov'], ['#f-dur', 'dur'], ['#f-genre', 'genre'], ['#f-decade', 'decade'], ['#f-yfrom', 'yfrom'], ['#f-yto', 'yto'], ['#f-country', 'country'], ['#f-dir', 'dir'], ['#f-actor', 'actor']]) bind(s, k);
$('.seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.media = b.dataset.media; syncControls(); render(); };
$('#g-sort').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.sort = b.dataset.sort; syncControls(); render(); };
$('#g-band').onclick = e => { const b = e.target.closest('button'); if (!b) return; const i = +b.dataset.band; F.bands.has(i) ? F.bands.delete(i) : F.bands.add(i); syncControls(); render(); };
$('#reset').onclick = resetFilters;
$('#occasions').onclick = e => {
  const b = e.target.closest('.occ'); if (!b) return; const o = b.dataset.occ;
  if (o === 'short') F.dur = F.dur === SHORT() ? '' : SHORT();
  else {
    if (F.occ.has(o)) F.occ.delete(o); else { F.occ.add(o); if (o === 'light') F.occ.delete('heavy'); if (o === 'heavy') F.occ.delete('light'); }
  }
  syncControls(); render();
};
function setTab(t) {
  tab = t; $('#tab-wl').setAttribute('aria-selected', String(t === 'wl')); $('#tab-sg').setAttribute('aria-selected', String(t === 'sg'));
  history.replaceState(history.state, '', t === 'sg' ? '#suggeriti' : location.pathname + location.search);
  buildFacets(); syncControls(); render(); scrollTo({ top: 0 });
}
$('#tab-wl').onclick = () => setTab('wl'); $('#tab-sg').onclick = () => setTab('sg');

// ---- Pannelli e scheda ----
let lastFocus = null;
function openSheet(el, focusSel) {
  lastFocus = document.activeElement; el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('open');
  document.body.style.overflow = 'hidden'; setTimeout(() => el.querySelector(focusSel)?.focus(), 30);
}
function closeSheet(el) {
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.sheet.open')) { $('#scrim').classList.remove('open'); document.body.style.overflow = ''; }
  lastFocus?.focus?.();
}
$('#open-filters').onclick = () => openSheet($('#panel'), '#close-filters');
$('#close-filters').onclick = $('#apply').onclick = () => closeSheet($('#panel'));
$('#open-export').onclick = () => { fillExportPanel(); openSheet($('#export'), '#close-export'); };
$('#close-export').onclick = () => closeSheet($('#export'));
const topSheet = () => ['#detail', '#account', '#export', '#panel'].map($).find(el => el.classList.contains('open'));
$('#scrim').onclick = () => { const s = topSheet(); if (s?.id === 'detail') closeDetail(); else if (s) closeSheet(s); };
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; const s = topSheet(); if (s?.id === 'detail') closeDetail(); else if (s) closeSheet(s); });

// ---- Scheda di dettaglio ----
let current = null, rating = 0;
const provFig = p => `<figure><img src="${IMG}w92${p[1]}" alt="" loading="lazy" width="44" height="44"><figcaption>${esc(p[0])}</figcaption></figure>`;
function starsHtml() {
  return Array.from({ length: 5 }, (_, i) => `<span class="star" data-i="${i + 1}"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg>
    <span class="half" hidden><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="full" hidden><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span>
    <button class="l" aria-label="${i + 0.5} stelle" data-v="${i + 0.5}"></button><button class="r" aria-label="${i + 1} stelle" data-v="${i + 1}"></button></span>`).join('');
}
function paintStars() {
  document.querySelectorAll('#stars .star').forEach(s => { const i = +s.dataset.i; s.querySelector('.full').hidden = rating < i; s.querySelector('.half').hidden = !(rating >= i - 0.5 && rating < i); });
  $('#save-seen').disabled = !rating; $('#rating-txt').textContent = rating ? `${String(rating).replace('.', ',')} su 5` : 'Dai un voto';
}
const seenNote = it => (T.isLoggedIn()
  ? (it.media === 'movie' ? 'Il voto va subito a Trakt e il film risulta visto.' : 'Il voto va subito a Trakt (per le serie solo il voto: gli episodi li segni su Trakt).')
  : 'Non hai fatto l\'accesso a Trakt: il voto resta in questo browser (accedi per inviarlo).')
  + ' Il ranking si ricalcola subito e l\'aggiornamento notturno lo conferma.';
function openDetail(key, push = true) {
  const x = [...R.watchlist, ...R.suggestions].find(v => v.it.key === key); if (!x) return;
  const it = x.it, d = it.d; current = x; rating = 0;
  const isSug = R.suggestions.includes(x);
  const band = DATA.bands[x.band];
  const facts = [d.year, fmtRuntime(it), d.countries.slice(0, 3).map(countryName).join(', '), names(d.genres).join(', ')].filter(Boolean).join(' · ');
  const stream = [...new Map([...it.providers.flatrate, ...it.providers.free, ...it.providers.ads].map(p => [p[0], p])).values()];
  const other = [...new Set([...it.providers.rent, ...it.providers.buy].map(p => p[0]))].filter(n => !stream.some(s => s[0] === n));
  const links = [
    it.imdb_id && ['IMDb', `https://www.imdb.com/title/${it.imdb_id}/`],
    it.media === 'movie' && ['Letterboxd', `https://letterboxd.com/tmdb/${it.tmdb_id}/`],
    ['Trakt', `https://trakt.tv/search/tmdb/${it.tmdb_id}?id_type=${it.media === 'tv' ? 'show' : 'movie'}`],
    ['TMDB', `https://www.themoviedb.org/${it.media}/${it.tmdb_id}`],
  ].filter(Boolean);
  $('#detail-in').innerHTML = `
    <div class="big">${it.poster ? `<img src="${IMG}w500${it.poster}" srcset="${IMG}w342${it.poster} 342w, ${IMG}w500${it.poster} 500w, ${IMG}w780${it.poster} 780w" sizes="(min-width: 900px) 300px, 62vw" alt="Locandina di ${esc(it.title)}">` : ''}</div>
    <div>
      <h2 id="d-title">${esc(it.title)}</h2>
      ${it.original_title ? `<div class="orig">${esc(it.original_title)}</div>` : ''}
      <div class="facts">${esc(facts)}</div>
      <div class="scorebox"><b>${Math.round(x.score)}</b><span>${esc(band.name)}</span></div>
      <p class="why">${esc(x.why)}${it.via ? `<small>${esc(it.via.charAt(0).toUpperCase() + it.via.slice(1))}.</small>` : ''}</p>
      ${it.overview ? `<div class="sec"><h4>Trama</h4><p>${esc(it.overview)}</p></div>` : ''}
      <div class="sec"><h4>${it.media === 'tv' ? 'Creato da' : 'Regia'} e cast</h4><p>${esc([names(d.directors).join(', '), names(d.cast).join(', ')].filter(Boolean).join(' — '))}</p></div>
      <div class="sec"><h4>Dove vederlo in Italia</h4>
        ${stream.length ? `<div class="provs">${stream.map(provFig).join('')}</div>` : `<p class="muted">Nessuna piattaforma in abbonamento al momento.</p>`}
        ${other.length ? `<p class="muted" style="margin-top:10px;font-size:13px">Anche a noleggio o acquisto: ${esc(other.slice(0, 5).join(', '))}</p>` : ''}</div>
      <div class="sec"><h4>Link</h4><div class="links">${links.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('')}</div></div>
      <div class="act-row">
        ${isSug ? `<button class="btn" id="act-wl">Aggiungi alla watchlist</button>` : ''}
        <button class="btn" id="act-together" aria-pressed="${isTogether(it.key)}">${isTogether(it.key) ? 'Da vedere insieme ✓' : 'Da vedere insieme'}</button>
      </div>
      <div class="seen-box"><h4 class="lbl-h">Già visto?</h4>
        <div class="stars" id="stars" role="group" aria-label="Voto in mezze stelle">${starsHtml()}</div>
        <div class="seen-actions"><span class="muted" id="rating-txt"></span><button class="btn primary" id="save-seen" disabled>Segna come visto</button></div>
        <p class="note" id="seen-note">${esc(seenNote(it))}</p></div>
    </div>`;
  paintStars(); $('#detail').scrollTop = 0; openSheet($('#detail'), '#close-detail');
  if (push) history.pushState({ d: key }, '');
}
function closeDetail() { if (history.state?.d) history.back(); else hideDetail(); }
function hideDetail() { closeSheet($('#detail')); current = null; }
addEventListener('popstate', () => { if ($('#detail').classList.contains('open')) hideDetail(); });
$('#close-detail').onclick = closeDetail;
$('#grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.key); });
$('#detail').addEventListener('click', e => {
  const b = e.target.closest('.star button');
  if (b) { const v = +b.dataset.v; rating = rating === v ? 0 : v; paintStars(); }
  if (e.target.id === 'save-seen' && current && rating) saveSeen();
  if (e.target.id === 'act-wl' && current) addWatchlist(e.target);
  if (e.target.id === 'act-together' && current) toggleTogether(e.target);
});
const errMsg = e => (e instanceof T.TraktError ? e.message : 'errore imprevisto nell\'invio a Trakt.');
function needLogin(what) { toast(`Accedi a Trakt per ${what}`); fillAccount(); openSheet($('#account'), '#close-account'); }

/** Voto + visto: sempre in locale (ranking subito), e su Trakt se hai fatto l'accesso. */
async function saveSeen() {
  const it = current.it, title = it.title, s = { my: rating * 2, at: new Date().toISOString(), synced: false };
  seen[it.key] = s; store.set('wl-seen', seen);
  closeDetail(); recompute(); buildFacets(); render(); updateAccount();
  if (!T.isLoggedIn()) { toast(`«${title}» segnato come visto (${stars(s.my)}★) solo in questo browser: accedi a Trakt per inviarlo`, 5200); return; }
  toast(`«${title}»: ranking ricalcolato, invio a Trakt…`, 9000);
  try { await syncSeen(it, s); toast(`«${title}» (${stars(s.my)}★) inviato a Trakt`); }
  catch (e) { toast(`Voto salvato in questo browser ma non inviato a Trakt: ${errMsg(e)}`, 7000); }
  updateAccount();
}
async function syncSeen(it, s) {
  await T.rate(it, s.my, s.at);
  if (it.media === 'movie') await T.markWatched(it, s.at); else await T.removeFromWatchlist(it); // il film esce dalla watchlist da solo
  s.synced = true; store.set('wl-seen', seen);
}
async function addWatchlist(btn) {
  if (!T.isLoggedIn()) return needLogin('aggiungere alla watchlist');
  const it = current.it; btn.disabled = true; btn.textContent = 'Invio a Trakt…';
  try {
    const r = await T.addToWatchlist(it);
    added[it.key] = new Date().toISOString(); store.set('wl-added', added);
    recompute(); buildFacets(); render(); btn.textContent = 'In watchlist ✓';
    toast(r.existed ? `«${it.title}» era già nella watchlist Trakt` : `«${it.title}» aggiunto alla watchlist Trakt`);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Aggiungi alla watchlist';
    toast(e.code === 'limit' ? 'La watchlist Trakt è piena (500 titoli per gli account gratuiti): toglierne qualcuno da Trakt.' : `Non aggiunto: ${errMsg(e)}`, 6500);
  }
}
async function toggleTogether(btn) {
  if (!T.isLoggedIn()) return needLogin('salvare la lista «insieme»');
  const it = current.it, on = !isTogether(it.key); btn.disabled = true;
  try {
    await T.setTogether(DATA.cfg.occasions.partner.together_list, it, on);
    togetherOv[it.key] = on; store.set('wl-together', togetherOv);
    btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Da vedere insieme ✓' : 'Da vedere insieme'; render();
    toast(on ? `«${it.title}» aggiunto alla lista «insieme» su Trakt` : `«${it.title}» tolto dalla lista «insieme»`);
  } catch (e) { toast(`Lista «insieme» non aggiornata: ${errMsg(e)}`, 6500); }
  btn.disabled = false;
}
const syncTogether = () => T.isLoggedIn() && T.getTogether(DATA.cfg.occasions.partner.together_list)
  .then(keys => { togetherBase = new Set(keys); togetherOv = {}; store.set('wl-together', togetherOv); render(); }).catch(() => {});

// ---- Account Trakt ----
const pendingSeen = () => Object.values(seen).filter(s => !s.synced).length;
function updateAccount() {
  const on = T.isLoggedIn(); $('#trakt-btn').classList.toggle('on', on);
  $('#trakt-btn').title = on ? `Connesso a Trakt${T.username() ? ` come ${T.username()}` : ''}` : 'Accedi a Trakt';
}
function fillAccount() {
  const on = T.isLoggedIn(), n = pendingSeen();
  $('#account-in').innerHTML = on ? `
    <p>Connesso a Trakt${T.username() ? ` come <b>${esc(T.username())}</b>` : ''}. Da qui puoi votare, segnare i film come visti, aggiungere alla watchlist e salvare la lista «${esc(DATA.cfg.occasions.partner.together_list)}».</p>
    ${n ? `<p class="warn">${n} ${n === 1 ? 'voto salvato' : 'voti salvati'} in questo browser ${n === 1 ? 'non è ancora' : 'non sono ancora'} su Trakt.</p><button class="btn primary" id="do-push">Invia a Trakt</button>` : ''}
    <button class="btn" id="do-logout">Esci da Trakt</button>
    <p class="note">«Esci» toglie l'accesso solo da questo browser. Per revocarlo del tutto: trakt.tv → Impostazioni → Connected Apps.</p>` : `
    <p>Accedi con il tuo account Trakt per inviare direttamente da qui voti, film visti, watchlist e la lista «${esc(DATA.cfg.occasions.partner.together_list)}». L'accesso resta solo in questo browser.</p>
    <button class="btn primary" id="do-login" ${T.canLogin() ? '' : 'disabled'}>Accedi con Trakt</button>
    <p class="note">Senza accesso i voti restano in questo browser e ricalcolano comunque il ranking.</p>
    <p class="note">Se Trakt segnala un indirizzo di ritorno non valido, aggiungi <code>${esc(T.redirectUri())}</code> tra i Redirect URIs dell'app su trakt.tv/oauth/applications.</p>`;
}
$('#trakt-btn').onclick = () => { fillAccount(); openSheet($('#account'), '#close-account'); };
$('#close-account').onclick = () => closeSheet($('#account'));
$('#account').addEventListener('click', async e => {
  if (e.target.id === 'do-login') T.login().catch(err => toast(errMsg(err), 6000));
  if (e.target.id === 'do-logout') { T.logout(); togetherBase = new Set(DATA.together ?? []); togetherOv = {}; store.set('wl-together', togetherOv); updateAccount(); fillAccount(); render(); toast('Disconnesso da Trakt (solo in questo browser)'); }
  if (e.target.id === 'do-push') {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Invio…';
    const all = [...DATA.watchlist, ...DATA.suggestions]; let ok = 0, last = '';
    for (const [key, s] of Object.entries(seen).filter(([, s]) => !s.synced)) {
      const it = all.find(i => i.key === key); if (!it) continue;
      try { await syncSeen(it, s); ok++; } catch (err) { last = errMsg(err); if (err.status === 401 || err.status === 420) break; }
    }
    updateAccount(); fillAccount();
    toast(last ? `Inviati ${ok} voti. Poi: ${last}` : `${ok} ${ok === 1 ? 'voto inviato' : 'voti inviati'} a Trakt`, 6000);
  }
});
let tt; function toast(msg, ms = 3600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms); }

// ---- Export CSV per Letterboxd (solo film) ----
// Formato di importazione: https://letterboxd.com/about/importing-data/ — colonne tmdbID, imdbID, Title, Year, Rating (0.5–5), WatchedDate, Rewatch
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const asTime = s => (!s ? 0 : new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime());
const ymd = s => (s ? s.slice(0, 10) : '');
/** Voti dei film: storico (da Trakt/CSV) + quelli dati qui; i locali sostituiscono gli storici dello stesso film. */
function ratedMovies() {
  const m = new Map(DATA.history.map(h => [h.tmdb_id, { tmdb_id: h.tmdb_id, imdb_id: h.imdb_id, title: h.title, year: h.year, rating: h.rating, at: h.at }]));
  for (const x of [...DATA.watchlist, ...DATA.suggestions]) {
    const s = seen[x.key]; if (!s || x.media !== 'movie') continue;
    m.set(x.tmdb_id, { tmdb_id: x.tmdb_id, imdb_id: x.imdb_id, title: x.title, year: x.d.year, rating: s.my, at: s.at });
  }
  return [...m.values()];
}
const ratingRow = r => ({ tmdbID: r.tmdb_id, imdbID: r.imdb_id ?? '', Title: r.title, Year: r.year ?? '', Rating: r.rating != null ? String(r.rating / 2) : '', WatchedDate: ymd(r.at), Rewatch: '' });
const RCOLS = ['tmdbID', 'imdbID', 'Title', 'Year', 'Rating', 'WatchedDate', 'Rewatch'];
const lastExport = () => store.get('wl-last-export', null) ?? DATA.last_letterboxd_export ?? '1970-01-01T00:00:00Z';
// Se la data nel campo è quella dell'ultimo export (non toccata) vale l'istante esatto, altrimenti l'inizio del giorno scelto
const sinceTime = () => { const v = $('#f-since').value, le = lastExport(); return !v || v === le.slice(0, 10) ? asTime(le) : asTime(`${v}T00:00:00Z`); };
const newSince = () => ratedMovies().filter(r => r.at && asTime(r.at) > sinceTime());
function fillExportPanel() {
  const le = lastExport(); $('#f-since').value = le.slice(0, 10);
  updateSinceInfo();
}
function updateSinceInfo() {
  const n = newSince().length;
  $('#since-info').textContent = `${n} film da esportare. Ultimo export registrato: ${new Date(lastExport()).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}.`;
  $('#x-new').disabled = !n;
}
$('#f-since').addEventListener('input', updateSinceInfo);
$('#x-new').onclick = () => {
  const rows = newSince(); if (!rows.length) return;
  download(`letterboxd-nuovi-visti-${ymd(new Date().toISOString())}.csv`, toCsv(RCOLS, rows.map(ratingRow)));
  store.set('wl-last-export', new Date().toISOString()); updateSinceInfo(); fillExportPanel();
  toast(`${rows.length} film esportati: da importare su letterboxd.com/import`);
};
$('#x-ratings').onclick = () => { const rows = ratedMovies(); download('letterboxd-voti.csv', toCsv(RCOLS, rows.map(ratingRow))); toast(`${rows.length} voti esportati`); };
$('#x-list').onclick = () => {
  const rows = view.filter(x => x.it.media === 'movie').map((x, i) => ({ Position: i + 1, Name: x.it.title, Year: x.it.d.year ?? '', tmdbID: x.it.tmdb_id, imdbID: x.it.imdb_id ?? '', Description: `${Math.round(x.score)} · ${DATA.bands[x.band].name}` }));
  download(`letterboxd-lista-${tab === 'sg' ? 'suggeriti' : 'watchlist'}.csv`, toCsv(['Position', 'Name', 'Year', 'tmdbID', 'imdbID', 'Description'], rows));
  toast(`${rows.length} film esportati nell'ordine che vedi`);
};
$('#x-undo').onclick = () => { seen = {}; store.set('wl-seen', seen); recompute(); buildFacets(); render(); closeSheet($('#export')); toast('Visti locali ripristinati'); };

// ---- Avvio ----
fetch('data/items.json').then(r => r.json()).then(d => {
  DATA = d; T.configure(d.trakt_client_id);
  togetherBase = new Set(d.together ?? []);
  const keys = new Set([...d.watchlist, ...d.suggestions].map(i => i.key));
  seen = Object.fromEntries(Object.entries(seen).filter(([k]) => keys.has(k))); // niente residui di titoli spariti dai dati
  added = Object.fromEntries(Object.entries(added).filter(([k]) => d.suggestions.some(i => i.key === k))); // se la build li ha messi in watchlist, sono confermati
  togetherOv = Object.fromEntries(Object.entries(togetherOv).filter(([k, v]) => v !== togetherBase.has(k)));
  store.set('wl-seen', seen); store.set('wl-added', added); store.set('wl-together', togetherOv);
  $('#occ-short').textContent = `Sotto i ${d.cfg.occasions.short_runtime} min`;
  recompute(); buildFacets(); syncControls(); updateAccount();
  T.finishLogin().then(user => { if (user !== null) { updateAccount(); toast(`Connesso a Trakt${user ? ` come ${user}` : ''}`); syncTogether(); } }).catch(e => { updateAccount(); toast(errMsg(e), 7000); });
  syncTogether();
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String((t.id === 'tab-sg') === (tab === 'sg'))));
  render();
  $('#updated').textContent = `Aggiornato il ${new Date(d.generated_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
}).catch(() => { $('#grid').innerHTML = '<div class="empty"><b>Dati non caricati</b>Riprova tra poco.</div>'; });

// ---- Addon Stremio/Nuvio: link di installazione e URL del manifest ----
const manifestUrl = new URL('manifest.json', location.href).href;
$('#addon-link').href = `stremio://${manifestUrl.replace(/^https?:\/\//, '')}`;
$('#addon-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(manifestUrl); toast('URL copiato: incollalo in Stremio o Nuvio (Addon → Installa da URL)'); }
  catch { prompt('Copia questo URL e incollalo in Stremio o Nuvio:', manifestUrl); }
};
