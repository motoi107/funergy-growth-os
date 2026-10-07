// Business dates are Hawaii dates (UTC-10, no daylight saving). Printed invoice
// dates are calendar dates with no time zone and are kept as YYYY-MM-DD strings.

const HST_OFFSET_MS = 10 * 3600 * 1000;

export function hstDate(instant) {
  const t = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  return new Date(t - HST_OFFSET_MS).toISOString().slice(0, 10);
}
export function hstStamp(instant) {
  const t = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  return new Date(t - HST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' HST';
}
// Start of a Hawaii calendar day as an instant.
export function hstDayStart(ymd) {
  if (!validYmd(ymd)) return null;
  return new Date(Date.parse(ymd + 'T00:00:00Z') + HST_OFFSET_MS).toISOString();
}

export function validYmd(s, { min = '2020-01-01', max = '2100-12-31' } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return false;
  return s >= min && s <= max;
}

// Reads a printed date. US invoices use M/D/Y; a two-digit year means 20YY.
// Ambiguous or impossible dates return null. ISO input is accepted as is.
export function parsePrintedDate(raw) {
  const s = String(raw ?? '').normalize('NFKC').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return ymd(y, +m[1], +m[2]); }
  m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  m = /^([A-Za-z]{3,4})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && months[m[1].toLowerCase()]) return ymd(+m[3], months[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[a-z]*[\s-](\d{4})$/.exec(s);
  if (m && months[m[2].toLowerCase()]) return ymd(+m[3], months[m[2].toLowerCase()], +m[1]);
  return null;
}
function ymd(y, mo, d) {
  const s = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return validYmd(s) ? s : null;
}

// A printed date and the AI's ISO reading must agree; otherwise the date is not determined.
// The printed text is required: an ISO value without the printed text cannot be checked.
export function determineDate(raw, iso) {
  if (!String(raw ?? '').trim()) return { value: null, reason: 'date_missing' };
  const fromRaw = parsePrintedDate(raw);
  if (!fromRaw) return { value: null, reason: 'date_unreadable' };
  const fromIso = validYmd(iso) ? iso : null;
  if (fromIso && fromRaw !== fromIso) return { value: null, reason: 'date_disagree' };
  return { value: fromRaw };
}

export const ymOf = d => (validYmd(d) ? d.slice(0, 7) : null);
