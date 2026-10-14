// Finds a business card in a photo and returns a straightened, cropped image.
// Works on raw RGBA pixels so it runs in the browser (canvas) and in Node tests.
// Method: Otsu threshold -> largest bright region -> minimum-area rectangle ->
// perspective correction. Light cards on a darker background work best.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardImaging = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CARD_ASPECT = 3.5 / 2.0;
  const MAX_DETECT_SIDE = 420;
  const MIN_AREA_FRACTION = 0.08;
  const MAX_AREA_FRACTION = 0.9;
  const MAX_OUTPUT_WIDTH = 1200;

  function grayscale(img) {
    const n = img.width * img.height;
    const g = new Uint8Array(n);
    const d = img.data;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      g[i] = Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]);
    }
    return g;
  }

  // Otsu: the threshold that best separates dark from light pixels.
  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let sumB = 0, wB = 0, best = -1, threshold = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }

  // Largest 4-connected bright region, as a list of pixel indices in the small image.
  function largestComponent(mask, w, h) {
    const seen = new Uint8Array(w * h);
    let best = [];
    const stack = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      const comp = [];
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop();
        comp.push(p);
        const x = p % w, y = (p - x) / w;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  }

  // Monotone-chain convex hull of [x, y] points.
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Minimum-area rectangle around a convex hull: try every hull edge direction.
  function minAreaRect(hull) {
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(-ang), s = Math.sin(-ang);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of hull) {
        const rx = x * c - y * s, ry = x * s + y * c;
        if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
      }
      const area = (maxX - minX) * (maxY - minY);
      if (!best || area < best.area) best = { area, ang, minX, maxX, minY, maxY };
    }
    const { ang, minX, maxX, minY, maxY } = best;
    const c = Math.cos(ang), s = Math.sin(ang);
    const back = (rx, ry) => [rx * c - ry * s, rx * s + ry * c];
    // Corners in order: top-left, top-right, bottom-right, bottom-left (in rotated space).
    return [back(minX, minY), back(maxX, minY), back(maxX, maxY), back(minX, maxY)];
  }

  function aspectOk(quad) {
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const w = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2;
    const h = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
    if (w === 0 || h === 0) return false;
    const ratio = Math.max(w, h) / Math.min(w, h);
    return Math.abs(ratio - CARD_ASPECT) / CARD_ASPECT < 0.35;
  }

  // Solve the 3x3 homography that maps src[i] -> dst[i] for 4 point pairs.
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      [A[col], A[piv]] = [A[piv], A[col]];
      [b[col], b[piv]] = [b[piv], b[col]];
      const p = A[col][col] || 1e-12;
      for (let r = col + 1; r < n; r++) {
        const f = A[r][col] / p;
        for (let k = col; k < n; k++) A[r][k] -= f * A[col][k];
        b[r] -= f * b[col];
      }
    }
    const h = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let sum = b[r];
      for (let k = r + 1; k < n; k++) sum -= A[r][k] * h[k];
      h[r] = sum / (A[r][r] || 1e-12);
    }
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function sampleBilinear(img, x, y) {
    const w = img.width, h = img.height, d = img.data;
    x = Math.min(Math.max(x, 0), w - 1.001);
    y = Math.min(Math.max(y, 0), h - 1.001);
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const out = [0, 0, 0, 255];
    for (let c = 0; c < 3; c++) {
      const i00 = (y0 * w + x0) * 4 + c, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
      out[c] = (d[i00] * (1 - fx) + d[i10] * fx) * (1 - fy) + (d[i01] * (1 - fx) + d[i11] * fx) * fy;
    }
    return out;
  }

  // Warp the quad (ordered TL, TR, BR, BL) into a straight rectangle.
  function warpQuad(img, quad) {
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    let width = Math.round(Math.max(d(quad[2], quad[3]), d(quad[1], quad[0])));
    let height = Math.round(Math.max(d(quad[1], quad[2]), d(quad[0], quad[3])));
    if (width < height) { const t = width; width = height; height = t; }
    width = Math.max(width, 10); height = Math.max(height, 10);
    // Trim a thin margin: table edges often show up as stray text.
    const trim = Math.max(2, Math.floor(0.015 * Math.min(width, height)));
    const outW = width - 2 * trim, outH = height - 2 * trim;
    const dst = [[trim, trim], [width - 1 - trim, trim], [width - 1 - trim, height - 1 - trim], [trim, height - 1 - trim]];
    // Map output pixels back to the source: homography from output space to source quad.
    const H = homography(dst, quad);
    const data = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const px = x + trim, py = y + trim;
        const den = H[6] * px + H[7] * py + 1;
        const sx = (H[0] * px + H[1] * py + H[2]) / den;
        const sy = (H[3] * px + H[4] * py + H[5]) / den;
        const [r, g, bl] = sampleBilinear(img, sx, sy);
        const j = (y * outW + x) * 4;
        data[j] = r; data[j + 1] = g; data[j + 2] = bl; data[j + 3] = 255;
      }
    }
    return { width: outW, height: outH, data };
  }

  // Resize to sw x sh (bilinear), used for detection on a smaller copy.
  function resize(img, sw, sh) {
    const data = new Uint8ClampedArray(sw * sh * 4);
    const kx = img.width / sw, ky = img.height / sh;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const [r, g, b] = sampleBilinear(img, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
        const j = (y * sw + x) * 4;
        data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = 255;
      }
    }
    return { width: sw, height: sh, data };
  }

  function limitWidth(img) {
    if (img.width <= MAX_OUTPUT_WIDTH) return img;
    const scale = MAX_OUTPUT_WIDTH / img.width;
    const w = MAX_OUTPUT_WIDTH, h = Math.round(img.height * scale);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = sampleBilinear(img, x / scale, y / scale);
        const j = (y * w + x) * 4;
        data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = 255;
      }
    }
    return { width: w, height: h, data };
  }

  function cropCard(img) {
    const scale = Math.min(1, MAX_DETECT_SIDE / Math.max(img.width, img.height));
    const sw = Math.max(1, Math.round(img.width * scale)), sh = Math.max(1, Math.round(img.height * scale));
    const small = scale < 1 ? resize(img, sw, sh) : img;
    const gray = grayscale(small);
    const t = otsuThreshold(gray);
    const mask = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] > t ? 1 : 0;
    const comp = largestComponent(mask, sw, sh);
    const frac = comp.length / (sw * sh);
    if (frac < MIN_AREA_FRACTION || frac > MAX_AREA_FRACTION) {
      return { image: limitWidth(img), detected: false,
        message: 'Card outline not found; showing the full image. Retake the photo on a plain, dark background for a better crop.' };
    }
    const pts = comp.map(p => [p % sw, Math.floor(p / sw)]);
    const quadSmall = minAreaRect(convexHull(pts));
    if (!aspectOk(quadSmall)) {
      return { image: limitWidth(img), detected: false,
        message: 'Card outline not found; showing the full image. Retake the photo on a plain, dark background for a better crop.' };
    }
    const k = img.width / sw;
    const quad = quadSmall.map(([x, y]) => [x * k, y * k]);
    return { image: limitWidth(warpQuad(img, quad)), detected: true, message: 'Card found and straightened.' };
  }

  return { cropCard, otsuThreshold, convexHull, homography, _internals: { grayscale, largestComponent, minAreaRect, aspectOk } };
});
