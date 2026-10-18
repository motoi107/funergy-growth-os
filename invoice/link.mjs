// 紐づけ 段階 1（Moto 2026-10-18・UI案55）: Drive 取込の invoice の品目を、今の食材マスター（棚卸表の品目）のコードに結ぶ。
// What the function invoice-intake needs for it, apart from the database:
//   itemKey / groupItems : the lines of the invoices as items, keyed the way the intake finds a link for a line (rules.mjs findMap):
//                          the vendor's item code, or else the printed name with its pack. An item's link is the vendor-wide link of
//                          that key (one; none; several = accounting tidies the mapping table).
//   relink              : what a line taken in becomes when the links change. The same as the intake's own mapping step (rules.mjs
//                          evaluate), without the price comparison (no_price_ref / price_jump are left out: for reference only).
// Nothing here reads the current master (the screen proposes; a person decides) or changes an amount.
import { parseMicros, parseQty, ratioToDecimal } from './decimal.mjs';
import { parsePackSpec, unitPrices, UNIT_DEFS } from './units.mjs';
import { aliasKey, unitKey, codeKey } from './dedupe.mjs';
import { findMap } from './rules.mjs';

// Line reasons about the link (rules.mjs evaluate's mapping step). Only these change when a link changes.
export const MAP_REASONS = ['unmapped', 'map_ambiguous', 'map_unverified', 'mode_review_item', 'spec_changed', 'unit_mismatch', 'unit_unverified',
  'no_price_ref', 'price_jump'];
const MAPPING = new Set(MAP_REASONS);

// The key of a line's item: the vendor's item code, or else the printed name with its pack. Null when it has neither.
export function itemKey(line) {
  const code = codeKey(line.item_code);
  if (code) return { vendor_item_code: code, alias_key: null, spec_key: '' };
  const alias = aliasKey(line.raw_name);
  return alias ? { vendor_item_code: null, alias_key: alias, spec_key: line.spec_key || '' } : null;
}
export const keyId = (vendorKey, k) => vendorKey + (k.vendor_item_code ? '|c:' + k.vendor_item_code : '|a:' + k.alias_key + '|' + k.spec_key);

// The vendor-wide links of an item, in use (a link taken back is not one): as findMap looks a line of the item up.
export function linksOf(maps, vendorKey, k) {
  return (maps || []).filter(m => !m.retired_at && m.vendor_key === vendorKey && !m.store_id
    && (k.vendor_item_code ? codeKey(m.vendor_item_code) === k.vendor_item_code : (m.alias_key === k.alias_key && (m.spec_key || '') === k.spec_key)));
}

// The vendor an invoice's vendor ended at (業者の統合), or the key itself.
function finalKey(vendors, key) {
  let v = (vendors || []).find(x => x.vendor_key === key);
  for (let i = 0; v && v.merged_into && i < 20; i++) v = (vendors || []).find(x => x.vendor_key === v.merged_into) || null;
  return v ? v.vendor_key : key;
}

const top = (counts, n) => Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
const later = (a, b) => (!b || (a && a > b));

