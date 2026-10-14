// Page logic: dashboard, editor, capture queue, and actions. Talks to main.js through window.cards.
'use strict';

const $ = id => document.getElementById(id);
const FIELD_KEYS = ['name', 'title', 'company', 'phone', 'mobile', 'fax', 'email', 'website', 'address', 'tags'];
const state = {
  rows: [],
  selectedId: null,          // saved card being viewed, or null
  pendingImage: null,        // cropped card PNG (data URL) for a card not yet saved
  pendingRaw: '',            // OCR text kept with a new card
  queue: [],                 // captures waiting to be reviewed
  sortAscending: true,
  busy: false,
};

function setStatus(text) { $('status').textContent = text || ''; }
// Header sort arrows are updated in refreshList; the sort <select> drives the same state.

function showBanner(text, extra = []) {
  const lines = [text, ...extra].filter(Boolean);
  $('banner').textContent = lines.join('\n');
  $('banner').classList.toggle('show', lines.length > 0);
}

function escapeText(s) { return String(s ?? ''); }

// ---------- list ----------
async function refreshList() {
  const opts = {
    search: $('search').value,
    category: $('category').value,
    tag: $('tag').value,
    favoritesOnly: $('favOnly').checked,
    sortKey: $('sort').value,
    ascending: state.sortAscending,
  };
  state.rows = await window.cards.list(opts);
  const total = (await window.cards.list({})).length;
  const tbody = $('rows');
  tbody.textContent = '';

  if (!state.rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    const td = document.createElement('td');
    td.colSpan = 7;
    const filtered = total > 0 && (opts.search || opts.category || opts.tag || opts.favoritesOnly);
    td.textContent = filtered
      ? 'No cards match these filters. Clear the search or change the filters to see more.'
      : 'No cards yet. Add a card photo, paste a screenshot, or type a card in with New card.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  for (const c of state.rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    tr.tabIndex = 0;
    tr.setAttribute('role', 'row');
    if (c.id === state.selectedId) tr.classList.add('selected');
    const cells = [c.name, c.title, c.company, c.category, c.phone || c.mobile, c.email, (c.updatedAt || '').slice(0, 10)];
    cells.forEach((value, i) => {
      const td = document.createElement('td');
      if (i === 0) td.classList.add('primary-cell');
      if (i === 0 && c.favorite) {
        const star = document.createElement('span');
        star.className = 'star';
        star.setAttribute('aria-label', 'Favorite');
        star.textContent = '★';
        td.appendChild(star);
      }
      td.appendChild(document.createTextNode(escapeText(value)));
      td.title = escapeText(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  $('countText').textContent = total ? `${state.rows.length} of ${total} cards` : '';
  document.querySelectorAll('thead th[data-key]').forEach(th => {
    const active = th.dataset.key === opts.sortKey;
    th.classList.toggle('sorted', active);
    th.classList.toggle('desc', active && !opts.ascending);
  });

  const tags = await window.cards.tags();
  const current = $('tag').value;
  $('tag').textContent = '';
  $('tag').appendChild(new Option('All', ''));
  for (const t of tags) $('tag').appendChild(new Option(t, t));
  $('tag').value = tags.includes(current) ? current : '';
}

function selectRowInTable(id) {
  for (const tr of $('rows').children) tr.classList.toggle('selected', Number(tr.dataset.id) === id);
}

// ---------- editor ----------
function clearNotes() {
  document.querySelectorAll('.note').forEach(n => { n.textContent = ''; });
  FIELD_KEYS.forEach(k => { const el = $('f_' + k); if (el) el.classList.remove('low'); });
  $('f_category').classList.remove('low');
  $('f_notes').classList.remove('low');
}

function setNote(key, text) {
  const note = document.querySelector(`.note[data-note="${key}"]`);
  if (note) note.textContent = text;
  const el = $('f_' + key);
  if (el) el.classList.toggle('low', !!text);
}

function fillForm(card, lowConfidence = []) {
  for (const k of FIELD_KEYS) $('f_' + k).value = escapeText(card[k]);
  $('f_category').value = card.category || 'Business';
  $('f_notes').value = escapeText(card.notes);
  $('f_fav').checked = !!card.favorite;
  clearNotes();
  for (const k of lowConfidence) {
    const el = $('f_' + k);
    if (el) el.classList.add('low');
  }
  $('f_notes').classList.toggle('low', false);
}

function formData() {
  const data = {};
  for (const k of FIELD_KEYS) data[k] = $('f_' + k).value.trim();
  data.category = $('f_category').value;
  data.notes = $('f_notes').value.trim();
  data.favorite = $('f_fav').checked ? 1 : 0;
  return data;
}

function setThumb(dataUrl) {
  const thumb = $('thumb');
  thumb.textContent = '';
  if (dataUrl) {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Business card';
    thumb.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.textContent = 'No card image';
    thumb.appendChild(span);
  }
  $('btnViewImg').disabled = !dataUrl;
  thumb.dataset.src = dataUrl || '';
}

function updateEditorButtons() {
  const saved = state.selectedId !== null;
  $('btnDelete').disabled = !saved;
  $('btnDiscard').disabled = saved;
}

async function showCard(id) {
  const res = await window.cards.get(id);
  if (!res) return;
  state.selectedId = id;
  state.pendingImage = null;
  state.pendingRaw = '';
  fillForm(res.card);
  setThumb(res.imageDataUrl);
  showBanner(res.imageDataUrl ? '' : 'This card has no saved image.');
  selectRowInTable(id);
  updateEditorButtons();
  setStatus(`Viewing ${res.card.name || res.card.company || 'card'}.`);
}

function newBlankCard() {
  state.selectedId = null;
  state.pendingImage = null;
  state.pendingRaw = '';
  fillForm({ category: 'Business' });
  setThumb(null);
  showBanner('');
  selectRowInTable(null);
  updateEditorButtons();
}

// Show a parsed capture in the editor so the user can check it before saving.
function showCapture(parsed, { pngDataUrl, rawText, label, messages = [] }) {
  state.selectedId = null;
  state.pendingImage = pngDataUrl || null;
  state.pendingRaw = rawText || '';
  fillForm({ ...parsed, category: parsed.category || 'Business' }, parsed.lowConfidence);
  for (const [key, msg] of Object.entries(parsed.warnings || {})) {
    if (document.querySelector(`.note[data-note="${key}"]`)) setNote(key, msg);
  }
  setThumb(pngDataUrl || null);
  const bannerExtra = Object.entries(parsed.warnings || {})
    .filter(([k]) => !document.querySelector(`.note[data-note="${k}"]`))
    .map(([, m]) => m);
  showBanner(`Review the details from ${label}. Yellow fields need a check.`, [...messages, ...bannerExtra]);
  selectRowInTable(null);
  updateEditorButtons();
  setStatus(state.queue.length ? `${state.queue.length} more card(s) waiting after this one.` : 'Review the card, then click Save card.');
}

// ---------- phone and email checks while typing ----------
function validateField(key) {
  const el = $('f_' + key);
  const value = el.value.trim();
  setNote(key, '');
  if (!value) return;
  if (['phone', 'mobile', 'fax'].includes(key)) {
    el.value = CardParser.formatPhone(value);
    const issue = CardParser.checkPhone(el.value);
    if (issue) setNote(key, issue);
  } else if (key === 'email') {
    const issue = CardParser.checkEmail(value, $('f_company').value.trim());
    if (issue) setNote(key, issue);
  }
}
['phone', 'mobile', 'fax', 'email'].forEach(k => $('f_' + k).addEventListener('change', () => validateField(k)));

// ---------- capture ----------
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not an image this app can read.'));
    img.src = dataUrl;
  });
}

function hasContact(text) {
  return /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text) || /\d{3}[\s.)\-]+\d{3}[\s.\-]+\d{4}/.test(text);
}

