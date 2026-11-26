// Pagina di prova: stessa interfaccia del sito finale, con 20 titoli veri. Nessun framework.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const IMG = 'https://image.tmdb.org/t/p/';
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let DATA, tab = 'wl';
  const F = { media: '', prov: '', dur: '', sort: 'rank', bands: new Set(), genre: '', decade: '', country: '', dir: '', actor: '', q: '' };
  let seen = store.get('wl-prev-seen', {});

  // ---- Tema (scuro di default) ----
  const root = document.documentElement;
  const setTheme = t => { root.dataset.theme = t; $('meta[name=theme-color]').content = t === 'dark' ? '#0d0d0f' : '#f6f4ef'; store.set('wl-theme', t); };
  setTheme(store.get('wl-theme', 'dark'));
  $('#theme').onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');

  // ---- Utilità sui dati ----
  const items = () => (tab === 'wl' ? DATA.watchlist : DATA.suggestions);
  const all = () => [...DATA.watchlist, ...DATA.suggestions];
  const provNames = it => [...new Set([...it.providers.flatrate, ...it.providers.free, ...it.providers.ads].map(p => p.name))];
  const decadeOf = it => (it.year ? Math.floor(it.year / 10) * 10 : 0);
  const fmtRuntime = it => it.media === 'tv'
    ? [it.seasons ? `${it.seasons} stagion${it.seasons === 1 ? 'e' : 'i'}` : '', it.runtime ? `${it.runtime} min a ep.` : ''].filter(Boolean).join(' · ')
    : it.runtime ? `${it.runtime} min` : '';
  const stars = v => String(v / 2).replace('.', ',');

  function matches(it) {
    if (seen[it.key]) return false;
    if (F.media && it.media !== F.media) return false;
    if (F.prov && !provNames(it).includes(F.prov)) return false;
    if (F.dur && !(it.media === 'movie' && it.runtime && it.runtime < +F.dur)) return false; // la durata vale solo per i film
    if (F.bands.size && !F.bands.has(it.band)) return false;
    if (F.genre && !it.genres.includes(F.genre)) return false;
    if (F.decade && decadeOf(it) !== +F.decade) return false;
    if (F.country && !it.countries.includes(F.country)) return false;
    if (F.dir && !it.directors.some(d => norm(d).includes(norm(F.dir)))) return false;
    if (F.actor && !it.cast.some(d => norm(d).includes(norm(F.actor)))) return false;
    if (F.q) {
      const hay = norm([it.title, it.original_title, ...it.directors, ...it.cast].join(' '));
      if (!norm(F.q).split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }
  const sorters = {
    rank: (a, b) => b.score - a.score, year: (a, b) => (b.year || 0) - (a.year || 0),
    runtime: (a, b) => (a.runtime || 1e9) - (b.runtime || 1e9), vote: (a, b) => (b.vote_average || 0) - (a.vote_average || 0),
  };
  const activeFilters = () => (F.prov ? 1 : 0) + (F.dur ? 1 : 0) + (F.media ? 1 : 0) + F.bands.size + ['genre', 'decade', 'country', 'dir', 'actor', 'q'].filter(k => F[k]).length + (F.sort !== 'rank' ? 1 : 0);

  // ---- Griglia ----
  function card(it) {
    const meta = [it.year, it.media === 'tv' ? 'Serie' : fmtRuntime(it)].filter(Boolean).join(' · ');
    const img = it.poster
      ? `<img loading="lazy" decoding="async" alt="" src="${IMG}w342${it.poster}" srcset="${IMG}w185${it.poster} 185w, ${IMG}w342${it.poster} 342w, ${IMG}w500${it.poster} 500w" sizes="(min-width: 900px) 180px, 45vw">`
      : `<div class="noimg">${esc(it.title)}</div>`;
    return `<button class="card" data-key="${esc(it.key)}" aria-label="${esc(it.title)}, ${esc(String(it.year))}, punteggio ${Math.round(it.score)}, ${esc(DATA.bands[it.band])}">
      <div class="poster">${img}<div class="chip"><b>${Math.round(it.score)}</b><span>${esc(DATA.bandsShort[it.band])}</span></div></div>
      <h3>${esc(it.title)}</h3><div class="meta">${esc(meta)}</div></button>`;
  }
  function render() {
    const list = items().filter(matches).sort(sorters[F.sort]);
    const hidden = items().filter(i => seen[i.key]).length;
    $('#grid').innerHTML = list.length ? list.map(card).join('')
      : `<div class="empty"><b>Nessun titolo con questi filtri</b>Prova ad allargare la ricerca o ad azzerare i filtri.</div>`;
    for (const img of document.querySelectorAll('.poster img')) { if (img.complete) img.classList.add('ok'); else img.onload = () => img.classList.add('ok'); }
    const n = activeFilters();
    $('#summary').innerHTML = `${list.length} ${list.length === 1 ? 'titolo' : 'titoli'}${n ? ` <button id="clear">Azzera filtri</button>` : ''}${hidden ? ` · ${hidden} nascost${hidden === 1 ? 'o' : 'i'} perché già vist${hidden === 1 ? 'o' : 'i'} <button id="unseen">Ripristina</button>` : ''}`;
    const badge = $('#fbadge'); const pn = n - (F.prov ? 1 : 0) - (F.dur ? 1 : 0) - (F.media ? 1 : 0) - (F.q ? 1 : 0);
    badge.hidden = pn <= 0; badge.textContent = pn;
    $('#apply').textContent = `Mostra ${list.length} ${list.length === 1 ? 'titolo' : 'titoli'}`;
    $('#n-wl').textContent = DATA.watchlist.filter(i => !seen[i.key]).length; $('#n-sg').textContent = DATA.suggestions.filter(i => !seen[i.key]).length;
  }
  document.addEventListener('click', e => {
    if (e.target.id === 'clear') resetFilters();
    if (e.target.id === 'unseen') { items().forEach(i => delete seen[i.key]); store.set('wl-prev-seen', seen); render(); }
  });

  // ---- Controlli ----
  const fillSelect = (el, first, values) => { el.innerHTML = `<option value="">${first}</option>` + values.map(v => `<option value="${esc(v[0])}">${esc(v[1])}</option>`).join(''); };
  function buildFacets() {
    const A = all(), count = (fn) => { const m = new Map(); A.forEach(it => fn(it).forEach(v => m.set(v, (m.get(v) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0], 'it')); };
    fillSelect($('#f-prov'), 'Ovunque in Italia', count(provNames).map(([n, c]) => [n, `${n} (${c})`]));
    fillSelect($('#f-genre'), 'Tutti i generi', count(i => i.genres).map(([n, c]) => [n, `${n} (${c})`]));
    fillSelect($('#f-country'), 'Tutti i paesi', count(i => i.countries).map(([n, c]) => [n, `${n} (${c})`]));
    fillSelect($('#f-decade'), 'Tutti i decenni', count(i => (i.year ? [Math.floor(i.year / 10) * 10] : [])).sort((a, b) => b[0] - a[0]).map(([d]) => [d, `Anni ${d}`]));
    $('#dl-dir').innerHTML = count(i => i.directors).map(([n]) => `<option value="${esc(n)}">`).join('');
    $('#dl-actor').innerHTML = count(i => i.cast).map(([n]) => `<option value="${esc(n)}">`).join('');
    $('#g-band').innerHTML = DATA.bands.map((b, i) => `<button class="pill" data-band="${i}" aria-pressed="false">${esc(b)}</button>`).join('');
  }
  function syncControls() {
    $('#q').value = F.q; $('#f-prov').value = F.prov; $('#f-dur').value = F.dur; $('#f-genre').value = F.genre; $('#f-decade').value = F.decade; $('#f-country').value = F.country; $('#f-dir').value = F.dir; $('#f-actor').value = F.actor;
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.media === F.media)));
    document.querySelectorAll('#g-sort .pill').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === F.sort)));
    document.querySelectorAll('#g-band .pill').forEach(b => b.setAttribute('aria-pressed', String(F.bands.has(+b.dataset.band))));
  }
  function resetFilters() { Object.assign(F, { media: '', prov: '', dur: '', sort: 'rank', genre: '', decade: '', country: '', dir: '', actor: '', q: '' }); F.bands.clear(); syncControls(); render(); }
  const bind = (sel, key) => $(sel).addEventListener('input', e => { F[key] = e.target.value; render(); });
  let qTimer; $('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = e.target.value.trim(); render(); }, 120); });
  bind('#f-prov', 'prov'); bind('#f-dur', 'dur'); bind('#f-genre', 'genre'); bind('#f-decade', 'decade'); bind('#f-country', 'country'); bind('#f-dir', 'dir'); bind('#f-actor', 'actor');
  $('.seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.media = b.dataset.media; syncControls(); render(); };
  $('#g-sort').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.sort = b.dataset.sort; syncControls(); render(); };
  $('#g-band').onclick = e => { const b = e.target.closest('button'); if (!b) return; const i = +b.dataset.band; F.bands.has(i) ? F.bands.delete(i) : F.bands.add(i); syncControls(); render(); };
  $('#reset').onclick = resetFilters;
  const setTab = t => { tab = t; $('#tab-wl').setAttribute('aria-selected', String(t === 'wl')); $('#tab-sg').setAttribute('aria-selected', String(t === 'sg')); render(); scrollTo({ top: 0 }); };
  $('#tab-wl').onclick = () => setTab('wl'); $('#tab-sg').onclick = () => setTab('sg');

  // ---- Pannelli (filtri e scheda) ----
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
  $('#scrim').onclick = () => { if ($('#detail').classList.contains('open')) closeDetail(); else closeSheet($('#panel')); };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#detail').classList.contains('open')) closeDetail(); else if ($('#panel').classList.contains('open')) closeSheet($('#panel'));
  });

  // ---- Scheda di dettaglio ----
  let current = null, rating = 0;
  const provFig = p => `<figure><img src="${IMG}w92${p.logo}" alt="" loading="lazy" width="44" height="44"><figcaption>${esc(p.name)}</figcaption></figure>`;
  function starsHtml() {
    return Array.from({ length: 5 }, (_, i) => `<span class="star" data-i="${i + 1}"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg>
      <span class="half" hidden><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="full" hidden><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span>
      <button class="l" aria-label="${i + 0.5} stelle" data-v="${i + 0.5}"></button><button class="r" aria-label="${i + 1} stelle" data-v="${i + 1}"></button></span>`).join('');
  }
  function paintStars() {
    document.querySelectorAll('#stars .star').forEach(s => {
      const i = +s.dataset.i;
      s.querySelector('.full').hidden = rating < i; s.querySelector('.half').hidden = !(rating >= i - 0.5 && rating < i);
    });
    $('#save-seen').disabled = !rating; $('#rating-txt').textContent = rating ? `${String(rating).replace('.', ',')} su 5` : 'Dai un voto';
  }
  function openDetail(key, push = true) {
    const it = all().find(i => i.key === key); if (!it) return;
    current = it; rating = 0;
    const facts = [it.year, fmtRuntime(it), it.countries.slice(0, 3).join(', '), it.genres.join(', ')].filter(Boolean).join(' · ');
    const stream = [...new Map([...it.providers.flatrate, ...it.providers.free, ...it.providers.ads].map(p => [p.name, p])).values()];
    const other = [...new Set([...it.providers.rent, ...it.providers.buy].map(p => p.name))].filter(n => !stream.some(s => s.name === n));
    const t = it.media === 'tv' ? 'show' : 'movie';
    const links = [
      it.imdb_id && ['IMDb', `https://www.imdb.com/title/${it.imdb_id}/`],
      it.media === 'movie' && ['Letterboxd', `https://letterboxd.com/tmdb/${it.tmdb_id}/`],
      ['Trakt', `https://trakt.tv/search/tmdb/${it.tmdb_id}?id_type=${t}`],
      ['TMDB', `https://www.themoviedb.org/${it.media}/${it.tmdb_id}`],
    ].filter(Boolean);
    const dirLabel = it.media === 'tv' ? 'Creato da' : 'Regia';
    $('#detail-in').innerHTML = `
      <div class="big">${it.poster ? `<img src="${IMG}w500${it.poster}" srcset="${IMG}w342${it.poster} 342w, ${IMG}w500${it.poster} 500w, ${IMG}w780${it.poster} 780w" sizes="(min-width: 900px) 300px, 62vw" alt="Locandina di ${esc(it.title)}">` : ''}</div>
      <div>
        <h2 id="d-title">${esc(it.title)}</h2>
        ${it.original_title && it.original_title !== it.title ? `<div class="orig">${esc(it.original_title)}</div>` : ''}
        <div class="facts">${esc(facts)}</div>
        <div class="scorebox"><b>${Math.round(it.score)}</b><span>${esc(DATA.bands[it.band])}</span></div>
        <p class="why">${esc(it.why)}${it.via ? `<small>Suggerito perché: ${esc(it.via)}.</small>` : ''}</p>
        ${it.overview ? `<div class="sec"><h4>Trama</h4><p>${esc(it.overview)}</p></div>` : ''}
        <div class="sec"><h4>${dirLabel} e cast</h4><p>${esc([it.directors.join(', '), it.cast.join(', ')].filter(Boolean).join(' — '))}</p></div>
        <div class="sec"><h4>Dove vederlo in Italia</h4>
          ${stream.length ? `<div class="provs">${stream.map(provFig).join('')}</div>` : `<p class="muted">Nessuna piattaforma in abbonamento al momento.</p>`}
          ${other.length ? `<p class="muted" style="margin-top:10px;font-size:13px">Anche a noleggio o acquisto: ${esc(other.slice(0, 5).join(', '))}</p>` : ''}</div>
        <div class="sec"><h4>Link</h4><div class="links">${links.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('')}</div></div>
        <div class="seen-box"><h4 class="sec" style="margin:0 0 10px;font:600 12px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Già visto?</h4>
          <div class="stars" id="stars" role="group" aria-label="Voto in mezze stelle">${starsHtml()}</div>
          <div class="seen-actions"><span class="muted" id="rating-txt"></span><button class="btn primary" id="save-seen" disabled>Segna come visto</button></div>
          <p class="note">Il voto resta nel tuo browser. Nel sito vero ricalcola subito il ranking, fino al prossimo aggiornamento da Trakt.</p></div>
      </div>`;
    paintStars();
    $('#detail').scrollTop = 0;
    openSheet($('#detail'), '#close-detail');
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
    if (e.target.id === 'save-seen' && current && rating) {
      seen[current.key] = rating * 2; store.set('wl-prev-seen', seen);
      toast(`«${current.title}» segnato come visto (${stars(rating * 2)}★)`);
      closeDetail(); render();
    }
  });
  let tt; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200); }

  // ---- Avvio ----
  fetch('data/preview.json').then(r => r.json()).then(d => { DATA = d; buildFacets(); syncControls(); render(); })
    .catch(() => { $('#grid').innerHTML = '<div class="empty"><b>Dati non caricati</b>Apri la pagina da un server (non da file).</div>'; });
})();
