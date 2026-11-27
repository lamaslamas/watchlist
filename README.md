# Cosa guardiamo?

Sito statico che ordina i film e le serie che voglio vedere in base ai miei gusti, più un addon catalogo per Stremio/Nuvio servito dallo stesso sito. Tutto statico su GitHub Pages; una GitHub Action lo aggiorna ogni notte da Trakt.

- **Sito:** https://lamaslamas.github.io/watchlist/
- **Addon (manifest da installare):** https://lamaslamas.github.io/watchlist/manifest.json

## Come funziona
Trakt (voti, watchlist, visti) → TMDB (dati, piattaforme in Italia) → profilo di gusto e punteggio → `docs/` (sito + addon).
I pesi del ranking sono in [`config/ranking.yml`](config/ranking.yml). I titoli che non entrano su Trakt (limite di 500 voci della watchlist gratuita) stanno in [`config/extra-watchlist.json`](config/extra-watchlist.json).

## Comandi
```bash
npm ci
npm run update      # sync Trakt → TMDB → suggeriti → ranking → sito e addon → test
npm run trakt:login # primo login (PKCE, localhost:8080)
npm run validate    # validazione leave-one-out del profilo
npm test
node scripts/serve.mjs   # anteprima locale di docs/
```

## Segreti (GitHub → Settings → Secrets and variables → Actions)
| Secret | Cos'è |
|---|---|
| `TMDB_TOKEN` | token di lettura API TMDB |
| `TRAKT_CLIENT_ID` | client ID dell'app Trakt (PKCE, nessun client secret) |
| `TRAKT_REFRESH_TOKEN` | refresh token Trakt; la Action lo rinnova e lo riscrive a ogni giro (Trakt lo ruota) |
| `SECRETS_PAT` | token GitHub *fine-grained*, solo questo repo, solo permesso «Secrets: Read and write» |

Nessun token è nel codice né nei file pubblicati. I file generati (`docs/data`, `docs/catalog`, `docs/manifest.json`) non sono versionati: li produce la Action. Nel repo si salva solo la cache TMDB.

Dati e immagini: TMDB. Questo prodotto usa le API di TMDB ma non è approvato né certificato da TMDB.

## Occasioni e azioni Trakt dal sito

**Pulsanti per occasione** (sotto la barra di ricerca; si combinano). Tutte le regole sono nel blocco `occasions` di `config/ranking.yml`:
- *In famiglia*: classificazione per età TMDB ammessa (IT; con `strict: true` anche quella US, se presente), niente generi/keyword esclusi, almeno un genere da famiglia (`require_genres`). Con il filtro attivo i generi in `prefer_genres` salgono nell'ordinamento (`prefer_bonus`).
- *Con la mia compagna*: niente generi esclusi, film entro `max_runtime` minuti.
- *Scelti insieme*: i titoli nella lista Trakt personale `insieme` (privata, creata al primo uso).
- *Leggero* / *Impegnativo*: da generi e keyword (`mood`); se nessuno dei due prevale il titolo non compare in nessuno.
- *Sotto i 100 min*: solo film.

**Login Trakt dal browser** (PKCE, senza client secret): il token resta solo nel `localStorage` del browser, mai nel repo né nei file pubblicati. Nell'app Trakt (trakt.tv/oauth/applications) servono:
- tra gli *Allowed origins* (CORS): `https://lamaslamas.github.io`
- tra i *Redirect URIs*: `https://lamaslamas.github.io/watchlist/` (uno per riga, oltre a `http://localhost:8080/callback` per il login da terminale)

Il client ID (non segreto) viene incluso in `items.json` dalla build, che lo legge da `TRAKT_CLIENT_ID`.

Con l'accesso: il voto (mezze stelle → 1-10) va a Trakt; per i film viene anche segnato come visto, per le serie solo il voto (gli episodi si segnano su Trakt). "Aggiungi alla watchlist" (dai suggeriti) e "Da vedere insieme" scrivono su Trakt. Senza accesso il voto resta in `localStorage` e ricalcola comunque il ranking; dopo il login il pannello Trakt offre di inviare i voti rimasti locali. L'aggiornamento notturno legge tutto da Trakt e conferma o corregge ciò che il browser ha mostrato.