function rotate180(canvas) {
  const flipped = document.createElement('canvas');
  flipped.width = canvas.width;
  flipped.height = canvas.height;
  const ctx = flipped.getContext('2d');
  ctx.translate(canvas.width, canvas.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(canvas, 0, 0);
  return flipped.toDataURL('image/png');
}

// Crop the card from a photo, read its text with Windows OCR, and parse the fields.
async function captureImage(dataUrl, label) {
  setStatus(`Reading ${label}...`);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const crop = CardImaging.cropCard({ width: pixels.width, height: pixels.height, data: pixels.data });

  const out = document.createElement('canvas');
  out.width = crop.image.width;
  out.height = crop.image.height;
  out.getContext('2d').putImageData(new ImageData(crop.image.data, crop.image.width, crop.image.height), 0, 0);
  let pngDataUrl = out.toDataURL('image/png');

  // The corner order can leave the card upside down. If the upright read finds no
  // email or phone, read the card turned 180 degrees and keep whichever reads better.
  const messages = [crop.message];
  let text = '';
  try {
    text = await window.cards.ocr(pngDataUrl);
    if (!hasContact(text)) {
      const flipped = rotate180(out);
      const flippedText = await window.cards.ocr(flipped);
      if (CardParser.scoreText(flippedText) > CardParser.scoreText(text)) {
        text = flippedText;
        pngDataUrl = flipped;
        messages.push('The card was turned around; it has been turned upright.');
      }
    }
  } catch (err) {
    messages.push(err.message);
  }
  const parsed = CardParser.parseCardText(text);
  if (!crop.detected) parsed.warnings.image = 'Card outline not found; the crop may include background.';
  showCapture(parsed, { pngDataUrl, rawText: text, label, messages });
}

function captureText(text, label = 'pasted text') {
  const parsed = CardParser.parseCardText(text);
  showCapture(parsed, { pngDataUrl: null, rawText: text, label, messages: ['Fields read from pasted text.'] });
}

// Process files one at a time so the editor stays readable.
async function enqueueFiles(files) {
  const list = [...files];
  for (const file of list) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    state.queue.push({ kind: 'image', dataUrl, label: file.name });
  }
  await nextFromQueue();
}

