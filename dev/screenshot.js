// Renders the dashboard with sample data for design review. Not shipped.
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const app = path.join(__dirname, '..', 'app', 'index.html');
const sample = [
  { id: 1, name: 'Jane Smith', title: 'Senior Sales Manager', company: 'Acme Machine & Tool Inc.', category: 'Vendor', phone: '(231) 555-0142', mobile: '', email: 'jane.smith@acmetool.com', updatedAt: '2026-10-12T10:00:00', favorite: 1, tags: 'tooling,urgent' },
  { id: 2, name: 'Mary Ng', title: 'Purchasing Agent', company: 'Spartan Fasteners', category: 'Vendor', phone: '(517) 555-0120', mobile: '', email: 'mary@spartanfast.com', updatedAt: '2026-10-09T10:00:00', favorite: 0, tags: '' },
  { id: 3, name: 'Bob Jones', title: 'Buyer', company: 'WidgetCo LLC', category: 'Reseller', phone: '', mobile: '(616) 555-0199', email: 'bob@widgetco.com', updatedAt: '2026-09-28T10:00:00', favorite: 0, tags: 'reseller' },
  { id: 4, name: 'Dana Ortiz', title: 'Field Engineer', company: 'Great Lakes Gage', category: 'Business', phone: '(989) 555-0177', mobile: '', email: 'dana@greatlakesgage.com', updatedAt: '2026-09-15T10:00:00', favorite: 0, tags: '' },
];
const card = sample[0];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    const sample = JSON.parse(document.documentElement.dataset.sample || 'null');
    window.__sample = sample;
  });
  await page.setContent('<html data-sample=\'' + JSON.stringify(sample).replace(/'/g, '&#39;') + '\'></html>');
  // Inject the page content and a fake bridge before the app scripts run.
  const html = require('fs').readFileSync(app, 'utf8');
  const bridge = `<script>
    const SAMPLE = ${JSON.stringify(sample)};
    window.cards = {
      list: async (o={}) => { let r = SAMPLE.slice(); if (o.search) r = r.filter(c => JSON.stringify(c).toLowerCase().includes(o.search.toLowerCase())); return r; },
      tags: async () => ['reseller','tooling','urgent'],
      get: async (id) => ({ card: SAMPLE.find(c => c.id === id), imageDataUrl: '' }),
      duplicates: async () => [], save: async () => 1, remove: async () => true,
      ocr: async () => '', readClipboard: async () => null, confirm: async () => true, info: async () => true,
      exportCards: async () => ({ saved: false }), appInfo: async () => ({ name: 'Business Cards', version: '1.0.0', dataDir: 'C:\\\\Users\\\\you\\\\AppData\\\\Roaming\\\\BusinessCards' }),
      openDataFolder: async () => true,
    };
  </script>`;
  const full = html.replace('<script src="parser.js"></script>', bridge + '<script src="parser.js"></script>');
  require('fs').writeFileSync(path.join(__dirname, 'preview.html'), full.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/src="(parser|imaging|renderer)\.js"/g, 'src="../app/$1.js"'));
  await page.goto('file://' + path.join(__dirname, 'preview.html'));
  await page.waitForTimeout(400);
  await page.click('tbody tr:nth-child(1)');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'shot-dashboard.png') });
  await browser.close();
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
