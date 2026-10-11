// Exact decimal helpers for invoice amounts. Money is held as integer cents;
// prices and quantities as BigInt values scaled by 10^6. No floating point is
// used for any comparison that decides whether an invoice is accepted.

export const SCALE = 6;
const TEN = 10n;
const S = TEN ** BigInt(SCALE);

function clean(text) {
  return String(text ?? '').normalize('NFKC').replace(/[\s,$€¥＄]/g, '').replace(/USD/i, '');
}

// Parses a printed decimal into a BigInt scaled by 10^scale.
// Accepts "1,234.50", "(12.34)", "-12.34", "12.34-", "12.34CR".
// Returns null when the text is not a plain decimal or needs more digits than allowed.
export function parseScaled(text, scale = SCALE) {
  if (typeof text === 'number') {
    if (!Number.isFinite(text)) return null;
    text = String(text);
    if (/e/i.test(text)) return null;
  }
  let s = clean(text);
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
  if (/CR$/i.test(s)) { neg = !neg; s = s.slice(0, -2); }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  if (f.length > scale) return null;
  const v = BigInt((i || '0') + f.padEnd(scale, '0'));
  return neg ? -v : v;
}

// Money as integer cents (Number). Null when unreadable or when the text has
// more than two decimals (that is a unit price, not an amount).
export function parseCents(text) {
  const v = parseScaled(text, 2);
  if (v === null) return null;
  if (v > 9007199254740991n || v < -9007199254740991n) return null;
  return Number(v);
}

export const parseMicros = text => parseScaled(text, 6);   // prices: 10^-6 USD
export const parseQty = text => parseScaled(text, 6);      // quantities: 10^-6 units

export function fromScaled(v, scale = SCALE) {
  const neg = v < 0n; let a = neg ? -v : v;
  const d = TEN ** BigInt(scale);
  const i = a / d, f = a % d;
  let out = i.toString();
  if (scale > 0) out += '.' + f.toString().padStart(scale, '0');
  return (neg ? '-' : '') + out;
}

// A decimal string with trailing zeros removed (keeps at least two decimals when asked).
export function trimDecimal(str, minDecimals = 0) {
  if (!str.includes('.')) return minDecimals ? str + '.' + '0'.repeat(minDecimals) : str;
  let [i, f] = str.split('.');
  f = f.replace(/0+$/, '');
  if (f.length < minDecimals) f = f.padEnd(minDecimals, '0');
  return f ? i + '.' + f : i;
}

export const centsToString = c => fromScaled(BigInt(c), 2);

// Division rounded half away from zero.
export function divRound(n, d) {
  if (d === 0n) throw new RangeError('division by zero');
  const neg = (n < 0n) !== (d < 0n);
  const a = n < 0n ? -n : n, b = d < 0n ? -d : d;
  const q = (a * 2n + b) / (2n * b);
  return neg ? -q : q;
}

// A rational number num/den kept exact for price-per-unit comparisons.
export function ratio(num, den) {
  if (den === 0n) throw new RangeError('zero denominator');
  if (den < 0n) { num = -num; den = -den; }
  return { num, den };
}
export function ratioToDecimal(r, decimals = 6) {
  const v = divRound(r.num * TEN ** BigInt(decimals), r.den);
  return fromScaled(v, decimals);
}
export function ratioCmp(a, b) {
  const l = a.num * b.den, r = b.num * a.den;
  return l === r ? 0 : (l > r ? 1 : -1);
}
// True when |new - old| / |old| >= pct / 100. Exact; old must be non-zero.
export function changedAtLeast(oldR, newR, pct) {
  const p = parseScaled(String(pct), 4);
  if (p === null) throw new TypeError('bad threshold');
  if (oldR.num === 0n) return true;
  const diff = newR.num * oldR.den - oldR.num * newR.den;           // (new-old) * den_old * den_new
  const absDiff = diff < 0n ? -diff : diff;
  const base = (oldR.num < 0n ? -oldR.num : oldR.num) * newR.den;   // |old| * den_old * den_new
  return absDiff * 1000000n >= base * p;                              // p is pct * 10^4
}
// Signed change in percent with one decimal, for display only.
export function changePercent(oldR, newR) {
  if (oldR.num === 0n) return null;
  const diff = newR.num * oldR.den - oldR.num * newR.den;
  const base = oldR.num * newR.den;
  return fromScaled(divRound(diff * 1000n, base), 1);
}

// qty (10^-6) × unit price (10^-6 USD) compared with a printed amount in cents.
// Returns the difference in 10^-12 USD; callers compare with a tolerance.
export function lineMathDiff(qty, unitMicros, amountCents) {
  return qty * unitMicros - BigInt(amountCents) * 10000000000n;
}
export const HALF_CENT_PICO = 5000000000n;     // 0.5 cent in 10^-12 USD
export const CENT_PICO = 10000000000n;
