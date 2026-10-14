// Run with: node dev/test-exporter.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { toCsv, cardToVcard } = require('../app/exporter.js');

test('csv escapes commas, quotes, and formula-like values', () => {
  const csv = toCsv([{ name: 'Jane "JJ" Smith', company: 'Acme, Inc', email: '=HYPERLINK("x")', favorite: 1, category: 'Vendor' }]);
  assert.ok(csv.startsWith('﻿Name,Title,'));
  assert.ok(csv.includes('"Jane ""JJ"" Smith"'));
  assert.ok(csv.includes('"Acme, Inc"'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes(',Yes,'));
});

test('vcard has name split and escaped company', () => {
  const v = cardToVcard({ name: 'Jane Smith', company: 'Acme, Inc', email: 'j@a.com' });
  assert.ok(v.includes('N:Smith;Jane;;;'));
  assert.ok(v.includes('ORG:Acme\\, Inc'));
  assert.ok(v.includes('END:VCARD'));
});
