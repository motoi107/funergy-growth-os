// e2e（career-score-q4-v1208.mjs の 4〜7・Moto さん 11/23「b1」「c B」）のために、合成データ（tests/perf/gen-data.mjs で作ったもの）に 3 つを足した写しを作る。
// 名前・メールはすべて作りもの・本番にはつながない。
//  1) 店長（SL・G3）を GM・CEO が確かめた写し（wr_people・G3・自分の店）＝確かめた G3 が自分の店の G2 を採点する（b1）
//  2) 2 人目の GM（CEO が採点して確定・公開し、GM は見るだけ＝c B）
//  3) CEO・GM の人の manager_auth（secure-state はこれで「GM・CEO の人」を決める）
// 使い方：node tests/e2e-cs4/data-b1.mjs <合成データ> <書き出す先>
import fs from 'node:fs';
const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('usage: node data-b1.mjs <in.json> <out.json>'); process.exit(2); }
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const T = d.tables, L = d.login, emp = T.employees;
const nid = 'e900';
if (emp.some(e => String(e.id) === nid)) throw new Error(nid + ' already exists');
const gm = structuredClone(emp.find(e => String(e.id) === L.gmId));
gm.id = nid; gm.name = 'Gail Mori';
if (gm.data && typeof gm.data === 'object') { gm.data.id = nid; gm.data.name = 'Gail Mori'; for (const k of ['empCode', 'emp_code', 'pin']) delete gm.data[k]; }
emp.push(gm);
const sl = emp.find(e => String(e.id) === L.slId);
T.wr_people = (T.wr_people || []).filter(r => String(r.emp_id) !== L.slId);
T.wr_people.push({ emp_id: L.slId, name: sl.name, role: 'staff', grade: 3, stores: [L.slStore], chef: false, confirmed_by: 'e2e', confirmed_at: (d.today || '2026-11-20') + 'T00:00:00Z' });
L.gm2 = 'Gail Mori'; L.gm2Id = nid;
T.manager_auth = (T.manager_auth || []).filter(r => ![L.ceoId, L.gmId, nid].includes(String(r.emp_id)));
for (const [k, r] of [[L.ceoId, 'ceo'], [L.gmId, 'gm'], [nid, 'gm']]) T.manager_auth.push({ id: 'ma-' + k, emp_id: k, role: r, email: k + '@example.invalid', name: emp.find(e => String(e.id) === k).name });
fs.writeFileSync(dst, JSON.stringify(d));
console.log('ok', emp.length, T.wr_people.length, T.manager_auth.length);