async function nextFromQueue() {
  if (state.busy) return;
  const item = state.queue.shift();
  if (!item) return;
  state.busy = true;
  try {
    if (item.kind === 'image') await captureImage(item.dataUrl, item.label);
    else captureText(item.text, item.label);
  } catch (err) {
    await window.cards.info('Could not read that card', `${err.message}\n\nYou can still type the details in by hand.`);
    newBlankCard();
    setStatus('Could not read that card.');
  } finally {
    state.busy = false;
  }
}

async function pasteFromClipboard() {
  const clip = await window.cards.readClipboard();
  if (!clip) { setStatus('Nothing to paste. Copy a screenshot or some card text first.'); return; }
  if (clip.type === 'image') {
    state.queue.push({ kind: 'image', dataUrl: clip.dataUrl, label: 'clipboard image' });
  } else {
    state.queue.push({ kind: 'text', text: clip.text, label: 'pasted text' });
  }
  await nextFromQueue();
}

// ---------- save, delete, discard ----------
async function saveCard() {
  const data = formData();
  if (!data.name && !data.company) {
    await window.cards.info('Nothing to save', 'Please enter at least a name or a company.');
    return;
  }
  const dupes = await window.cards.duplicates(data, state.selectedId);
  if (dupes.length) {
    const names = dupes.slice(0, 5).map(d => `- ${d.name || '(no name)'} at ${d.company || '(no company)'}`).join('\n');
    const ok = await window.cards.confirm('Possible duplicate', `This looks like a card already saved:\n${names}\n\nSave it anyway?`);
    if (!ok) return;
  }
  const id = await window.cards.save({
    id: state.selectedId,
    data,
    pngDataUrl: state.selectedId ? null : state.pendingImage,
    rawText: state.pendingRaw,
  });
  setStatus(state.selectedId ? 'Changes saved.' : 'Card saved.');
  state.pendingImage = null;
  state.pendingRaw = '';
  await refreshList();
  if (state.queue.length) { await nextFromQueue(); return; }
  await showCard(id);
}

