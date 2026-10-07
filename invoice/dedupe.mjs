import { parseCents } from './decimal.mjs';

// Keys used to recognise the same invoice arriving more than once. A match on
// amount alone or on file name alone is never treated as a duplicate.

export async function sha256Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// "INV #000123" -> "000123"; keeps leading zeros and letters.
export function normInvoiceNo(no) {
  let s = String(no ?? '').normalize('NFKC').toUpperCase().trim();
  s = s.replace(/^(INVOICE|INV|NO|NUMBER|CREDIT MEMO|CM)\s*[#:.]?\s*/, '').replace(/^#\s*/, '');
  s = s.replace(/\s+/g, '');
  return s || null;
}

export function aliasKey(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() || null;
}
export function specKey(text) {
  return String(text ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, '') || '';
}
export function unitKey(text) {
  return String(text ?? '').normalize('NFKC').toUpperCase().replace(/[\s.]/g, '') || '';
}
export function codeKey(text) {
  const s = String(text ?? '').normalize('NFKC').trim().toUpperCase();
  return s || null;
}

// Canonical content of an invoice: same vendor, store, number, date, total and lines.
export async function contentSignature(h, lines) {
  const body = JSON.stringify([
    h.vendor_key || null, h.store_id || null, h.invoice_no_norm || null, h.invoice_date || null, h.total_cents ?? null,
    (lines || []).map(l => [codeKey(l.item_code), aliasKey(l.raw_name), l.qty ?? null, l.unit_price ?? null, l.amount_cents ?? null]),
  ]);
  return sha256Hex(new TextEncoder().encode(body));
}

// Classifies a staged document against what the database already holds.
//   existing: [{ id, status, store_id, vendor_key, invoice_no_norm, invoice_date, total_cents, content_sig, sha256 }]
export function classifyDuplicates(doc, existing, appRecords = []) {
  const out = { certain: null, sameNumberDifferent: [], candidates: [], app: [] };
  for (const e of existing || []) {
    if (!e || e.id === doc.id || e.status === 'rejected') continue;
    if (doc.sha256 && e.sha256 === doc.sha256) { out.certain = out.certain || { id: e.id, by: 'bytes' }; continue; }
    const sameNo = doc.invoice_no_norm && e.invoice_no_norm === doc.invoice_no_norm && e.vendor_key === doc.vendor_key && e.vendor_key;
    if (sameNo) {
      if (e.store_id === doc.store_id && e.content_sig && e.content_sig === doc.content_sig) out.certain = out.certain || { id: e.id, by: 'content' };
      else out.sameNumberDifferent.push(e.id);
      continue;
    }
    if (!doc.invoice_no_norm || !e.invoice_no_norm) {
      if (e.vendor_key && e.vendor_key === doc.vendor_key && e.store_id === doc.store_id
        && e.invoice_date && e.invoice_date === doc.invoice_date && e.total_cents === doc.total_cents) out.candidates.push(e.id);
    }
  }
  // Invoices registered through the existing app screen carry no invoice number,
  // so only a candidate can be raised: same store, vendor, document date and total.
  for (const a of appRecords || []) {
    if (!a || a._deleted) continue;
    if (a.storeId !== doc.store_id) continue;
    if (String(a.vendor || '').trim().toLowerCase() !== String(doc.vendor_name || '').trim().toLowerCase()) continue;
    const d = String(a.docDate || '').replace(/\//g, '-');
    if (!d || d !== doc.invoice_date) continue;
    // App totals are stored as JS numbers; they are only used to raise a candidate for review.
    const t = Number(a.total);
    if (!Number.isFinite(t) || parseCents(t.toFixed(2)) !== doc.total_cents) continue;
    out.app.push(String(a.id));
  }
  return out;
}
