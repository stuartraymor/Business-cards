// Run with: node dev/test-store.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CardStore, normalizeTags } = require('../app/store.js');

function fresh() { return new CardStore(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'))); }

test('add, search, filter, sort', () => {
  const s = fresh();
  const a = s.add({ name: 'Jane Smith', company: 'Acme Tool', email: 'jane@acme.com', phone: '(231) 555-0142', category: 'Vendor', tags: 'Tooling, Urgent' }, Buffer.from('png'), 'raw');
  s.add({ name: 'Bob Jones', company: 'Widget Co', category: 'Reseller', mobile: '(616) 555-0199' });
  assert.equal(s.list().length, 2);
  assert.deepEqual(s.list({ search: 'acme jane' }).map(c => c.company), ['Acme Tool']);
  assert.deepEqual(s.list({ category: 'Reseller' }).map(c => c.name), ['Bob Jones']);
  assert.deepEqual(s.list({ tag: 'urgent' }).map(c => c.name), ['Jane Smith']);
  assert.deepEqual(s.list({ sortKey: 'name', ascending: false }).map(c => c.name), ['Jane Smith', 'Bob Jones']);
  assert.deepEqual(s.list({ sortKey: 'name', ascending: true }).map(c => c.name), ['Bob Jones', 'Jane Smith']);
  assert.equal(fs.existsSync(s.imagePath(s.get(a).imageName)), true);
  s.update(2, { favorite: 1 });
  assert.deepEqual(s.list({ favoritesOnly: true }).map(c => c.name), ['Bob Jones']);
  s.remove(a);
  assert.equal(s.list().length, 1);
  assert.deepEqual(s.allTags(), []);
});

test('duplicates by email, phone, and name+company', () => {
  const s = fresh();
  s.add({ name: 'Jane Smith', company: 'Acme Tool', email: 'jane@acme.com', mobile: '(616) 555-0199' });
  assert.equal(s.findDuplicates({ email: 'JANE@acme.com' }).length, 1);
  assert.equal(s.findDuplicates({ phone: '1-616-555-0199' }).length, 1);
  assert.equal(s.findDuplicates({ name: 'jane smith', company: 'Acme Tool Co' }).length, 1);
  assert.equal(s.findDuplicates({ email: 'other@x.com' }).length, 0);
});

test('search text is treated as data, not a pattern', () => {
  const s = fresh();
  s.add({ name: 'Safe' });
  assert.equal(s.list({ search: "x' OR '1'='1" }).length, 0);
  assert.equal(s.list({ search: '.*' }).length, 0);
});

test('tags are normalized', () => {
  assert.equal(normalizeTags(' Tooling, urgent ,tooling;Vendor'), 'tooling,urgent,vendor');
});

test('a damaged database is kept, not overwritten silently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'));
  fs.writeFileSync(path.join(dir, 'cards.json'), '{not json');
  const s = new CardStore(dir);
  assert.equal(s.list().length, 0);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('cards.damaged-')));
});
