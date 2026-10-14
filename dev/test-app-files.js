// Run with: node dev/test-app-files.js
// Checks that every file the page loads exists, and the installer references the right files.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('page scripts exist', () => {
  const html = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  for (const m of html.matchAll(/src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, 'app', m[1])), m[1]);
});

test('package.json points at main.js and main.js exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(root, 'app', pkg.main)));
});

test('installer copies the app and its icon', () => {
  const ps = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  assert.ok(ps.includes("Copy-Item (Join-Path $PSScriptRoot 'app\\*')"));
  assert.ok(ps.includes("Rename-Item (Join-Path $dest 'electron.exe') 'BusinessCards.exe'"));
  assert.ok(ps.includes('Start-Process $exe'));
});
