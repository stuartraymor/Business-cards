// CSV (for Excel) and vCard (for phone and Outlook contacts) export.
'use strict';

const CSV_COLUMNS = [
  ['Name', 'name'], ['Title', 'title'], ['Company', 'company'], ['Category', 'category'],
  ['Phone', 'phone'], ['Mobile', 'mobile'], ['Fax', 'fax'], ['Email', 'email'],
  ['Website', 'website'], ['Address', 'address'], ['Tags', 'tags'], ['Notes', 'notes'],
  ['Favorite', 'favorite'], ['Created', 'createdAt'], ['Updated', 'updatedAt'],
];

function csvCell(value) {
  const s = String(value ?? '');
  // Protect against spreadsheet formula injection: values starting with = + - @ are prefixed.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function toCsv(cards) {
  const lines = [CSV_COLUMNS.map(c => c[0]).join(',')];
  for (const card of cards) {
    lines.push(CSV_COLUMNS.map(([, key]) => {
      if (key === 'favorite') return card.favorite ? 'Yes' : '';
      return csvCell(card[key]);
    }).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads accents correctly
}

function vEscape(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function cardToVcard(card) {
  const name = String(card.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEscape(last)};${vEscape(first)};;;`, `FN:${vEscape(name)}`];
  if (card.company) lines.push(`ORG:${vEscape(card.company)}`);
  if (card.title) lines.push(`TITLE:${vEscape(card.title)}`);
  if (card.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEscape(card.phone)}`);
  if (card.mobile) lines.push(`TEL;TYPE=CELL:${vEscape(card.mobile)}`);
  if (card.fax) lines.push(`TEL;TYPE=FAX:${vEscape(card.fax)}`);
  if (card.email) lines.push(`EMAIL;TYPE=WORK:${vEscape(card.email)}`);
  if (card.website) lines.push(`URL:${vEscape(card.website)}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${vEscape(card.address)};;;;`);
  if (card.notes) lines.push(`NOTE:${vEscape(card.notes)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

function toVcards(cards) {
  return cards.map(cardToVcard).join('');
}

module.exports = { toCsv, toVcards, cardToVcard };
