import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/lib/util.js';
import { certsOf } from '../src/lib/certs.js';
import { isFamily, familyBonus, isPartner, mood } from '../src/occasions.js';

const cfg = loadConfig();
const g = (...n) => n.map(name => ({ name }));
const item = (o = {}) => ({ media: 'movie', runtime: 100, certs: { IT: 'T', US: 'PG' }, d: { genres: g('Animazione'), keywords: [] }, ...o, d: { genres: g('Animazione'), keywords: [], ...(o.d ?? {}) } });

test('certsOf: film dalle release_dates (preferisce il cinema), serie dai content_ratings', () => {
  const movie = { results: [
    { iso_3166_1: 'IT', release_dates: [{ certification: '', type: 1 }, { certification: 'VM14', type: 4 }, { certification: 'T', type: 3 }] },
    { iso_3166_1: 'US', release_dates: [{ certification: 'PG', type: 3 }] }] };
  assert.deepEqual(certsOf('movie', movie), { IT: 'T', US: 'PG' });
  assert.deepEqual(certsOf('tv', { results: [{ iso_3166_1: 'US', rating: 'TV-Y7' }] }), { IT: null, US: 'TV-Y7' });
  assert.deepEqual(certsOf('movie', undefined), { IT: null, US: null });
});

test('In famiglia: classificazione, generi esclusi e obbligatori', () => {
  assert.equal(isFamily(item(), cfg), true);
  assert.equal(isFamily(item({ certs: { IT: 'VM14', US: 'PG' } }), cfg), false, 'IT non adatta');
  assert.equal(isFamily(item({ certs: { IT: 'T', US: 'R' } }), cfg), false, 'strict: anche la US deve essere adatta');
  assert.equal(isFamily(item({ certs: { IT: null, US: 'G' } }), cfg), true, 'solo US se manca l\'IT');
  assert.equal(isFamily(item({ certs: { IT: null, US: 'NR' }, d: { genres: g('Animazione') } }), cfg), true, 'NR = senza classificazione: decidono i generi');
  assert.equal(isFamily(item({ certs: { IT: null, US: null }, d: { genres: g('Commedia') } }), cfg), false, 'senza classificazione solo animazione/famiglia');
  assert.equal(isFamily(item({ d: { genres: g('Animazione', 'Horror') } }), cfg), false, 'niente horror');
  assert.equal(isFamily(item({ d: { genres: g('Dramma') } }), cfg), false, 'serve un genere da famiglia');
  assert.equal(isFamily(item({ d: { keywords: g('murder') } }), cfg), false, 'keyword esclusa');
  const loose = { ...cfg, occasions: { ...cfg.occasions, family: { ...cfg.occasions.family, strict: false } } };
  assert.equal(isFamily(item({ certs: { IT: 'T', US: 'R' } }), loose), true, 'senza strict conta l\'IT');
  assert.ok(familyBonus(item(), cfg) > 0 && familyBonus(item({ d: { genres: g('Dramma') } }), cfg) === 0);
});

test('Con la compagna: niente horror, durata massima solo per i film', () => {
  const max = cfg.occasions.partner.max_runtime;
  assert.equal(isPartner(item({ d: { genres: g('Horror') } }), cfg), false);
  assert.equal(isPartner(item({ runtime: max + 1 }), cfg), false);
  assert.equal(isPartner(item({ runtime: max }), cfg), true);
  assert.equal(isPartner(item({ media: 'tv', runtime: 600 }), cfg), true);
  assert.equal(isPartner(item({ runtime: null }), cfg), true);
});

test('Umore: leggero / impegnativo / nessuno', () => {
  assert.equal(mood(item({ d: { genres: g('Commedia') } }), cfg), 'light');
  assert.equal(mood(item({ d: { genres: g('Dramma', 'Guerra') } }), cfg), 'heavy');
  assert.equal(mood(item({ d: { genres: g('Commedia', 'Dramma') } }), cfg), null, 'pari: nessuno prevale');
  assert.equal(mood(item({ d: { genres: g('Azione') } }), cfg), null);
  assert.equal(mood(item({ d: { genres: g('Commedia', 'Dramma'), keywords: g('hilarious', 'amused') } }), cfg), 'light', 'le keyword fanno pendere');
});

test('la config delle occasioni è completa', () => {
  const o = cfg.occasions;
  for (const k of ['family', 'partner', 'mood', 'short_runtime']) assert.ok(o[k], k);
  assert.ok(o.family.certifications.IT.length && o.family.certifications.US.length);
  assert.ok(o.partner.together_list);
});
