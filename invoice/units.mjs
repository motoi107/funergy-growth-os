// Explicit unit definitions. Nothing is converted by guessing: mass, volume and
// count units only convert within their own family, and a case/bag/bottle count
// is only known from a verified item mapping.
import { parseQty, SCALE, fromScaled, trimDecimal, ratio } from './decimal.mjs';

const S = 10n ** BigInt(SCALE);
// Factors to the family base unit, scaled by 10^10 so that every definition below is exact.
const F = 10n ** 10n;
export const UNIT_DEFS = {
  g:   { family: 'mass',   base: 'g',  factor: 1n * F },
  kg:  { family: 'mass',   base: 'g',  factor: 1000n * F },
  lb:  { family: 'mass',   base: 'g',  factor: 4535923700000n },        // 453.59237 g
  oz:  { family: 'mass',   base: 'g',  factor: 283495231250n },         // 28.349523125 g
  ml:  { family: 'volume', base: 'ml', factor: 1n * F },
  l:   { family: 'volume', base: 'ml', factor: 1000n * F },
  gal: { family: 'volume', base: 'ml', factor: 37854117840000n },       // US gallon 3785.411784 ml
  qt:  { family: 'volume', base: 'ml', factor: 9463529460000n },        // US quart
  floz:{ family: 'volume', base: 'ml', factor: 295735295625n },        // 29.5735295625 ml
  ea:  { family: 'count',  base: 'ea', factor: 1n * F },
};
const ALIASES = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g', 'ｇ': 'g', 'グラム': 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', 'キロ': 'kg',
  lb: 'lb', lbs: 'lb', '#': 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz',
  ml: 'ml', cc: 'ml', l: 'l', lt: 'l', ltr: 'l', liter: 'l', litre: 'l',
  gal: 'gal', gallon: 'gal', qt: 'qt', quart: 'qt', floz: 'floz', 'fl oz': 'floz', 'fl.oz': 'floz',
  ea: 'ea', each: 'ea', pc: 'ea', pcs: 'ea', piece: 'ea', ct: 'ea', count: 'ea', '個': 'ea', '本': 'ea',
};
export function canonUnit(u) {
  const k = String(u ?? '').normalize('NFKC').trim().toLowerCase().replace(/\.$/, '');
  return ALIASES[k] || null;
}

// Converts a scaled quantity (10^-6) between units of the same family.
export function convertQty(qty, from, to) {
  const a = UNIT_DEFS[canonUnit(from)], b = UNIT_DEFS[canonUnit(to)];
  if (!a || !b || a.family !== b.family) return null;
  const n = qty * a.factor, d = b.factor;
  if (n % d !== 0n) {
    // keep 10^-6 precision, rounding half away from zero
    const q = (n * 2n + d) / (2n * d);
    return q;
  }
  return n / d;
}

// Reads common pack notations. The result is a suggestion for a human to verify.
//   "12/500G", "12 x 500 g", "500g×12", "4/10LB", "6/1.8L", "50 LB", "1 GAL"
export function parsePackSpec(text) {
  const s = String(text ?? '').normalize('NFKC').replace(/×/g, 'x').toLowerCase();
  const unitRe = '(kg|kgs|g|gr|lbs|lb|#|oz|ml|cc|ltr|lt|l|gal|qt|fl ?oz)';
  let m = new RegExp(`(\\d+)\\s*[/x*]\\s*(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`).exec(s);
  if (m) return pack(m[1], m[2], m[3], text);
  m = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\s*[x*]\\s*(\\d+)\\b`).exec(s);
  if (m) return pack(m[3], m[1], m[2], text);
  m = new RegExp(`(?:^|[^\\d/.])(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`).exec(s);
  if (m) return pack('1', m[1], m[2], text);
  return null;
}
function pack(count, size, unit, raw) {
  const u = canonUnit(unit.replace(' ', ''));
  const c = parseQty(count), z = parseQty(size);
  if (!u || c === null || z === null || c <= 0n || z <= 0n) return null;
  const def = UNIT_DEFS[u];
  const totalInUnit = c * z / S;
  const base = convertQty(totalInUnit, u, def.base);
  return {
    raw: String(raw ?? ''), count: c, size: z, unit: u, family: def.family, baseUnit: def.base,
    basePerPurchase: base,
    label: `${trimDecimal(fromScaled(c))} × ${trimDecimal(fromScaled(z))}${u} = ${trimDecimal(fromScaled(base))}${def.base}`,
  };
}

// Price per counting unit and per base unit, kept as exact ratios.
//   unitMicros: price of one purchase unit (10^-6 USD)
//   countPerPurchase / basePerPurchase: scaled 10^-6
export function unitPrices(unitMicros, conv) {
  const out = {};
  if (conv && conv.countPerPurchase && conv.countPerPurchase > 0n) {
    out.perCount = ratio(unitMicros * S, conv.countPerPurchase);   // micros per count unit
  }
  if (conv && conv.basePerPurchase && conv.basePerPurchase > 0n) {
    out.perBase = ratio(unitMicros * S, conv.basePerPurchase);     // micros per base unit
  }
  return out;
}
