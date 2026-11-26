// Primo login a Trakt con PKCE (nessun client secret), da lanciare in locale:
//   npm run trakt:login
// Apre il browser sulla pagina di autorizzazione e riceve il callback su http://localhost:8080/callback.
// Salva i token in .trakt-token.json (ignorato da git, permessi 600). Non stampa mai i token.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { clientId, exchangeCode, REDIRECT_URI, TOKEN_FILE } from './lib/trakt.js';

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(crypto.randomBytes(48));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const authUrl = new URL('https://trakt.tv/oauth/authorize');
Object.entries({ response_type: 'code', client_id: clientId(), redirect_uri: REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: 'S256' })
  .forEach(([k, v]) => authUrl.searchParams.set(k, v));

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#0d0d0f;color:#eceae4;display:grid;place-items:center;height:100vh;margin:0"><div><h1 style="font-weight:500">${title}</h1><p>${msg}</p></div>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:8080');
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const fail = (code, msg) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }).end(page('Accesso non riuscito', msg)); console.error('✖', msg); finish(1); };
  if (u.searchParams.get('error')) return fail(400, `Trakt ha risposto: ${u.searchParams.get('error')}`);
  if (u.searchParams.get('state') !== state) return fail(400, 'Parametro state non valido: richiesta ignorata.');
  const code = u.searchParams.get('code');
  if (!code) return fail(400, 'Codice mancante nel callback.');
  try {
    await exchangeCode(code, verifier);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page('Fatto', 'Puoi chiudere questa scheda e tornare al terminale.'));
    console.log(`✔ Login completato. Token salvato in ${TOKEN_FILE}`);
    finish(0);
  } catch (e) { fail(500, e.message); }
});
let timer;
function finish(codeNum) { clearTimeout(timer); server.close(); setTimeout(() => process.exit(codeNum), 200); }

server.listen(8080, () => {
  console.log('In attesa del login su Trakt… (timeout 5 minuti)');
  console.log(`Se il browser non si apre, vai a:\n${authUrl}\n`);
  if (process.platform === 'darwin') spawn('open', [authUrl.toString()], { stdio: 'ignore', detached: true }).unref();
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? '✖ La porta 8080 è occupata: chiudi ciò che la usa e riprova.' : e.message); process.exit(1); });
timer = setTimeout(() => { console.error('✖ Tempo scaduto, nessun login ricevuto.'); finish(1); }, 5 * 60 * 1000);
