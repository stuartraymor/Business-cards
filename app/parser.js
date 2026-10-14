// Turns card text (from Windows OCR or pasted text) into fields, with warnings.
// Port of the Python parser; the logic and rules match.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = ['Vendor', 'Reseller', 'Business', 'Other'];

  const TITLE_WORDS = new Set([
    'manager', 'engineer', 'director', 'president', 'owner', 'supervisor',
    'representative', 'rep', 'account', 'technician', 'coordinator', 'buyer',
    'sales', 'vice', 'vp', 'ceo', 'cfo', 'coo', 'cto', 'partner', 'consultant',
    'specialist', 'foreman', 'lead', 'chief', 'officer', 'analyst', 'estimator',
    'machinist', 'programmer', 'planner', 'superintendent', 'founder', 'principal',
    'purchasing', 'procurement', 'agent', 'administrator', 'assistant', 'operator',
    'executive', 'head', 'associate', 'accountant', 'controller', 'quality', 'operations',
    'estimating', 'contracts', 'dispatcher', 'scheduler', 'inspector',
    'designer', 'architect', 'writer', 'editor', 'treasurer', 'secretary', 'accounting',
  ]);

  const COMPANY_WORDS = new Set([
    'inc', 'inc.', 'llc', 'corp', 'corporation', 'co', 'co.', 'ltd', 'company',
    'group', 'industries', 'machine', 'machining', 'shop', 'supply', 'supplies',
    'tool', 'tooling', 'engineering', 'services', 'solutions', 'systems',
    'manufacturing', 'fabrication', 'publishing', 'books', 'technologies', 'fasteners',
    'fastener', 'plastics', 'metals', 'steel', 'products', 'partners', 'gear', 'bearing',
    'precision', 'electric', 'electronics', 'printing', 'press', 'media', 'mold', 'mould',
  ]);

  const STREET_WORDS = new Set([
    'st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive',
    'ln', 'lane', 'way', 'hwy', 'highway', 'pkwy', 'parkway', 'ct', 'court', 'suite',
    'ste', 'pl', 'place', 'unit',
  ]);

  const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com']);

  const PHONE_SRC = '(?:(?:\\+?1[\\s.\\-]?)?\\(?\\d{3}\\)?[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{4})(?:\\s*(?:x|ext\\.?|extension)\\s*\\d{1,6})?';
  const PHONE_RE = new RegExp(PHONE_SRC, 'i');
  const PHONE_RE_ALL = new RegExp(PHONE_SRC, 'gi');
  const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const EMAIL_FULL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  const WEB_RE = /(?:https?:\/\/|www\.)[^\s,;]+|\b[a-z0-9\-]+\.(?:com|net|org|biz|info|us|io|co)\b/gi;
  const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
  const PHONE_LABEL_RE = /^(?:tel|phone|ph|p|office|o|mobile|cell|c|fax|f|direct|d|e-?mail|web|website|www)[\s:.\-]/i;

  function newCard() {
    return {
      name: '', title: '', company: '', phone: '', mobile: '', fax: '', email: '',
      website: '', address: '', category: 'Business', notes: '',
      warnings: {}, lowConfidence: [],
    };
  }

  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

  function formatPhone(raw) {
    const extMatch = /(?:x|ext\.?|extension)\s*(\d{1,6})\s*$/i.exec(raw);
    const ext = extMatch ? extMatch[1] : '';
    const core = extMatch ? raw.slice(0, extMatch.index) : raw;
    let d = digitsOnly(core);
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    if (d.length !== 10) return raw.trim();
    const out = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return ext ? `${out} ext. ${ext}` : out;
  }

  function checkPhone(formatted) {
    const core = formatted.split(/\sext\./)[0];
    let d = digitsOnly(core);
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    if (d.length !== 10) return `Phone has ${d.length} digits; a US number should have 10.`;
    if (d[0] === '0' || d[0] === '1') return 'Area code starts with 0 or 1, which is not a valid US area code.';
    if (d[3] === '0' || d[3] === '1') return 'Exchange starts with 0 or 1, which is not valid for US numbers.';
    if (new Set(d).size === 1) return 'Phone number is a single repeated digit; it may be a placeholder.';
    return null;
  }

  const TLD_TYPOS = { corn: 'com', con: 'com', cmo: 'com', ocm: 'com', vom: 'com', nte: 'net', ogr: 'org' };

  function checkEmail(email, company) {
    if (!EMAIL_FULL_RE.test(email)) return 'Email address format looks invalid.';
    const domain = email.split('@')[1].toLowerCase();
    const tld = domain.split('.').pop();
    if (TLD_TYPOS[tld]) return `Email ends in .${tld}; did you mean .${TLD_TYPOS[tld]}?`;
    if (FREE_MAIL_DOMAINS.has(domain)) return `Personal email domain (${domain}); confirm this is the business contact.`;
    if (company) {
      const stem = company.toLowerCase().replace(/[^a-z0-9]/g, '');
      const domStem = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
      if (domStem && stem && !stem.includes(domStem.slice(0, 4)) && !domStem.includes(stem.slice(0, 4))) {
        return `Email domain '${domain}' does not seem to match the company name.`;
      }
    }
    return null;
  }

  function cleanLine(line) {
    let s = line.replace(/\s+/g, ' ');
    s = s.replace(/^[^A-Za-z0-9(+]+/, '');
    s = s.replace(/[^A-Za-z0-9).]+$/, '');
    return s.trim();
  }

  const BOILERPLATE_RE = /^(slogan|tagline|lorem|ipsum)\b|\b(slogan or tagline|lorem ipsum)\b/i;

  function isNoise(line) {
    if (BOILERPLATE_RE.test(line)) return true;
    return (line.match(/[A-Za-z0-9]/g) || []).length < 3;
  }

  function words(line) { return line.match(/[A-Za-z][A-Za-z.&'\-]*/g) || []; }

  function looksLikeName(line) {
    if (/\d/.test(line) || line.includes('@') || line.includes('/')) return false;
    if (/\b(and|&)\b/i.test(line)) return false;
    const w = words(line);
    if (w.length < 2 || w.length > 4) return false;
    if (w.some(x => { const k = x.toLowerCase().replace(/\.+$/, ''); return TITLE_WORDS.has(k) || COMPANY_WORDS.has(k) || STREET_WORDS.has(k); })) return false;
    return w.every(x => x.length <= 1 || (x[0] === x[0].toUpperCase() && x[0] !== x[0].toLowerCase()));
  }

  function looksLikeTitle(line) {
    return words(line).some(x => TITLE_WORDS.has(x.toLowerCase().replace(/\.+$/, '')));
  }

  function looksLikeCompany(line) {
    if (/\b(and|&)\b/i.test(line)) return true;
    return words(line).some(x => COMPANY_WORDS.has(x.toLowerCase()));
  }

  function looksLikeAddress(line) {
    if (/^\d+\s+[A-Za-z]/.test(line)) return true; // "1234 Frank Lloyd Wright"
    const hasZip = ZIP_RE.test(line);
    const hasStreet = words(line).some(x => STREET_WORDS.has(x.toLowerCase().replace(/\.+$/, ''))) && /\d/.test(line);
    return hasZip || hasStreet;
  }

  function parseCardText(text) {
    const card = newCard();
    const low = new Set();
    let lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(l => l && !isNoise(l));
    let remaining = lines.slice();

    const emails = String(text || '').match(EMAIL_RE);
    if (emails) card.email = emails[0].toLowerCase();
    const withoutEmails = String(text || '').replace(EMAIL_RE, ' ');
    const web = (withoutEmails.match(WEB_RE) || []).filter(w => !w.includes('@'));
    if (web.length) card.website = web[0].replace(/[.,]+$/, '');

    for (const line of lines) {
      for (const m of line.matchAll(PHONE_RE_ALL)) {
        const raw = m[0];
        const label = line.slice(0, m.index).trim().toLowerCase();
        const formatted = formatPhone(raw);
        if (label.includes('fax') || (label.endsWith('f') && label.length <= 2)) {
          card.fax = card.fax || formatted;
        } else if (label.includes('mobile') || label.includes('cell') || (label.endsWith('c') && label.length <= 2)) {
          card.mobile = card.mobile || formatted;
        } else {
          card.phone = card.phone || formatted;
        }
      }
    }
    if (!card.phone && card.mobile) { card.phone = card.mobile; card.mobile = ''; }

    for (const field of ['phone', 'mobile', 'fax']) {
      const value = card[field];
      if (value) {
        const issue = checkPhone(value);
        if (issue) { card.warnings[field] = issue; low.add(field); }
      }
    }
    if (card.email) {
      const issue = checkEmail(card.email, '');
      if (issue) { card.warnings.email = issue; low.add('email'); }
    }

    const addrLines = remaining.filter(looksLikeAddress);
    if (addrLines.length) {
      card.address = addrLines.join(', ');
      remaining = remaining.filter(l => !addrLines.includes(l));
    }

    const contactLines = remaining.filter(line => {
      let s = line.replace(EMAIL_RE, '').replace(WEB_RE, '').replace(PHONE_RE_ALL, '');
      s = s.replace(PHONE_LABEL_RE, '').replace(/^[ :.\-|,()]+|[ :.\-|,()]+$/g, '');
      return !s || !/[A-Za-z]/.test(s);
    });
    remaining = remaining.filter(l => !contactLines.includes(l));

    // Title before company: "Senior Sales Manager" must not be taken for a company.
    const titleLine = remaining.find(looksLikeTitle);
    if (titleLine) { card.title = titleLine; remaining = remaining.filter(l => l !== titleLine); }

    const companyLine = remaining.find(looksLikeCompany);
    if (companyLine) { card.company = companyLine; remaining = remaining.filter(l => l !== companyLine); }

    // Name: the candidate nearest above the title (names sit above job titles on most cards).
    const nameCandidates = remaining.filter(looksLikeName);
    let nameLine = nameCandidates[0];
    if (titleLine && nameCandidates.length > 1) {
      const titleIndex = lines.indexOf(titleLine);
      const above = nameCandidates.filter(l => lines.indexOf(l) < titleIndex);
      if (above.length) nameLine = above[above.length - 1];
    }
    if (nameLine) { card.name = nameLine; remaining = remaining.filter(l => l !== nameLine); }
    else { low.add('name'); card.warnings.name = 'No name found; please enter it.'; }

    if (!card.company && remaining.length) {
      card.company = remaining.shift();
      low.add('company');
      card.warnings.company = 'Company was guessed; please check it.';
    }
    if (!card.company) {
      card.warnings.company = 'No company found; please enter it.';
      low.add('company');
    }

    if (card.email && card.company) {
      const issue = checkEmail(card.email, card.company);
      if (issue) { card.warnings.email = issue; low.add('email'); }
    }

    if (!(card.phone || card.mobile || card.email)) {
      card.warnings.contact = 'No phone or email found; the card may be unreadable.';
    }

    card.notes = remaining.join('\n');
    card.lowConfidence = [...low];
    return card;
  }

  // How much a text reads like a business card. Higher is better. Used to choose between two orientations.
  function scoreText(text) {
    const t = String(text || '');
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    const real = (t.match(/[A-Za-z]{2,}/g) || []).length;
    const contacts = (t.match(EMAIL_RE) || []).length + (t.match(PHONE_RE_ALL) || []).length + (t.match(WEB_RE) || []).length;
    const ratio = t.length ? letters / t.length : 0;
    return contacts * 10 + real + ratio * 5;
  }

  return { CATEGORIES, parseCardText, formatPhone, checkPhone, checkEmail, newCard, scoreText };
});
