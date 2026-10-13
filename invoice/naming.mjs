// File names for posted originals (Moto 2026-10-12): 日付_業者名_invoice番号.ext, e.g. 2026-10-07_Marujuu-Produce_12345.pdf.
// Only checked values are used: the date the posting used, the vendor name from the vendor master, the invoice number
// as printed (corrected by a person if needed).
import { validYmd } from './dates.mjs';

const MAX_TOTAL = 120;

// Characters Drive and common desktop sync tools reject or treat specially.
export function safePart(text, max = 40) {
  let s = String(text ?? '').normalize('NFKC');
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  s = s.replace(/[\\/:*?"<>|#%{}~&]/g, '-');
  s = s.replace(/[\s_]+/g, '-');          // "_" separates fields
  s = s.replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  if (s.length > max) s = s.slice(0, max).replace(/[-.]+$/, '');
  return s;
}

// Invoice numbers keep leading zeros and letters; unsafe characters become "-".
export function safeNumber(no) {
  const s = String(no ?? '').normalize('NFKC').trim();
  if (!s) return '';
  return safePart(s, 32);
}

export function extensionFor(originalName, mimeType) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(originalName ?? ''));
  const byMime = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif' }[String(mimeType ?? '').toLowerCase()];
  if (m) {
    const e = m[1].toLowerCase();
    // Keep the original extension unless it contradicts the actual content type.
    const family = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', heic: 'image/heic', heif: 'image/heif' }[e];
    if (!byMime || !family || family === String(mimeType).toLowerCase()) return e;
  }
  return byMime || 'bin';
}

// The name a posted original gets: date, vendor, number. A credit memo's number starts with "CM-" (it is not a purchase
// invoice) unless the printed number already starts with CM; with no printed number the app's internal number is used
// ("INT-…"). version > 1: the file was overwritten in Drive with new content and the new version was posted ("_v2").
export function postedName({ invoiceDate, vendor, docType = 'invoice', invoiceNo, internalNo, ext, version }) {
  const v = safePart(vendor, 40), num = safeNumber(invoiceNo), internal = safePart(internalNo, 16);
  if (!v || !validYmd(invoiceDate) || !ext || (!num && !internal)) return null;
  let id = num || 'INT-' + internal;
  if (docType === 'credit_memo' && !/^CM[-0-9]/i.test(id)) id = 'CM-' + id;
  let base = `${invoiceDate}_${v}_${id}`;
  if (Number(version) > 1) base += '_v' + Math.floor(Number(version));
  const extPart = '.' + String(ext).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (extPart === '.') return null;
  if (base.length + extPart.length > MAX_TOTAL) base = base.slice(0, MAX_TOTAL - extPart.length);
  return base + extPart;
}

// Avoids a name clash in the destination folder without overwriting anything.
export function uniqueName(name, taken) {
  const set = new Set(taken || []);
  if (!set.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) { const n = `${stem}_${i}${ext}`; if (!set.has(n)) return n; }
  throw new Error('name_space_exhausted');
}

export function monthFolders(invoiceDate) {
  if (!validYmd(invoiceDate)) return null;
  return { year: invoiceDate.slice(0, 4), month: invoiceDate.slice(5, 7) };
}
export const FOLDER = { upload: '00_Upload', unreconciled: '未照合', reconciled: '照合済み' };
