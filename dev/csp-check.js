// Confirms the shipped page (with its security policy) loads its own scripts from a file:// URL.
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  await page.waitForTimeout(300);
  const loaded = await page.evaluate(() => ({ parser: typeof CardParser, imaging: typeof CardImaging }));
  console.log(JSON.stringify(loaded), 'errors:', errs.length, errs.slice(0,2));
  await browser.close();
})();
