// Normalises one transcribed document and decides whether it may be posted
// without a person. Every reason is kept; a document is auto-eligible only when
// there is no reason at all. Values are never changed to make totals agree.
import { parseCents, parseMicros, parseQty, parseScaled, fromScaled, trimDecimal, ratio, ratioToDecimal,
  changedAtLeast, changePercent, lineMathDiff, HALF_CENT_PICO, CENT_PICO } from './decimal.mjs';
import { determineDate, validYmd, ymOf } from './dates.mjs';
import { parsePackSpec, unitPrices, UNIT_DEFS, canonUnit } from './units.mjs';
import { normInvoiceNo, aliasKey, specKey, unitKey, codeKey } from './dedupe.mjs';

export const REASONS = {
  unreadable:            ['読み取れない（ピンぼけ・暗い・切れている）', 'Not legible'],
  ai_failed:             ['AIの読み取りに失敗', 'Reading failed'],
  ai_truncated:          ['読み取りが途中で切れた', 'Reading was cut off'],
  multiple_documents:    ['1つのファイルに複数の書類', 'Several documents in one file'],
  doc_type_unknown:      ['書類の種類が分からない', 'Document type unknown'],
  receipt_route:         ['レシート（会社カード・立替は社員別の管理へ）', 'Receipt (card/reimbursement receipts use the employee folders)'],
  statement:             ['Statement（照合用・仕入計上しない）', 'Statement (for reconciliation only, not a purchase)'],
  credit_memo:           ['Credit memo（元の invoice と紐づけが必要）', 'Credit memo (link to the original invoice)'],
  vendor_unknown:        ['業者がマスターと一致しない', 'Vendor not in the master'],
  vendor_kind_unset:     ['業者の「食材／食材以外」が未設定', 'Vendor food/non-food not set'],
  store_mismatch:        ['宛先が別の店舗（自動で付け替えない）', 'Addressed to another store (never reassigned automatically)'],
  ship_to_unrecognized:  ['宛先が店舗の登録名・住所と一致しない', 'Ship-to does not match the store'],
  multi_store:           ['複数店舗分を含む', 'Covers several stores'],
  invoice_no_missing:    ['invoice番号がない', 'No invoice number'],
  date_missing:          ['請求日がない', 'No invoice date'],
  date_unreadable:       ['請求日が読めない', 'Invoice date not legible'],
  date_disagree:         ['請求日の読みが一致しない', 'Invoice date reading disagrees'],
  delivery_date_invalid: ['納品日が読めない', 'Delivery date not legible'],
  currency:              ['通貨が USD でない、または不明', 'Currency is not USD or unknown'],
  total_missing:         ['請求合計がない', 'No invoice total'],
  total_mismatch:        ['明細と税・送料・割引の合計が請求合計と一致しない', 'Lines plus charges do not equal the total'],
  discount_allocation:   ['全体値引きの配賦方法が未設定', 'Invoice discount allocation not set'],
  mixed_tax:             ['課税・非課税の明細が混在', 'Taxable and non-taxable lines mixed'],
  missing_pages:         ['ページ不足の疑い', 'Pages may be missing'],
  no_lines:              ['明細がない', 'No line items'],
  closed_month:          ['締め済みの月（経理の調整処理へ）', 'Closed month (accounting adjustment)'],
  duplicate_certain:     ['同じ invoice が登録済み（計上しない）', 'Already registered (not posted again)'],
  same_number_different: ['同じ番号で内容が違う（訂正版か別書類）', 'Same number, different content'],
  duplicate_candidate:   ['重複の可能性', 'Possible duplicate'],
  app_duplicate_candidate:['アプリで登録済みの可能性', 'May already be registered in the app'],
  original_replaced:     ['同じファイルの中身が差し替えられた（前の版と見比べる）', 'The file was overwritten with new content (compare with the earlier version)'],
  line_value_missing:    ['数量・単価・金額が読めない明細', 'Line quantity/price/amount missing'],
  line_math:             ['数量×単価が明細金額と一致しない', 'Quantity × price does not equal the line amount'],
  zero_price:            ['単価または金額が 0', 'Zero price or amount'],
  negative_line:         ['マイナスの明細（返品など）', 'Negative line (return etc.)'],
  catch_weight:          ['重量で請求する明細（キャッチウェイト）', 'Catch-weight line'],
  unmapped:              ['商品マスターに対応がない（新商品）', 'Not mapped to a product (new item)'],
  map_ambiguous:         ['対応する商品が複数ある', 'Several products match'],
  map_unverified:        ['商品の対応が未確認', 'Product mapping not verified'],
  unit_mismatch:         ['仕入単位が対応表と違う', 'Purchase unit differs from the mapping'],
  unit_unverified:       ['仕入単位が印字されていない', 'Purchase unit not printed'],
  spec_changed:          ['規格・入数が対応表と違う（値上がりと区別）', 'Pack/spec differs from the mapping'],
  no_price_ref:          ['比較できる前回の単価がない', 'No earlier price to compare'],
  price_jump:            ['単価が前回から大きく変わった', 'Price changed sharply'],
  mode_review_store:     ['店舗は確認モード', 'Store is in review mode'],
  mode_review_vendor:    ['業者は確認モード', 'Vendor is in review mode'],
  mode_review_item:      ['商品は確認モード', 'Item is in review mode'],
  intake_not_started:    ['運用開始前のため自動反映しない', 'Before the start date'],
};

