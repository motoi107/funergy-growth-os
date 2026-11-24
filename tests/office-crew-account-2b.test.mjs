// 2b（Moto さん 11/24「GMやCEOの様にメールで登録（ログインはPINでも入れる様に）」）：事務Crew のメールのアカウントを足す SQL のひな形。
// 本物の申請の SQL（PGlite・wr_actor・wr_exp_crew・wr_emp_out）に、偽の auth.users と Invoice取込の invoice_actor_role（db/invoice-intake.sql の写し）を足して、
// deploy/office-crew-account-2b の ①②③・止める を流す。名前・メールは架空。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, M, NAME } from './approval-rules-world.mjs';

const D = new URL('../deploy/office-crew-account-2b/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const CHECK1 = read('1_最初に確認_読むだけ.sql'), ADD = read('2_事務Crewのアカウントを足す_ひな形.sql'), CHECK3 = read('3_確認_読むだけ.sql'), STOP = read('止める_ひな形.sql');
const INV = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const ACTOR_ROLE = /create function public\.invoice_actor_role\(p_actor uuid\)[\s\S]*?\$\$;/.exec(INV)[0];
const FIX = M('20261217090000_wr_actor_crew_grant');
// E15・E16：PIN だけの事務Crew／E17：退職した事務Crew／E18：同じ名前の事務Crew 2 人（名前では決めない）
const EXTRA = [['E15', 'Pia Pin', 'office_crew', 'Office Crew', 'OFFICE', '在籍'], ['E16', 'Quinn Pin', 'crew', 'Office Staff', 'OFFICE', '在籍'],
  ['E17', 'Rae Gone', 'office_crew', 'Office Crew', 'OFFICE', '退職'], ['E18', 'Sam Same', 'office_crew', 'Office Crew', 'OFFICE', '在籍'], ['E19', 'Sam Same', 'office_crew', 'Office Crew', 'OFFICE', '在籍']];
const MAIL = { E15: 'pia@example.test', E16: 'quinn@example.test', E17: 'rae@example.test', E18: 'sam@example.test', other: 'pia.second@example.test', gm: 'gabe@example.test', crew: 'cam@example.test' };

async function world() {
  const s = await setup({});
  await s.pg.exec('reset role');
  for (const [id, nm, role, title, store, st] of EXTRA) {
    await s.pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]',$6,$7)`, [id, nm, role, title, store, st, JSON.stringify({ name: nm, status: st })]);
    NAME[id] = nm;
  }
  await s.pg.exec(FIX);
  await s.pg.exec(`create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text);`);
  await s.pg.exec(ACTOR_ROLE);
  for (const [k, m] of Object.entries(MAIL)) if (k !== 'gm') await s.pg.query('insert into auth.users(email) values ($1)', [m]);
  // GM のメールのアカウント（manager_auth に gm で入っている人）
  await s.pg.query(`insert into auth.users(id, email) select user_id, $1 from public.manager_auth where emp_id = 'E2'`, [MAIL.gm]);
  return s;
}
// SQL Editor で流すのと同じ（ひな形の 2 つを書き換えて）。答え：{ ok, err, rows }（最後の select の行）
async function run(s, sql, sub = {}) {
  let t = sql;
  for (const [a, b] of Object.entries(sub)) { assert.ok(t.includes(a), 'placeholder ' + a); t = t.replace(a, b); }
  try { const r = await s.pg.exec(t); return { ok: true, rows: (r.at(-1) || {}).rows || [] }; }
  catch (e) { return { ok: false, err: String(e.message) }; }
}
const add = (s, email, who) => run(s, ADD, { "'name@example.com'": `'${email}'`, "'社員の ID か名前'": `'${who}'` });
const stop = (s, email) => run(s, STOP, { "'name@example.com'": `'${email}'` });
const rows = async s => (await s.pg.query(`select a.role, a.emp_id, u.email from public.manager_auth a left join auth.users u on u.id = a.user_id order by u.email nulls last, a.role`)).rows;
const pinRole = async (s, emp) => { try { return (await s.pg.query(`select public.wr_actor($1::jsonb) v`, [JSON.stringify({ emp_id: emp })])).rows[0].v.role; } catch (e) { return 'error:' + e.message; } };
const invRole = async (s, email) => (await s.pg.query(`select public.invoice_actor_role(u.id) r from auth.users u where u.email = $1`, [email])).rows[0].r;

