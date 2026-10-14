// Run with: node dev/test-imaging.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const I = require('../app/imaging.js');

// Build a synthetic "photo": a light card (quadrilateral) on a dark table.
function photo(width, height, quad, cardGray = 245, tableGray = 120) {
  const data = new Uint8ClampedArray(width * height * 4);
  const inside = (px, py) => {
    // Point-in-convex-polygon test for the quad (TL, TR, BR, BL), clockwise on screen.
    let sign = null;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % 4];
      const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (sign === null) sign = Math.sign(cr);
      else if (Math.sign(cr) !== 0 && Math.sign(cr) !== sign) return false;
    }
    return true;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = inside(x, y) ? cardGray : tableGray;
    const j = (y * width + x) * 4;
    data[j] = data[j + 1] = data[j + 2] = v; data[j + 3] = 255;
  }
  return { width, height, data };
}

test('otsu separates light and dark', () => {
  const g = new Uint8Array([10, 10, 10, 200, 200, 200]);
  const t = I.otsuThreshold(g);
  assert.ok(t >= 10 && t < 200);
});

test('convex hull of a square', () => {
  const hull = I.convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]);
  assert.equal(hull.length, 4);
});

test('finds a tilted card and straightens it to card proportions', () => {
  const quad = [[300, 220], [880, 260], [850, 610], [270, 580]];
  const img = photo(1200, 900, quad);
  const r = I.cropCard(img);
  assert.equal(r.detected, true, r.message);
  const ratio = r.image.width / r.image.height;
  assert.ok(Math.abs(ratio - 1.75) < 0.3, `ratio was ${ratio}`);
  // The straightened crop should be mostly card (light), not table (dark).
  let sum = 0;
  for (let i = 0; i < r.image.data.length; i += 4) sum += r.image.data[i];
  const mean = sum / (r.image.data.length / 4);
  assert.ok(mean > 200, `mean brightness ${mean}`);
});

test('a plain image is not reported as a card', () => {
  const img = photo(400, 300, [[-1, -1], [401, -1], [401, 301], [-1, 301]], 128, 128);
  const r = I.cropCard(img);
  assert.equal(r.detected, false);
});
