# watchlist

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
