// Rinnova il token Trakt e lo salva in TRAKT_TOKEN_FILE (default .trakt-token.json).
//   node src/trakt-refresh.js                       → rinnova, non stampa nulla di segreto
//   node src/trakt-refresh.js --print-refresh-token → stampa SOLO il nuovo refresh token (per `gh secret set`)
// Trakt ruota il refresh token a ogni rinnovo: quello vecchio smette subito di valere, quindi chi lo chiama
// deve salvare subito quello nuovo (la Action lo scrive nel secret TRAKT_REFRESH_TOKEN).
import { refreshToken, loadToken } from './lib/trakt.js';

const t = await refreshToken(loadToken());
if (process.argv.includes('--print-refresh-token')) process.stdout.write(t.refresh_token);
else console.log('Token Trakt rinnovato.');
