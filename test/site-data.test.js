import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { p } from '../src/lib/util.js';
import { computeAll } from '../src/ranking.js';

const data = JSON.parse(fs.readFileSync(p('docs', 'data', 'items.json'), 'utf8'));
const rk = JSON.parse(fs.readFileSync(p('data', 'state', 'ranking.json'), 'utf8'));

test('il ricalcolo dal browser (items.json) coincide con il ranking della build', () => {
  const r = computeAll(data);
  assert.equal(r.watchlist.length, rk.watchlist.length);
  const byKey = new Map(rk.watchlist.map(x => [x.key, x]));
  for (const x of r.watchlist) {
    const ref = byKey.get(x.it.key);
    assert.ok(ref, x.it.key);
    assert.ok(Math.abs(x.score - ref.score) < 0.06, `${x.it.title}: ${x.score} vs ${ref.score}`);
    assert.equal(x.band, ref.band, x.it.title);
    assert.equal(x.why, ref.why, x.it.title);
  }
  const refS = new Map(rk.suggestions.map(x => [x.key, x]));
  for (const x of r.suggestions) assert.ok(Math.abs(x.score - refS.get(x.it.key).score) < 0.06, x.it.title);
});

test('segnare un titolo come visto lo toglie dalle liste e lo aggiunge al profilo', () => {
  const base = computeAll(data);
  const target = base.watchlist[0].it;
  const after = computeAll(data, { [target.key]: { my: 10 } });
  assert.equal(after.watchlist.length, base.watchlist.length - 1);
  assert.ok(!after.watchlist.some(x => x.it.key === target.key));
  assert.equal(after.profile.count, base.profile.count + 1);
  // il regista del titolo votato 10 pesa di più (o resta uguale se già al massimo): mai di meno
  const dir = target.d.directors[0]?.id;
  if (dir != null) assert.ok((after.profile.table.directors.get(dir)?.w ?? 0) >= (base.profile.table.directors.get(dir)?.w ?? 0) - 1e-9);
});
