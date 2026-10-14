// Local storage: one JSON file (cards.json) plus an images folder.
// Writes go to a temporary file first, then replace the old file, so a crash
// never leaves a half-written database behind.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATEGORIES = ['Vendor', 'Reseller', 'Business', 'Other'];
const FIELDS = ['name', 'title', 'company', 'category', 'phone', 'mobile', 'fax',
  'email', 'website', 'address', 'tags', 'notes', 'favorite'];
const SORT_KEYS = { name: 'name', company: 'company', category: 'category', created: 'createdAt', updated: 'updatedAt' };

function normalizeTags(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[,;]/);
  const out = [];
  for (const p of parts) {
    const t = String(p).trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.join(',');
}

function digits(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

class CardStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.imagesDir = path.join(dataDir, 'images');
    this.dbFile = path.join(dataDir, 'cards.json');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    this.db = { nextId: 1, cards: [] };
    if (fs.existsSync(this.dbFile)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
        if (loaded && Array.isArray(loaded.cards)) this.db = loaded;
      } catch (err) {
        // Keep the damaged file so nothing is lost, then start fresh.
        fs.copyFileSync(this.dbFile, path.join(dataDir, `cards.damaged-${Date.now()}.json`));
      }
    }
  }

  save() {
    const tmp = this.dbFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    fs.renameSync(tmp, this.dbFile);
  }

  saveImage(buffer) {
    const name = crypto.randomUUID().replace(/-/g, '') + '.png';
    fs.writeFileSync(path.join(this.imagesDir, name), buffer);
    return name;
  }

  imagePath(name) {
    if (!name || name !== path.basename(name)) return null;
    const p = path.join(this.imagesDir, name);
    return fs.existsSync(p) ? p : null;
  }

  add(data, pngBuffer, rawText) {
    const now = new Date().toISOString();
    const card = { id: this.db.nextId++ };
    for (const f of FIELDS) card[f] = data[f] !== undefined ? data[f] : '';
    card.category = CATEGORIES.includes(card.category) ? card.category : 'Business';
    card.favorite = card.favorite ? 1 : 0;
    card.tags = normalizeTags(card.tags);
    card.imageName = pngBuffer ? this.saveImage(pngBuffer) : '';
    card.rawText = rawText || '';
    card.createdAt = card.updatedAt = now;
    this.db.cards.push(card);
    this.save();
    return card.id;
  }

  update(id, data) {
    const card = this.get(id);
    if (!card) return;
    for (const f of FIELDS) if (f in data) card[f] = data[f];
    if (!CATEGORIES.includes(card.category)) card.category = 'Business';
    card.favorite = card.favorite ? 1 : 0;
    card.tags = normalizeTags(card.tags);
    card.updatedAt = new Date().toISOString();
    this.save();
  }

  get(id) {
    return this.db.cards.find(c => c.id === Number(id)) || null;
  }

  remove(id) {
    const card = this.get(id);
    if (!card) return;
    if (card.imageName) {
      const p = this.imagePath(card.imageName);
      if (p) fs.unlinkSync(p);
    }
    this.db.cards = this.db.cards.filter(c => c.id !== card.id);
    this.save();
  }

  allTags() {
    const tags = new Set();
    for (const c of this.db.cards) for (const t of String(c.tags || '').split(',')) if (t) tags.add(t);
    return [...tags].sort();
  }

  list({ search = '', category = '', tag = '', favoritesOnly = false, sortKey = 'company', ascending = true } = {}) {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fields = ['name', 'title', 'company', 'email', 'phone', 'mobile', 'address', 'notes', 'tags', 'rawText'];
    let rows = this.db.cards.filter(c => {
      if (category && c.category !== category) return false;
      if (favoritesOnly && !c.favorite) return false;
      if (tag && !String(c.tags || '').split(',').includes(tag.toLowerCase())) return false;
      return words.every(w => fields.some(f => String(c[f] || '').toLowerCase().includes(w)));
    });
    const key = SORT_KEYS[sortKey] || 'company';
    rows.sort((a, b) => {
      const av = String(a[key] || '').toLowerCase(), bv = String(b[key] || '').toLowerCase();
      if (av < bv) return ascending ? -1 : 1;
      if (av > bv) return ascending ? 1 : -1;
      return a.id - b.id;
    });
    return rows;
  }

  findDuplicates(data, excludeId = null) {
    const email = String(data.email || '').trim().toLowerCase();
    const phones = new Set([digits(data.phone), digits(data.mobile)].filter(Boolean));
    const company = String(data.company || '').trim().toLowerCase().split(/\s+/)[0] || '';
    const name = String(data.name || '').trim().toLowerCase();
    const out = [];
    for (const c of this.db.cards) {
      if (excludeId !== null && c.id === Number(excludeId)) continue;
      const emailMatch = email && String(c.email || '').toLowerCase() === email;
      const phoneMatch = [digits(c.phone), digits(c.mobile)].some(d => d && phones.has(d));
      const nameMatch = name && company && String(c.name || '').toLowerCase() === name &&
        (String(c.company || '').toLowerCase().split(/\s+/)[0] || '') === company;
      if (emailMatch || phoneMatch || nameMatch) out.push(c);
    }
    return out;
  }
}

module.exports = { CardStore, CATEGORIES, normalizeTags };