const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function matchStores(text, stores) {
  const t = norm(text);
  if (!t) return [];
  return (stores || []).filter(s => (s.aliases || []).some(a => { const k = norm(a); return k.length >= 4 && t.includes(k); }));
}

function vendorFor(name, vendors) {
  const k = aliasKey(name);
  if (!k) return null;
  const hits = (vendors || []).filter(v => [v.display_name, ...(v.aliases || [])].some(a => aliasKey(a) === k));
  return hits.length === 1 ? hits[0] : null;
}

export function findMap(maps, line, storeId) {
  const scoped = (maps || []).filter(m => !m.store_id || m.store_id === storeId);
  const code = codeKey(line.item_code), unit = unitKey(line.unit), spec = specKey(line.pack), alias = aliasKey(line.raw_name);
  let c = [];
  if (code) c = scoped.filter(m => m.vendor_item_code && codeKey(m.vendor_item_code) === code);
  if (!c.length && alias) c = scoped.filter(m => m.alias_key && m.alias_key === alias && (m.spec_key || '') === spec);
  if (c.length > 1) { const u = c.filter(m => (m.purchase_unit || '') === unit); if (u.length) c = u; }
  if (c.length > 1) { const s = c.filter(m => m.store_id === storeId); if (s.length === 1) c = s; }
  if (c.length > 1) return { reason: 'map_ambiguous', candidates: c.map(m => m.id) };
  if (!c.length) return { reason: 'unmapped' };
  const m = c[0];
  if (m.purchase_unit && !unit) return { map: m, reason: 'unit_unverified' };
  if (m.purchase_unit && unit && m.purchase_unit !== unit) return { map: m, reason: 'unit_mismatch' };
  return { map: m };
}

const usd = (r, d = 10) => ratioToDecimal({ num: r.num, den: r.den * 1000000n }, d);
const dec = (v, d = 6) => (v === null || v === undefined ? null : trimDecimal(fromScaled(v, d)));

