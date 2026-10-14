// Run with: node dev/test-parser.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const P = require('../app/parser.js');

test('full business card', () => {
  const c = P.parseCardText([
    'Jane Smith', 'Senior Sales Manager', 'Acme Machine & Tool Inc.',
    'Office: 231.555.0142 x204', 'Cell 616-555-0199', 'jane.smith@acmetool.com',
    'www.acmetool.com', '1234 Industrial Dr, Muskegon, MI 49441'].join('\n'));
  assert.equal(c.name, 'Jane Smith');
  assert.equal(c.title, 'Senior Sales Manager');
  assert.equal(c.company, 'Acme Machine & Tool Inc.');
  assert.equal(c.phone, '(231) 555-0142 ext. 204');
  assert.equal(c.mobile, '(616) 555-0199');
  assert.equal(c.email, 'jane.smith@acmetool.com');
  assert.equal(c.website, 'www.acmetool.com');
  assert.match(c.address, /Muskegon/);
  assert.equal(c.notes, '');
  assert.deepEqual(c.warnings, {});
});

test('title is not mistaken for company', () => {
  const c = P.parseCardText('Mary Ng\nPurchasing Agent\nSpartan Fasteners\nmary@spartanfast.com');
  assert.equal(c.title, 'Purchasing Agent');
  assert.equal(c.company, 'Spartan Fasteners');
  assert.equal(c.warnings.company, undefined);
});

test('personal email warns', () => {
  const c = P.parseCardText('Bob Jones\nBuyer\nWidgetCo LLC\n(231) 555-0100\nbob@gmail.com');
  assert.match(c.warnings.email, /Personal email/);
});

test('missing name warns and is low confidence', () => {
  const c = P.parseCardText('blurry 12 ##\n???');
  assert.ok(c.warnings.name);
  assert.ok(c.lowConfidence.includes('name'));
});

test('phone formatting and checks', () => {
  assert.equal(P.formatPhone('2315550142'), '(231) 555-0142');
  assert.equal(P.formatPhone('1-231-555-0142'), '(231) 555-0142');
  assert.equal(P.checkPhone('(231) 555-0142'), null);
  assert.match(P.checkPhone('(231) 555-01'), /digits/);
  assert.match(P.checkPhone('(031) 555-0142'), /Area code/);
  assert.match(P.checkPhone('(222) 222-2222'), /repeated/);
});

test('email checks', () => {
  assert.notEqual(P.checkEmail('not-an-email', ''), null);
  assert.equal(P.checkEmail('a@acme.com', 'Acme Tool'), null);
  assert.notEqual(P.checkEmail('a@zebra.com', 'Acme Tool'), null);
});

test('email is not left in notes', () => {
  const c = P.parseCardText('Jane Smith\nAcme Machine & Tool Inc.\nOffice: 231.555.0142 x204\njane.smith@acmetool.com\nwww.acmetool.com');
  assert.equal(c.notes, '');
});

test('empty text is handled', () => {
  const c = P.parseCardText('');
  assert.ok(c.warnings.contact);
});

// Regression cases from a real saved-cards file (see the user's cards.json).
test('regression: logo word and all-caps company are not the name', () => {
  const c = P.parseCardText('hero\nBALDWIN AND JONES\nSlogan or Tagline\nNOVA AUSTIN\nLEAD ACCOUNTANT\nPhone: 555-555-5555\nEmail: nova.austin@email.com\n1234 Frank Lloyd Wright\nScottsdale AZ 85999');
  assert.equal(c.name, 'NOVA AUSTIN');
  assert.equal(c.company, 'BALDWIN AND JONES');
  assert.equal(c.title, 'LEAD ACCOUNTANT');
  assert.equal(c.address, '1234 Frank Lloyd Wright, Scottsdale AZ 85999');
  assert.equal(c.website, '');
  assert.ok(!/Slogan|Tagline|Email:/i.test(c.notes), 'notes: ' + c.notes);
});

test('regression: template card, designer title, and .corn typo warning', () => {
  const c = P.parseCardText('COMPANY NAME\nJOHN DOE\nCreative Designer\nLorem ipsum Sit. Lorem\nipsum dolor sit\n*123 584 254 11\ninfo@email.corn\nwww.website.com');
  assert.equal(c.title, 'Creative Designer');
  assert.equal(c.website, 'www.website.com');
  assert.match(c.warnings.email, /did you mean \.com/);
});
