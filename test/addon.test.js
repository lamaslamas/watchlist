import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { p } from '../src/lib/util.js';

const manifest = JSON.parse(fs.readFileSync(p('docs', 'manifest.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(p('docs', 'data', 'items.json'), 'utf8'));
const read = (type, id) => JSON.parse(fs.readFileSync(p('docs', 'catalog', type, `${id}.json`), 'utf8'));

test('manifest: campi richiesti dal protocollo, solo cataloghi (niente stream)', () => {
  for (const k of ['id', 'version', 'name', 'description']) assert.ok(typeof manifest[k] === 'string' && manifest[k], k);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.resources, ['catalog']);
  assert.ok(!JSON.stringify(manifest).includes('stream'));
  assert.deepEqual([...manifest.types].sort(), ['movie', 'series']);
  assert.ok(manifest.catalogs.length >= 6);
});

test('ogni catalogo del manifest ha il suo file al percorso che Stremio richiede (/catalog/<tipo>/<id>.json)', () => {
  const seen = new Set();
  for (const c of manifest.catalogs) {
    assert.ok(manifest.types.includes(c.type), c.id);
    assert.ok(c.id && c.name, JSON.stringify(c));
    assert.ok(!seen.has(`${c.type}/${c.id}`)); seen.add(`${c.type}/${c.id}`);
    assert.ok(!c.extra, 'cataloghi statici: nessun extra (skip/search)');
    const file = read(c.type, c.id);
    assert.ok(Array.isArray(file.metas) && file.metas.length > 0, `${c.type}/${c.id} vuoto`);
  }
});

test('meta: id IMDb (tt…), tipo coerente, nome e locandina, nessun doppione', () => {
  for (const c of manifest.catalogs) {
    const ids = new Set();
    for (const m of read(c.type, c.id).metas) {
      assert.match(m.id, /^tt\d+$/, `${c.type}/${c.id}: ${m.name}`);
      assert.equal(m.type, c.type);
      assert.ok(m.name);
      if (m.poster) assert.match(m.poster, /^https:\/\/image\.tmdb\.org\//);
      assert.ok(!ids.has(m.id), `doppione ${m.id}`); ids.add(m.id);
    }
  }
});

test('cataloghi coerenti con i dati: sotto i 100 minuti, film/serie separati, ordine di ranking', () => {
  const byImdb = new Map([...items.watchlist, ...items.suggestions].map(i => [i.imdb_id, i]));
  for (const m of read('movie', 'sotto-100').metas) assert.ok(byImdb.get(m.id).runtime < 100, m.name);
  for (const m of read('movie', 'da-vedere').metas) assert.equal(byImdb.get(m.id).media, 'movie');
  for (const m of read('series', 'da-vedere').metas) assert.equal(byImdb.get(m.id).media, 'tv');
  const scores = read('movie', 'da-vedere').metas.map(m => +m.description.split(' ')[0]);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] <= scores[i - 1] + 0.5, 'ordine di ranking'); // il punteggio in descrizione è arrotondato
});
