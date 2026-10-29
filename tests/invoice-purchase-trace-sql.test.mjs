// 仕入れタブに経理確認済みの invoice が入らない件（2026-10-29）の読むだけの確かめ db/invoice-purchase-trace-check.sql。
// Real SQL (db/invoice-intake.sql on PGlite) with synthetic invoices: the check runs, writes nothing, shows where each confirmed
// invoice stops (renaming, filing, QuickBooks ledger, app copy, the server's class now and what the app reads) and never shows
// a key or a mail address. Nothing here reaches production, Drive, QuickBooks or mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const TRACE = fs.readFileSync(new URL('../db/invoice-purchase-trace-check.sql', import.meta.url), 'utf8');
const WORKER_KEY = 'synthetic-worker-key-trace-0123456789';
const QB_TO = 'qb-inbox@example.test';

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.employees(id text primary key, name text); grant select on public.employees to service_role;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz); grant select, insert, update on public.app_state to service_role;
    create table public.ingredients(code text primary key, name text, unit text, vendor text, qty numeric, data jsonb); grant select on public.ingredients to service_role;
    insert into public.ingredients values ('I-MISO','Miso','BAG','Minato',1,'{"cat":1000}');`);
  await pg.exec(SQL);
  await pg.query(`update invoice_settings set value=jsonb_build_object('key',$1::text,'enabled',true) where key='worker'`, [WORKER_KEY]);
  await pg.exec(`
    update invoice_settings set value=value||'{"intake":true,"mirror":true,"start_at":"2026-10-01T00:00:00Z","rename":true,"rename_since":"2026-10-12T00:00:00Z"}' where key='mode';
    update invoice_settings set value=value||'{"closed_through":"2026-08"}' where key='rules';
    update invoice_settings set value=value||'{"route":"external","enabled":true,"to":"${QB_TO}","since":"2026-10-13T07:00:00-10:00"}' where key='qb';
    insert into invoice_stores(store_id,label,active) values('F06','LaLa',true),('F01','ToriTon',true);
    insert into invoice_vendor_rules(vendor_key,display_name,food_kind) values('minato','Minato Seika','food');`);
  await pg.exec('set role service_role');
  const q = async (sql, p = []) => (await pg.query(sql, p)).rows;
  let n = 0;
  async function doc({ store = 'F06', qb = 'sent', recon = 'reconciled', created = '2026-10-14T00:00:00Z', name = null, renamed = null,
    renameState = 'none', renameError = null, organize = null, total = 10000, mirror = 'mirrored', mode = 'manual' } = {}) {
    n++;
    const sh = n.toString(16).padStart(64, '0');
    const [f] = await q(`insert into invoice_files(drive_file_id,store_id,source,original_name,current_name,drive_created_at,current_sha256,intake_status,
        rename_state,rename_error,rename_attempts,organize_target,organize_status)
      values($1,$2,'drive',$3,$4,$5,$6,'posted',$7,$8,$9,$10,$11) returning id`,
      ['drv' + n, store, name || ('scan' + n + '.pdf'), renamed || name || ('scan' + n + '.pdf'), created, sh, renameState, renameError,
        renameError ? 8 : 0, organize, organize ? 'pending' : 'none']);
    const [d] = await q(`insert into invoice_docs(source_key,file_id,sha256,internal_no,store_id,doc_type,posting_kind,vendor_key,vendor_name,vendor_raw,food_kind,
       invoice_no,invoice_date,effective_date,currency,total_cents,status,recon_status,recon_at,posted_mode,posted_at)
      values($1,$2,$3,$4,$5,'invoice','purchase','minato','Minato Seika','minato','food',$6,'2026-10-05','2026-10-05','USD',$7,'posted',$8,
       case when $8='reconciled' then now() end,$9,now()) returning id`,
      ['k' + n, f.id, sh, 'INT-' + n, store, String(5000 + n), total, recon, mode]);
    await q(`insert into invoice_lines(doc_id,line_no,raw_name,raw,qty,amount_cents,ingredient_code) values($1,1,'miso','{}',1,$2,'I-MISO')`, [d.id, total]);
    if (qb) await q(`insert into invoice_qb_outbox(file_id,sha256,to_address,route,state,attempt_key,sent_at) values($1,$2,$3,'external',$4,$5,case when $4='sent' then now() end)`,
      [f.id, sh, QB_TO, qb, 'qb-' + sh]);
    if (mirror) await q(`insert into invoice_app_mirror(doc_id,app_inv_id,store_id,state) values($1,$2,$3,$4)`, [d.id, 'drv_INT-' + n, store, mirror]);
    return { id: d.id, n };
  }
  const trace = async () => (await pg.query(TRACE)).rows;
  return { pg, q, doc, trace };
}

const snapshot = async E => {
  const tables = ['invoice_docs', 'invoice_files', 'invoice_qb_outbox', 'invoice_app_mirror', 'invoice_purchase_published', 'app_state', 'invoice_settings', 'invoice_events'];
  const out = {};
  for (const t of tables) out[t] = JSON.stringify((await E.q(`select * from ${t} order by 1`)));
  return out;
};

test('the trace check runs on the real tables, writes nothing and shows each confirmed invoice where it stops', async () => {
  const E = await setup();
  const sent = await E.doc({ name: 'scan-a.pdf', renamed: '2026-10-05_Minato Seika_5001.pdf', renameState: 'done', organize: 'reconciled' });
  const pending = await E.doc({ qb: 'pending', name: 'scan-b.pdf', renamed: '2026-10-05_Minato Seika_5002.pdf', renameState: 'done' });
  const none = await E.doc({ qb: null, renameState: 'error', renameError: 'drive_403' });
  const pre = await E.doc({ qb: null, created: '2026-10-12T20:00:00Z' });
  const byHand = await E.doc({ recon: 'unreconciled' });                   // a person posted it, not reconciled: confirmed (2026-10-29), traced
  await E.doc({ recon: 'unreconciled', mode: 'auto' });                     // automatic, not reconciled: counted in the store row, not traced
  await E.q(`select public.invoice_purchase_publish('{}'::jsonb)`);
  await E.q(`insert into invoice_runs(kind,started_at,ok,stats) values('intake',now(),true,'{"renamed":2,"qb_queued":1,"purchase_published":1}')`);
  const before = await snapshot(E);
  const rows = await E.trace();
  assert.deepEqual(await snapshot(E), before, 'reads only');
  if (process.env.SHOW_TRACE) console.table(rows);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(WORKER_KEY), 'never shows the worker key');
  assert.ok(!text.includes(QB_TO), 'never shows the QuickBooks address');
  const one = id => rows.find(r => r['区分'] === '1 件' && r['invoice'].includes(id.slice(0, 8)));
  assert.equal(rows.filter(r => r['区分'] === '1 件').length, 5, 'every invoice a person posted or accounting reconciled, and only those');
  assert.match(one(sent.id)['サーバーの今の計算'], /^A/);
  assert.match(one(sent.id)['アプリが読む集計'], /^A/);
  assert.match(one(sent.id)['ファイル名'], /scan-a\.pdf → 2026-10-05_Minato Seika_5001\.pdf/);
  assert.match(one(sent.id)['QuickBooks'], /^external\/sent/);
  assert.match(one(sent.id)['照合済みフォルダへ'], /^reconciled/);
  assert.match(one(pending.id)['サーバーの今の計算'], /^A reconciled・qb_pending/);
  assert.match(one(pending.id)['QuickBooks'], /^external\/pending/);
  assert.match(one(none.id)['サーバーの今の計算'], /^A reconciled・qb_none/);
  assert.match(one(none.id)['QuickBooks'], /^台帳に無い$/);
  assert.match(one(none.id)['名前の変更'], /error.*8 回.*drive_403/);
  assert.match(one(pre.id)['サーバーの今の計算'], /^A reconciled・pre_ledger/);
  assert.match(one(byHand.id)['サーバーの今の計算'], /^A posted_manual$/);
  assert.match(one(byHand.id)['状態'], /^posted・manual /);
  assert.match(one(pre.id)['QuickBooks'], /送り始めより前の原本/);
  const st = rows.find(r => r['区分'] === '店' && r['店舗'] === 'F06');
  assert.match(st['請求日'], /^反映済み 6 件 \$600\.00（うち人が反映 5 件）/);
  assert.match(st['金額'], /^照合済み 4 件 \$400\.00/);
  assert.match(st['サーバーの今の計算'], /^A 5 件 原価 \$500\.00・B 0 件 \$0\.00・C 1・E 0$/);
  assert.match(st['アプリが読む集計'], /^A 5 件 原価 \$500\.00・B 0/);
  const set = rows.filter(r => r['区分'] === '設定').map(r => r['invoice']);
  assert.deepEqual(set, ['取込', 'QuickBooks の設定', '仕入れ集計', '最後の 5 分ごとの動き']);
  const qb = rows.find(r => r['invoice'] === 'QuickBooks の設定');
  assert.match(qb['請求日'], /送る担当 external/);
  assert.match(qb['ファイル名'], /^宛先 設定あり/);
  assert.match(qb['QuickBooks'], /external\/pending 1・external\/sent 3・今の宛先と違う行 0/);
  const ps = rows.find(r => r['invoice'] === '仕入れ集計');
  assert.match(ps['アプリが読む集計'], /サーバーと 同じ/);
});

test('with no summary written yet and nothing set, the check still runs', async () => {
  const E = await setup();
  await E.pg.exec(`reset role; update invoice_settings set value='{}'::jsonb where key in ('qb','mode'); set role service_role;`);
  await E.doc({ qb: null, mirror: null });
  const rows = await E.trace();
  const ps = rows.find(r => r['invoice'] === '仕入れ集計');
  assert.match(ps['照合済みフォルダへ'], /この月は書いていない/);
  assert.match(ps['アプリが読む集計'], /無い/);
  assert.match(rows.find(r => r['区分'] === '1 件')['アプリの写し'], /写しの記録なし/);
  assert.match(rows.find(r => r['invoice'] === 'QuickBooks の設定')['請求日'], /送る担当 未設定/);
});
