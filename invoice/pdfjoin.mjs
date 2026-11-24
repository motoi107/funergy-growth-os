// One invoice that came in as several files (pages) is sent to QuickBooks as ONE attachment (2026-11-23 の依頼 B-3):
// QuickBooks turns every attachment of a receipt mail into its own entry, so pages sent as separate attachments would become
// separate entries. The pages are put together in the order of the merged invoice (page 1 first).
//
// The PDF library is passed in (`PDFDocument` from pdf-lib), so this file has no import and loads the same in Node (tests) and
// Deno (the Edge Function gets it from npm:pdf-lib). The result is the same bytes for the same pages (no dates, no random ids),
// so a send that is tried again carries the same file.
//
// A photo (JPEG / PNG) becomes one page of Letter size (612 × 792 pt), scaled down to fit and centred. A PDF keeps its pages.
// A PDF that is encrypted or cannot be read stops the join (`pdf_join_failed`): nothing is sent, a person looks at it.

const LETTER = [612, 792];
const MARGIN = 18;

export class PdfJoinError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || null; }
}

function fit(w, h) {
  const maxW = LETTER[0] - MARGIN * 2, maxH = LETTER[1] - MARGIN * 2;
  const k = Math.min(1, maxW / w, maxH / h);
  const dw = w * k, dh = h * k;
  return { x: (LETTER[0] - dw) / 2, y: (LETTER[1] - dh) / 2, width: dw, height: dh };
}

// parts: [{ bytes: Uint8Array, mime: 'application/pdf' | 'image/jpeg' | 'image/png' }]
export async function joinParts(PDFDocument, parts) {
  if (!PDFDocument || typeof PDFDocument.create !== 'function') throw new PdfJoinError('pdf_join_unavailable');
  if (!Array.isArray(parts) || parts.length < 2) throw new PdfJoinError('pdf_join_failed', 'parts');
  const out = await PDFDocument.create({ updateMetadata: false });
  let pages = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const bytes = p && p.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new PdfJoinError('pdf_join_failed', 'part ' + (i + 1));
    try {
      if (p.mime === 'application/pdf') {
        // ignoreEncryption is NOT set: an encrypted PDF throws here and the join stops.
        const src = await PDFDocument.load(bytes, { updateMetadata: false });
        const copied = await out.copyPages(src, src.getPageIndices());
        for (const pg of copied) { out.addPage(pg); pages++; }
      } else if (p.mime === 'image/jpeg' || p.mime === 'image/png') {
        const img = p.mime === 'image/jpeg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        const page = out.addPage(LETTER);
        page.drawImage(img, fit(img.width, img.height));
        pages++;
      } else {
        throw new PdfJoinError('pdf_join_unsupported', p.mime || 'unknown');
      }
    } catch (e) {
      if (e instanceof PdfJoinError) throw e;
      throw new PdfJoinError('pdf_join_failed', 'part ' + (i + 1) + ': ' + String((e && e.message) || e).slice(0, 120));
    }
  }
  const bytes = await out.save({ useObjectStreams: false });
  return { bytes, pages };
}

// The name of the one attachment: the head invoice's file name without its extension and without a trailing page mark (_p1),
// ending in .pdf.
export function joinedName(headName) {
  const base = String(headName || 'invoice').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/_p\d+$/i, '');
  return (base || 'invoice') + '.pdf';
}
