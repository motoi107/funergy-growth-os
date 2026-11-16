// v1176：e2e の合成データ（tests/perf の合成データに Totoya Kaimuki の toast_upgrade_days・lines・extra を足す）。使い方：node upsell-v1176-gen.mjs <元の data.json> <書き出す data.json>
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const G = 'ca4cf739-ad9b-41e1-837c-4d3c6605bdcf';
const rec = d.tables.recipes.find(x => x.data.storeId === 'F04-K' && x.data.category === 'Side');
const BYMOD = { 'M-AOSA': { n: 'Aosa Miso', k: 'aosa', q: 6 }, 'M-CRAB': { n: 'Crab Miso', k: 'crab', q: 2 }, 'M-UDON': { n: 'Udon Miso', k: 'udon', q: 1 }, 'M-CHZ': { n: 'CHAZUKE', k: 'chazuke', q: 1 } };
const days = [], lines = [], extra = [];
for (let i = 1; i <= 14; i++) {
  const dt = '2026-11-' + String(i).padStart(2, '0');
  if (i === 14) { days.push({ restaurant_guid: G, business_date: dt, total: 10, upgrade: 4, by_mod: null, extra: null, hw_version: 'v1171' }); continue; }
  days.push({ restaurant_guid: G, business_date: dt, total: 10, upgrade: 4, by_mod: BYMOD, extra: 3, hw_version: 'v1176' });
  const L = (ck, mod, kind) => lines.push({ restaurant_guid: G, business_date: dt, check_key: dt + ck, mod_guid: mod, kind, qty: 1, counted: true, order_no: '1', check_no: '1' });
  L('C1', 'M-AOSA', 'aosa'); L('C2', 'M-CRAB', 'crab');
  const X = (ck, n) => extra.push({ restaurant_guid: G, business_date: dt, check_key: dt + ck, line_key: dt + 'x' + n, item_guid: rec.data.toastGuid, item_name: rec.data.name, qty: 1, order_no: '10' + n, check_no: '1', opened_at: dt + 'T2' + n + ':00:00Z', meal: 'D' });
  X('C1', 1); X('C2', 2); X('C9', 3);
}
d.tables.toast_upgrade_days = days; d.tables.toast_upgrade_lines = lines; d.tables.toast_upgrade_extra = extra;
fs.writeFileSync(process.argv[3], JSON.stringify(d));
console.log(JSON.stringify({ rec: { name: rec.data.name, guid: rec.data.toastGuid }, days: days.length, extra: extra.length }));
