// Drives the real dashboard page in Chromium with a fake bridge (no Electron, no Windows OCR).
// Run with: node dev/flow-test.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const appDir = path.join(__dirname, '..', 'app');
const ocrText = 'JANE SMITH\nAcme Tool Inc\nOffice 231-555-0142\njane.smith@acmetool.com\n1234 Industrial Dr, Muskegon, MI 49441';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const saved = [];
  await page.exposeFunction('__saved', (payload) => saved.push(payload));

  // Fake bridge: stores cards in memory and returns the sample OCR text.
  const bridge = `
    window.__store = [];
    window.cards = {
      list: async (o = {}) => window.__store.filter(c => !o.search || JSON.stringify(c).toLowerCase().includes(o.search.toLowerCase())),
      tags: async () => [],
      get: async (id) => ({ card: window.__store.find(c => c.id === id), imageDataUrl: '' }),
      duplicates: async () => [],
      save: async (p) => { window.__saved(p); const id = window.__store.length + 1; window.__store.push({ id, ...p.data, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }); return id; },
      remove: async () => true,
      ocr: async () => ${JSON.stringify(ocrText)},
      readClipboard: async () => null,
      confirm: async () => true,
      info: async () => true,
      exportCards: async () => ({ saved: false }),
      appInfo: async () => ({ name: 'Business Cards', version: '1.0.0', dataDir: 'test' }),
      openDataFolder: async () => true,
    };`;

  // Load the real page, with the bridge injected ahead of the app scripts and the CSP removed for this test only.
  let html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  html = html.replace('<script src="parser.js"></script>', `<script>${bridge}</script><script src="parser.js"></script>`);
  const tmp = path.join(appDir, '__flow_test.html');
  fs.writeFileSync(tmp, html);
  try {
    await page.goto('file://' + tmp);
    await page.waitForTimeout(300);

    // 1. Empty state is friendly
    const empty = await page.textContent('#rows');
    assert.match(empty, /No cards yet/);

    // 2. Add a photo through the file input: crop, read, fill the form
    await page.setInputFiles('#fileInput', path.join(__dirname, 'sample-card-photo.png'));
    await page.waitForFunction(() => document.getElementById('f_name').value !== '', null, { timeout: 15000 });
    assert.strictEqual(await page.inputValue('#f_name'), 'JANE SMITH');
    assert.strictEqual(await page.inputValue('#f_company'), 'Acme Tool Inc');
    assert.strictEqual(await page.inputValue('#f_email'), 'jane.smith@acmetool.com');
    assert.strictEqual(await page.inputValue('#f_phone'), '(231) 555-0142');
    const thumbSrc = await page.$eval('#thumb img', i => i.src).catch(() => '');
    assert.ok(thumbSrc.startsWith('data:image/png'), 'cropped image shown');
    const banner = await page.textContent('#banner');
    assert.match(banner, /Review the details/);
    console.log('capture + crop + parse: ok');

    // 3. Save: the cropped PNG is sent and the list updates
    await page.click('#btnSave');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 1, null, { timeout: 5000 });
    assert.ok(saved.length === 1 && saved[0].pngDataUrl && saved[0].pngDataUrl.startsWith('data:image/png'));
    console.log('save + list: ok');

    // 4. A row click shows the card again
    await page.click('#rows tr[data-id]');
    await page.waitForTimeout(150);
    assert.strictEqual(await page.inputValue('#f_name'), 'JANE SMITH');
    console.log('select row: ok');

    // 5. Editing a phone number to an invalid one warns, does not block
    await page.fill('#f_mobile', '555-01');
    await page.locator('#f_mobile').blur();
    await page.waitForTimeout(100);
    const note = await page.textContent('[data-note="mobile"]');
    assert.match(note, /digits/);
    console.log('phone warning: ok');

    // 6. Empty-filter message
    await page.fill('#search', 'zzzz-no-match');
    await page.waitForTimeout(150);
    assert.match(await page.textContent('#rows'), /No cards match/);
    console.log('filter empty state: ok');

    await page.screenshot({ path: path.join(__dirname, 'shot-flow.png') });
    assert.deepStrictEqual(errors, [], 'page errors: ' + errors.join(' | '));
    console.log('no page errors: ok');
    console.log('ALL FLOW CHECKS PASSED');
  } finally {
    fs.unlinkSync(tmp);
    await browser.close();
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