// lines: invoice_link_lines rows. maps: every row of the mapping table (in use and taken back). marks: the items' marks.
export function groupItems(lines, { vendors = [], maps = [], marks = [] } = {}) {
  const groups = new Map();
  for (const l of lines || []) {
    const k = itemKey(l);
    if (!k) continue;
    const vk = finalKey(vendors, l.vendor_key);
    const id = keyId(vk, k);
    let g = groups.get(id);
    if (!g) {
      g = { id, vendor_key: vk, ...k, names: {}, specs: {}, units: {}, n: 0, docs: new Set(), stores: new Set(), posted: 0, review: 0,
        first: null, last: null, last_price: null, min_price: null, max_price: null, mapped: {}, sample: { raw_name: l.raw_name, spec: l.spec || null } };
      groups.set(id, g);
    }
    g.n++;
    g.names[l.raw_name || ''] = (g.names[l.raw_name || ''] || 0) + 1;
    if (l.spec) g.specs[l.spec] = (g.specs[l.spec] || 0) + 1;
    if (l.purchase_unit) g.units[l.purchase_unit] = (g.units[l.purchase_unit] || 0) + 1;
    g.docs.add(l.doc_id); g.stores.add(l.store_id);
    if (l.status === 'posted') g.posted++; else g.review++;
    if (l.day && (!g.first || l.day < g.first)) g.first = l.day;
    if (l.day && later(l.day, g.last)) g.last = l.day;
    if (l.unit_price != null && l.unit_price !== '') {
      const p = parseMicros(String(l.unit_price));
      if (p !== null) {
        if (!g.last_price || later(l.day, g.last_price.day)) g.last_price = { unit_price: String(l.unit_price), unit: l.purchase_unit || null, day: l.day || null, store_id: l.store_id };
        if (g.min_price === null || p < g.min_price.v) g.min_price = { v: p, s: String(l.unit_price) };
        if (g.max_price === null || p > g.max_price.v) g.max_price = { v: p, s: String(l.unit_price) };
      }
    }
    const mk = l.map_id || '';
    g.mapped[mk] = (g.mapped[mk] || 0) + 1;
  }
  const markOf = new Map((marks || []).map(m => [keyId(m.vendor_key, { vendor_item_code: m.vendor_item_code ? codeKey(m.vendor_item_code) : null,
    alias_key: m.vendor_item_code ? null : m.alias_key, spec_key: m.vendor_item_code ? '' : (m.spec_key || '') }), m]));
  const out = [];
  for (const g of groups.values()) {
    const k = { vendor_item_code: g.vendor_item_code, alias_key: g.alias_key, spec_key: g.spec_key };
    const links = linksOf(maps, g.vendor_key, k);
    const link = links.length === 1 ? links[0] : null;
    const retired = (maps || []).filter(m => m.retired_at && m.vendor_key === g.vendor_key && !m.store_id
      && (k.vendor_item_code ? codeKey(m.vendor_item_code) === k.vendor_item_code : (m.alias_key === k.alias_key && (m.spec_key || '') === k.spec_key)));
    const mark = markOf.get(g.id) || null;
    out.push({
      id: g.id, vendor_key: g.vendor_key, vendor_item_code: g.vendor_item_code, alias_key: g.alias_key, spec_key: g.spec_key,
      names: top(g.names, 5), specs: top(g.specs, 5), units: top(g.units, 5), n: g.n, docs: g.docs.size, stores: [...g.stores].sort(),
      posted: g.posted, review: g.review, first: g.first, last: g.last, last_price: g.last_price,
      min_price: g.min_price ? g.min_price.s : null, max_price: g.max_price ? g.max_price.s : null,
      link: link ? { id: link.id, version: link.version, ingredient_code: link.ingredient_code, verified: !!link.verified, source: link.source,
        verified_by: link.verified_by || null, verified_at: link.verified_at || null, purchase_unit: link.purchase_unit || '', spec_key: link.spec_key || '',
        count_unit: link.count_unit || null, count_per_purchase: link.count_per_purchase ?? null, base_unit: link.base_unit || null,
        base_per_purchase: link.base_per_purchase ?? null } : null,
      links: links.length,
      // lines that have the item's link now, and lines waiting to get it (taken in before the link, or changed meanwhile)
      applied: link ? (g.mapped[link.id] || 0) : 0,
      waiting: link ? g.n - (g.mapped[link.id] || 0) : 0,
      retired: retired.map(m => ({ id: m.id, ingredient_code: m.ingredient_code, retired_at: m.retired_at, retired_by: m.retired_by || null })),
      mark: mark && mark.state !== 'none' ? { state: mark.state, version: mark.version, note: mark.note || null, by_actor: mark.by_actor, by_role: mark.by_role, at: mark.at } : null,
      mark_version: mark ? mark.version : null,
      sample: g.sample,
    });
  }
  return out;
}