test('2b ①：表・関数があれば STOP なし（数だけ）。manager_auth に値の要る列が足されていたら STOP（② を流さない）', async () => {
  const s = await world();
  const r = await run(s, CHECK1);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.rows.filter(x => x.result === 'STOP'), []);
  const by = Object.fromEntries(r.rows.map(x => [x.no, x]));
  assert.match(by[7].detail, /^1 件/, '今の事務Crew のメールのアカウントは E4 だけ');
  assert.match(by[8].detail, /^4 人/, '在籍の事務Crew でアカウントの無い人（E15・E16（肩書き Office Staff）・E18・E19。退職の E17 は数えない）');
  assert.ok(!JSON.stringify(r.rows).match(/Pia|example\.test/), '名前・メールを出さない');
  await s.pg.exec(`alter table public.manager_auth add column note text not null default ''; alter table public.manager_auth alter column note drop default;`);
  const r2 = await run(s, CHECK1);
  const six = r2.rows.find(x => x.no === 6);
  assert.equal(six.result, 'STOP'); assert.match(six.detail, /note/);
});

test('2b ②：足すのは manager_auth の 1 行（office_crew・社員の ID）だけ。メールでも PIN でも事務Crew。2 回流しても同じ', async () => {
  const s = await world();
  const before = await rows(s);
  assert.equal(await pinRole(s, 'E15'), 'staff', '確かめも無い PIN だけの事務Crew は G1');
  const r = await add(s, MAIL.E15, 'E15');
  assert.ok(r.ok, r.err);
  const after = await rows(s);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.find(x => x.email === MAIL.E15), { role: 'office_crew', emp_id: 'E15', email: MAIL.E15 });
  assert.equal(await invRole(s, MAIL.E15), 'office_crew', 'Invoice取込・照合・QuickBooks の状態を開ける');
  assert.equal(await pinRole(s, 'E15'), 'office_crew', 'PIN のログインでもメールのアカウントの事務Crew（確かめは要らない）');
  const w = (await s.pg.query(`select public.wr_actor('{"emp_id":"E15"}'::jsonb) v`)).rows[0].v;
  assert.equal(w.src, undefined, 'メールのアカウントの道（crew_grant ではない）');
  const again = await add(s, MAIL.E15, 'E15');
  assert.ok(again.ok, again.err);
  assert.deepEqual(await rows(s), after, '2 回目は何も変えない');
  // 名前でも（在籍の事務Crew で 1 人だけ当たるとき）。肩書き Office Staff の人も事務Crew
  assert.ok((await add(s, MAIL.E16, 'Quinn Pin')).ok);
  assert.deepEqual((await rows(s)).find(x => x.email === MAIL.E16), { role: 'office_crew', emp_id: 'E16', email: MAIL.E16 });
  // ③：どれも OK（E4 は社員の表に office_crew・E15・E16 も）
  const c = await run(s, CHECK3);
  assert.ok(c.ok, c.err);
  assert.deepEqual(c.rows.map(x => [x.emp_id, x.invoice_role, x.pin_role, x.result]).sort(),
    [['E15', 'office_crew', 'office_crew', 'OK'], ['E16', 'office_crew', 'office_crew', 'OK'], ['E4', 'office_crew', 'office_crew', 'OK']]);
  assert.ok(c.rows.every(x => x.result === 'OK'), JSON.stringify(c.rows));
  assert.deepEqual(c.rows.map(x => x.emp_id).filter(x => x !== 'E4').sort(), ['E15', 'E16']);
});