async function deleteCard() {
  if (state.selectedId === null) return;
  const name = $('f_name').value || $('f_company').value || 'this card';
  const ok = await window.cards.confirm('Delete card', `Delete ${name}?\nThe saved image will be deleted too. This can't be undone.`);
  if (!ok) return;
  await window.cards.remove(state.selectedId);
  newBlankCard();
  await refreshList();
  setStatus('Card deleted.');
}

async function discardCapture() {
  state.pendingImage = null;
  state.pendingRaw = '';
  if (state.queue.length) { await nextFromQueue(); return; }
  newBlankCard();
  setStatus('Discarded.');
}

// ---------- events ----------
$('search').addEventListener('input', () => refreshList());
['category', 'tag', 'sort'].forEach(id => $(id).addEventListener('change', () => refreshList()));
$('favOnly').addEventListener('change', () => refreshList());
$('btnDir').addEventListener('click', () => {
  state.sortAscending = !state.sortAscending;
  $('btnDir').textContent = state.sortAscending ? 'A to Z' : 'Z to A';
  refreshList();
});
document.querySelectorAll('th[data-key]').forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.key;
  if ($('sort').value === key) {
    state.sortAscending = !state.sortAscending;
    $('btnDir').textContent = state.sortAscending ? 'A to Z' : 'Z to A';
  } else {
    $('sort').value = key;
  }
  refreshList();
}));

$('rows').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (tr) showCard(Number(tr.dataset.id));
});
$('rows').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tr = e.target.closest('tr[data-id]');
  if (tr) { e.preventDefault(); showCard(Number(tr.dataset.id)); }
});
$('rows').addEventListener('dblclick', e => {
  const tr = e.target.closest('tr');
  if (tr) { showCard(Number(tr.dataset.id)).then(() => openViewer()); }
});

function openViewer() {
  const src = $('thumb').dataset.src;
  if (!src) return;
  $('viewerImg').src = src;
  $('viewer').showModal();
}
$('thumb').addEventListener('click', openViewer);
$('btnViewImg').addEventListener('click', openViewer);
$('viewerClose').addEventListener('click', () => $('viewer').close());

$('form').addEventListener('submit', e => { e.preventDefault(); saveCard(); });
$('btnDelete').addEventListener('click', deleteCard);
$('btnDiscard').addEventListener('click', discardCapture);
$('btnNew').addEventListener('click', () => newBlankCard());

$('btnFile').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async e => {
  const files = e.target.files;
  await enqueueFiles(files);
  e.target.value = '';
});
$('btnPaste').addEventListener('click', () => pasteFromClipboard());
$('btnText').addEventListener('click', () => { $('pasteText').value = ''; $('pasteDlg').showModal(); });
$('pasteDlg').addEventListener('close', () => {
  if ($('pasteDlg').returnValue !== 'ok') return;
  const text = $('pasteText').value.trim();
  if (!text) return;
  state.queue.push({ kind: 'text', text, label: 'pasted text' });
  nextFromQueue();
});

$('btnCsv').addEventListener('click', async () => {
  const r = await window.cards.exportCards('csv', state.rows);
  if (r.saved) setStatus(`Exported ${r.count} cards to Excel.`);
});
$('btnVcf').addEventListener('click', async () => {
  const r = await window.cards.exportCards('vcf', state.rows);
  if (r.saved) setStatus(`Exported ${r.count} contacts.`);
});
$('btnData').addEventListener('click', () => window.cards.openDataFolder());

// Drag and drop photos onto the window.
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const images = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (images.length) await enqueueFiles(images);
});

// Keyboard shortcuts.
window.addEventListener('keydown', e => {
  if (!e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'o' && !e.shiftKey) { e.preventDefault(); $('fileInput').click(); }
  else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newBlankCard(); }
  else if (k === 'v' && e.shiftKey) { e.preventDefault(); pasteFromClipboard(); }
  else if (k === 's' && !e.shiftKey) { e.preventDefault(); saveCard(); }
});

// ---------- start ----------
(async function start() {
  const info = await window.cards.appInfo();
  document.title = `${info.name} ${info.version}`;
  updateEditorButtons();
  await refreshList();
  newBlankCard();
  setStatus(`Ready. Your cards are stored in ${info.dataDir}`);
})();
