// File names for organized originals: 業者名_YYYY-MM-DD_店舗名_INV-番号.ext
// Only verified values are used: the vendor name comes from the vendor master,
// the store label from configuration, the date from the determined invoice date.
import { validYmd } from './dates.mjs';

const DOC_PREFIX = { invoice: 'INV', credit_memo: 'CM', statement: 'STMT', receipt: 'RCPT' };
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

// suffix: e.g. "v2" for a corrected version, "p1" for page photos of one invoice.
export function organizedName({ vendor, invoiceDate, store, docType = 'invoice', invoiceNo, internalNo, ext, suffix }) {
  const v = safePart(vendor, 40), st = safePart(store, 24);
  if (!v || !st || !validYmd(invoiceDate) || !ext) return null;
  const prefix = DOC_PREFIX[docType] || 'DOC';
  const num = safeNumber(invoiceNo);
  const id = num ? `${prefix}-${num}` : `${prefix}-INT${safePart(internalNo, 16)}`;
  if (!num && !safePart(internalNo, 16)) return null;
  let base = `${v}_${invoiceDate}_${st}_${id}`;
  if (suffix) base += '_' + safePart(suffix, 12);
  const extPart = '.' + String(ext).toLowerCase().replace(/[^a-z0-9]/g, '');
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