test('2b ②：止まる（何も変えない）— 書き換えていない・メールが無い・社員が無い／2 人・退職・事務Crew でない・GM のメール・別の社員・1 人 2 つ', async () => {
  const s = await world();
  const base = await rows(s);
  const cases = [
    [() => run(s, ADD), /書き換えてから/],
    [() => add(s, 'nobody@example.test', 'E15'), /アカウントが 0 件/],
    [() => add(s, MAIL.E15, 'E999'), /当たる在籍の事務Crew が 0 人/],
    [() => add(s, MAIL.E18, 'Sam Same'), /当たる在籍の事務Crew が 2 人/],
    [() => add(s, MAIL.E17, 'E17'), /退職/],
    [() => add(s, MAIL.crew, 'E8'), /事務Crew ではありません/],
    [() => add(s, MAIL.gm, 'E15'), /もう gm のアカウント/],
  ];
  for (const [f, re] of cases) { const r = await f(); assert.equal(r.ok, false, String(re)); assert.match(r.err, re); assert.match(r.err, /STOP/); }
  assert.deepEqual(await rows(s), base, 'ここまで何も変わらない');
  assert.ok((await add(s, MAIL.E15, 'E15')).ok);
  const one = await rows(s);
  const r1 = await add(s, MAIL.E15, 'E18');
  assert.equal(r1.ok, false); assert.match(r1.err, /別の社員（ID E15）と結ばれています/);
  const r2 = await add(s, MAIL.other, 'E15');
  assert.equal(r2.ok, false); assert.match(r2.err, /もう別のメールのアカウントと結ばれています/);
  assert.deepEqual(await rows(s), one);
  // 社員の ID が空の事務Crew のアカウントは、社員の ID だけ入れる（PIN の「この端末で覚える」が使えるように）
  await s.pg.query(`insert into public.manager_auth(user_id, role, emp_id) select id, 'office_crew', null from auth.users where email = $1`, [MAIL.E18]);
  let c = await run(s, CHECK3);
  assert.equal(c.rows.find(x => x.email === MAIL.E18).result, 'NG');
  assert.ok((await add(s, MAIL.E18, 'E18')).ok);
  assert.deepEqual((await rows(s)).find(x => x.email === MAIL.E18), { role: 'office_crew', emp_id: 'E18', email: MAIL.E18 });
  c = await run(s, CHECK3);
  assert.equal(c.rows.find(x => x.email === MAIL.E18).result, 'OK');
});

test('2b 止める：そのメールの事務Crew の行だけを消す（GM の行は止めない）。退職は ③ が NG と言う', async () => {
  const s = await world();
  assert.ok((await add(s, MAIL.E15, 'E15')).ok);
  // 退職：PIN は止まる（wr_actor が断る）が、Invoice取込はメールのアカウントの役割だけを見るので ③ が NG（止めるまで入れる）
  await s.retire('E15'); await s.pg.exec('reset role');   // SQL Editor と同じ（サーバーの鍵ではない）
  assert.match(await pinRole(s, 'E15'), /^error:.*forbidden/);
  assert.equal(await invRole(s, MAIL.E15), 'office_crew', '止めるまでメールでは入れてしまう');
  const c = await run(s, CHECK3);
  const row = c.rows.find(x => x.email === MAIL.E15);
  assert.equal(row.result, 'NG'); assert.match(row.note, /止める_ひな形/);
  const gmRows = (await rows(s)).filter(x => x.email === MAIL.gm);
  const g = await stop(s, MAIL.gm);
  assert.equal(g.ok, false); assert.match(g.err, /事務Crew のアカウントではありません/);
  assert.deepEqual((await rows(s)).filter(x => x.email === MAIL.gm), gmRows, 'GM はそのまま');
  assert.equal((await run(s, STOP)).ok, false, '書き換えていなければ止まる');
  const ok = await stop(s, MAIL.E15);
  assert.ok(ok.ok, ok.err);
  assert.equal((await rows(s)).find(x => x.email === MAIL.E15), undefined);
  assert.equal(await invRole(s, MAIL.E15), null, 'Invoice取込に入れない');
  assert.equal((await stop(s, MAIL.E15)).ok, false, '2 回目は止まる（もう無い）');
});

test('2b の一式：メール・名前の例は架空（example.com）だけ。手順が言うこと', () => {
  for (const [f, t] of [['①', CHECK1], ['②', ADD], ['③', CHECK3], ['止める', STOP]]) {
    const mails = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    assert.ok(mails.every(m => m === 'name@example.com'), f + ': ' + mails.join(','));
  }
  const h = read('手順.md');
  for (const w of ['Add user', 'Auto Confirm User', 'この端末で覚える', 'PIN が初期のまま', '共有のパソコン', '退職のときは必ず', 'GitHub・PR・共有の場所に書かない', '1_最初に確認_読むだけ.sql',
    '2_事務Crewのアカウントを足す_ひな形.sql', '3_確認_読むだけ.sql', '止める_ひな形.sql', 'メールの事務Crew と全く同じ', 'B-2'])
    assert.ok(h.includes(w), w);
});