// A price per counting unit / base unit, as the intake writes it (rules.mjs usd).
const usd = (r, d = 10) => ratioToDecimal({ num: r.num, den: r.den * 1000000n }, d);
const num = v => (v === null || v === undefined || v === '' ? null : parseQty(String(v)));

// One line taken in (invoice_link_lines row) with the links in use (maps: in use only). changed: ids of links that changed now.
//   - a line with a link that did not change: left as it is (null)
//   - a line with a link that changed (linked again to another code): it keeps its link (as a person's choice is kept) with the new code
//   - a line whose link was taken back: looked up again (another link, or none)
//   - a line with no link: looked up; left as it is when there is still none (or still several)
// Returns the update for invoice_link_apply, or null when nothing changes.
export function relink(line, maps, changed) {
  const vmaps = (maps || []).filter(m => !m.retired_at && m.vendor_key === line.vendor_key);
  const cur = line.map_id ? vmaps.find(m => m.id === line.map_id) : null;
  const unit = unitKey(line.purchase_unit);
  const reasons = line.reasons || [];
  let fm;
  if (line.map_id && cur) {
    if (!changed || !changed.has(line.map_id)) return null;
    fm = { map: cur };
    if (cur.purchase_unit && unit && cur.purchase_unit !== unit) fm.reason = 'unit_mismatch';
  } else if (line.map_id) {
    fm = findMap(vmaps, { item_code: line.item_code, unit, pack: line.spec, raw_name: line.raw_name }, line.store_id);
  } else {
    if (!reasons.includes('unmapped') && !reasons.includes('map_ambiguous')) return null;
    fm = findMap(vmaps, { item_code: line.item_code, unit, pack: line.spec, raw_name: line.raw_name }, line.store_id);
    if (!fm.map) return null;
  }
  const r = [];
  if (fm.reason) r.push(fm.reason);
  const m = fm.map || null;
  const out = { line_id: line.id, from_map: line.map_id || null, map_id: null, ingredient_code: null, count_unit: null, count_per_purchase: null,
    base_unit: null, base_per_purchase: null, price_per_count: null, price_per_base: null };
  if (m) {
    Object.assign(out, { map_id: m.id, ingredient_code: m.ingredient_code, count_unit: m.count_unit || null, base_unit: m.base_unit || null,
      count_per_purchase: m.count_per_purchase == null ? null : String(m.count_per_purchase), base_per_purchase: m.base_per_purchase == null ? null : String(m.base_per_purchase) });
    if (!m.verified) r.push('map_unverified');
    else if (!m.auto_post) r.push('mode_review_item');
    const sk = line.spec_key || '';
    if (m.spec_key && sk && m.spec_key !== sk) r.push('spec_changed');
    const conv = { countPerPurchase: num(m.count_per_purchase), basePerPurchase: num(m.base_per_purchase) };
    if (line.spec && conv.basePerPurchase) {
      const p = parsePackSpec(line.spec);
      if (p && UNIT_DEFS[p.baseUnit] && p.baseUnit === m.base_unit && p.basePerPurchase !== conv.basePerPurchase) r.push('spec_changed');
    }
    const price = line.unit_price == null || line.unit_price === '' ? null : parseMicros(String(line.unit_price));
    if (price !== null) {
      const up = unitPrices(price, conv);
      if (up.perCount) out.price_per_count = usd(up.perCount);
      if (up.perBase) out.price_per_base = usd(up.perBase);
    }
  }
  out.reasons = [...new Set([...reasons.filter(c => !MAPPING.has(c)), ...r])];
  const same = (out.map_id || null) === (line.map_id || null) && (out.ingredient_code || null) === (line.ingredient_code || null)
    && [...out.reasons].sort().join() === [...new Set(reasons)].sort().join();
  return same ? null : out;
}