// ctx: { store, stores, vendors, maps, settings, priceRef, dup, docCount, aiStop, started }
export async function evaluate(ext, ctx) {
  const reasons = [];
  const add = (code, detail, line_no) => { if (!reasons.some(r => r.code === code && r.line_no === line_no)) reasons.push({ code, ...(detail !== undefined ? { detail } : {}), ...(line_no !== undefined ? { line_no } : {}) }); };
  const st = ctx.settings || {};
  const h = { store_id: ctx.store.store_id };

  if (ctx.docCount > 1) add('multiple_documents', ctx.docCount);
  if (ctx.aiStop === 'max_tokens') add('ai_truncated');

  h.doc_type = ext.doc_type;
  h.posting_kind = ext.doc_type === 'invoice' || ext.doc_type === 'credit_memo' ? 'purchase' : 'none';
  if (ext.doc_type === 'statement') add('statement');
  else if (ext.doc_type === 'receipt') add('receipt_route');
  else if (ext.doc_type === 'credit_memo') add('credit_memo');
  else if (ext.doc_type !== 'invoice') add('doc_type_unknown');

  // Vendor: exact match to a master name or a registered alias only.
  h.vendor_raw = ext.vendor_name;
  const v = vendorFor(ext.vendor_name, ctx.vendors);
  if (v) { h.vendor_key = v.vendor_key; h.vendor_name = v.display_name; }
  else add('vendor_unknown');
  if (v && !v.food_kind) add('vendor_kind_unset');
  h.food_kind = v ? v.food_kind || null : null;
  h.vendor_code = ext.customer_account;

  // Store is fixed by the upload folder. The printed address can only confirm it.
  h.ship_to_raw = ext.ship_to || ext.bill_to || null;
  if (h.ship_to_raw) {
    const hits = matchStores(h.ship_to_raw, ctx.stores);
    const mine = hits.some(s => s.store_id === ctx.store.store_id);
    const groups = new Set(hits.map(s => s.address_group || s.store_id));
    if (!hits.length) add('ship_to_unrecognized');
    else if (!mine) add('store_mismatch', hits.map(s => s.store_id).join(','));
    else if (groups.size > 1) add('multi_store', hits.map(s => s.store_id).join(','));
  }

  h.invoice_no = ext.invoice_number;
  h.invoice_no_norm = normInvoiceNo(ext.invoice_number);
  if (!h.invoice_no_norm && h.posting_kind === 'purchase') add('invoice_no_missing');

  const d = determineDate(ext.invoice_date_text, ext.invoice_date);
  h.invoice_date = d.value;
  if (!d.value) add(d.reason);
  if (ext.delivery_date_text) {
    const dd = determineDate(ext.delivery_date_text, ext.delivery_date);
    h.delivery_date = dd.value;
    if (!dd.value) add('delivery_date_invalid');
  } else h.delivery_date = null;
  const due = ext.due_date_text ? determineDate(ext.due_date_text, ext.due_date) : { value: null };
  h.due_date = due.value;
  h.effective_date = h.delivery_date || h.invoice_date;
  h.effective_basis = h.delivery_date ? 'delivery' : (h.invoice_date ? 'invoice' : null);
  h.posting_date = h.effective_date;
  if (h.invoice_date && st.closed_through && ymOf(h.invoice_date) <= st.closed_through) add('closed_month', st.closed_through);

  const cur = String(ext.currency || st.currency_when_absent || '').toUpperCase().replace(/[^A-Z]/g, '');
  h.currency = cur || null;
  if (h.currency !== 'USD') add('currency', ext.currency || null);

  // Header amounts.
  const cents = t => (t === null || t === undefined ? null : parseCents(t));
  h.subtotal_cents = cents(ext.subtotal);
  const disc = cents(ext.discount_total);
  h.discount_cents = disc === null ? 0 : Math.abs(disc);
  h.tax_cents = cents(ext.tax) ?? 0;
  h.shipping_cents = cents(ext.shipping) ?? 0;
  h.other_charges = (ext.other_charges || []).map(o => ({ label: o.label, cents: cents(o.amount) }));
  h.other_cents = h.other_charges.reduce((a, o) => a + (o.cents ?? 0), 0);
  h.total_cents = cents(ext.total);
  const badHeader = [ext.subtotal, ext.discount_total, ext.tax, ext.shipping, ext.total].some(x => x !== null && x !== undefined && parseCents(x) === null)
    || h.other_charges.some(o => o.cents === null);
  if (h.total_cents === null) add('total_missing');
  if (h.discount_cents && !st.discount_allocation) add('discount_allocation');

  h.pages = ext.pages || [];
  h.pages_marked = ext.pages_marked || [];
  const ofN = h.pages_marked.map(p => /(\d+)\s*(?:of|\/|ページ中)\s*(\d+)/i.exec(p)).filter(Boolean).map(m => +m[2]);
  const declared = ofN.length ? Math.max(...ofN) : null;
  const seen = h.pages.length ? Math.max(...h.pages) : (ctx.pageCount || 1);
  if (declared && declared > Math.max(seen, ctx.pageCount || 0)) add('missing_pages', `${seen}/${declared}`);
  if (h.pages.length && h.pages.some((p, i) => i > 0 && p !== h.pages[i - 1] + 1)) add('missing_pages', h.pages.join(','));
  h.references = ext.references || [];

  // Lines.
  const lines = [];
  const taxFlags = new Set();
  let lineSum = 0, lineBad = false;
  const extLines = ext.lines || [];
  for (let i = 0; i < extLines.length; i++) {
    const l = extLines[i], n = i + 1;
    const r = [];
    const qty = parseQty(l.qty), unit = parseMicros(l.unit_price), amount = parseCents(l.amount);
    const ldisc = l.line_discount ? parseCents(l.line_discount) : 0;
    const out = {
      line_no: n, page: l.page, item_code: l.item_code, raw_name: l.description || '', raw: l,
      qty: dec(qty), purchase_unit: unitKey(l.unit) || null, spec: l.pack, spec_key: specKey(l.pack),
      unit_price: dec(unit), amount_cents: amount, line_discount_cents: ldisc === null ? null : Math.abs(ldisc),
      weight: l.weight, weight_unit: l.weight_unit, price_unit: l.price_unit, taxable: l.taxable,
    };
    if (l.taxable !== null && l.taxable !== undefined) taxFlags.add(l.taxable);
    if (qty === null || unit === null || amount === null || ldisc === null) { r.push('line_value_missing'); lineBad = true; }
    else {
      lineSum += amount;
      const catchWeight = !!l.weight || (l.price_unit && unitKey(l.price_unit) !== unitKey(l.unit));
      if (catchWeight) r.push('catch_weight');
      else {
        const diff = lineMathDiff(qty, unit, amount) - BigInt(out.line_discount_cents) * CENT_PICO;
        const tol = HALF_CENT_PICO + BigInt(st.line_tolerance_cents || 0) * CENT_PICO;
        if (diff > tol || diff < -tol) r.push('line_math');
      }
      if (unit === 0n || amount === 0) r.push('zero_price');
      if (amount < 0 || qty < 0n) r.push('negative_line');
    }
    if (h.posting_kind === 'purchase') {
      // Only this vendor's mappings are considered. A person's explicit choice takes precedence.
      const vmaps = h.vendor_key ? (ctx.maps || []).filter(m => m.vendor_key === h.vendor_key) : [];
      const forcedId = ctx.forcedMaps && ctx.forcedMaps[i];
      let fm;
      if (forcedId) {
        const fmap = vmaps.find(m => m.id === forcedId && (!m.store_id || m.store_id === ctx.store.store_id));
        fm = fmap ? { map: fmap } : { reason: 'unmapped' };
        if (fmap && fmap.purchase_unit && unitKey(l.unit) && fmap.purchase_unit !== unitKey(l.unit)) fm.reason = 'unit_mismatch';
      } else fm = findMap(vmaps, { item_code: l.item_code, unit: l.unit, pack: l.pack, raw_name: l.description }, ctx.store.store_id);
      if (fm.reason) r.push(fm.reason);
      const m = fm.map;
      if (m) {
        out.map_id = m.id; out.ingredient_code = m.ingredient_code;
        out.count_unit = m.count_unit || null; out.base_unit = m.base_unit || null;
        out.count_per_purchase = m.count_per_purchase ?? null; out.base_per_purchase = m.base_per_purchase ?? null;
        if (!m.verified) r.push('map_unverified');
        else if (!m.auto_post) r.push('mode_review_item');
        if (m.spec_key && out.spec_key && m.spec_key !== out.spec_key) r.push('spec_changed');
        const conv = { countPerPurchase: m.count_per_purchase ? parseQty(m.count_per_purchase) : null, basePerPurchase: m.base_per_purchase ? parseQty(m.base_per_purchase) : null };
        if (l.pack && conv.basePerPurchase) {
          const p = parsePackSpec(l.pack);
          if (p && UNIT_DEFS[p.baseUnit] && p.baseUnit === m.base_unit && p.basePerPurchase !== conv.basePerPurchase) r.push('spec_changed');
        }
        if (unit !== null) {
          const up = unitPrices(unit, conv);
          out.price_per_purchase = dec(unit);
          if (up.perCount) out.price_per_count = usd(up.perCount);
          if (up.perBase) out.price_per_base = usd(up.perBase);
          // Price change: same store, vendor, product and spec, compared in the base unit when known.
          if (!r.includes('catch_weight') && h.vendor_key && h.effective_date && ctx.priceRef) {
            const prev = await ctx.priceRef({ vendor_key: h.vendor_key, ingredient_code: m.ingredient_code, spec_key: m.spec_key || out.spec_key || '',
              purchase_unit: m.purchase_unit || out.purchase_unit || '', base_unit: m.base_unit || null, before: h.effective_date, line_id: null });
            if (!prev) r.push('no_price_ref');
            else {
              let oldR = null, newR = null;
              if (prev.price_per_base && up.perBase) { const p = parseScaled(prev.price_per_base, 10); oldR = ratio(p, 10000000000n); newR = { num: up.perBase.num, den: up.perBase.den * 1000000n }; }
              else if (prev.price_per_purchase) { const p = parseMicros(prev.price_per_purchase); oldR = ratio(p, 1n); newR = ratio(unit, 1n); }
              if (!oldR) r.push('no_price_ref');
              else {
                out.prev_price = { ...prev, change_pct: changePercent(oldR, newR) };
                if (changedAtLeast(oldR, newR, st.price_jump_pct ?? 15)) r.push('price_jump');
              }
            }
          }
        }
      }
    }
    if (out.line_discount_cents && !st.discount_allocation) r.push('discount_allocation');
    out.reasons = [...new Set(r)];
    out.reasons.forEach(c => add(c, undefined, n));
    lines.push(out);
  }
  if (!lines.length && h.posting_kind === 'purchase') add('no_lines');
  if (taxFlags.size > 1) add('mixed_tax');

  // Totals: printed lines, then printed charges, must equal the printed total.
  if (badHeader) add('total_mismatch', 'unreadable_header_amount');
  else if (h.total_cents !== null && !lineBad && lines.length) {
    const tol = st.total_tolerance_cents || 0;
    if (h.subtotal_cents !== null && Math.abs(lineSum - h.subtotal_cents) > tol) add('total_mismatch', 'lines_vs_subtotal');
    const base = h.subtotal_cents !== null ? h.subtotal_cents : lineSum;
    const calc = base - h.discount_cents + h.tax_cents + h.shipping_cents + h.other_cents;
    if (Math.abs(calc - h.total_cents) > tol) add('total_mismatch', `calc ${calc} vs ${h.total_cents}`);
  }
  h.lines_sum_cents = lineSum;

  // Review mode switches. These are gates, not errors.
  if (!ctx.store.auto_post) add('mode_review_store');
  if (v && !v.auto_post) add('mode_review_vendor');
  if (!ctx.started) add('intake_not_started');

  return { header: h, lines, reasons, autoEligible: reasons.length === 0 };
}

// Duplicates are found by the caller after the header is known.
export function applyDuplicates(result, dup) {
  const add = (code, detail) => { if (!result.reasons.some(r => r.code === code && r.detail === detail)) result.reasons.push({ code, detail }); };
  if (dup.certain) add('duplicate_certain', dup.certain.id);
  (dup.sameNumberDifferent || []).forEach(id => add('same_number_different', id));
  if ((dup.candidates || []).length) add('duplicate_candidate', dup.candidates.join(','));
  if ((dup.app || []).length) add('app_duplicate_candidate', dup.app.join(','));
  result.autoEligible = result.reasons.length === 0;
  return result;
}

export function reasonText(code, lang = 'ja') {
  const r = REASONS[code];
  return r ? r[lang === 'en' ? 1 : 0] : code;
}
