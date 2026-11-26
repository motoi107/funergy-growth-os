import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const PROD_URL = 'https://tgbhgxzehzeouopklhje.supabase.co';
const PROD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnYmhneHplaHplb3VvcGtsaGplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTIzODAsImV4cCI6MjA5NjY4ODM4MH0.A0cdXLDONy_HPvQhaHbfP-flsNYImg0ZFJd5AIQihdM';
const DEMO_URL = 'https://wjujeonfmjwvliunotuc.supabase.co';
const DEMO_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdWplb25mbWp3dmxpdW5vdHVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2NTg2MDQsImV4cCI6MjExMTIzNDYwNH0.BUiXEu2bPszkVKfTs8mG-LlJhzrb-wtktUU70aXFOQo';

function reviewBlock() {
  const a = html.indexOf('/* v1219 review demo start');
  const b = html.indexOf('/* v1219 review demo end */');
  assert.ok(a >= 0 && b > a, 'review demo block');
  return html.slice(a, b);
}

function bootLoginSource() {
  const i = html.indexOf('function bootLogin() {');
  assert.ok(i >= 0);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) break;
  }
  return html.slice(i, j + 1);
}

function run(flag, extra) {
  const store = new Map();
  if (flag) store.set('fg_env', flag);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] || null,
    get length() { return store.size; },
  };
  const session = new Map();
  const msg = { textContent: '', style: { display: 'none' } };
  const banner = { style: { display: 'none' } };
  const toasts = [];
  const ctx = {
    localStorage,
    sessionStorage: { clear() { session.clear(); } },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById(id) {
        if (id === 'fg-review-msg') return msg;
        if (id === 'fg-review-banner') return banner;
        return null;
      },
    },
    window: {},
    setTimeout(fn) { if (typeof fn === 'function') fn(); },
    location: { reload() { ctx.reloaded = true; } },
    showToast(m) { toasts.push(m); },
    t: (ja) => ja,
    msg, banner, toasts, reloaded: false,
  };
  Object.assign(ctx, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(reviewBlock() + '\nthis.SUPABASE_URL=SUPABASE_URL; this.SUPABASE_ANON=SUPABASE_ANON; this.fgReviewDemo=fgReviewDemo; this.fgReviewHidden=fgReviewHidden; this.fgReviewSwitch=fgReviewSwitch; this.fgReviewPending=fgReviewPending;', ctx);
  ctx.store = store;
  return ctx;
}

test('印が無いときは本番の URL と anon', () => {
  const c = run(null);
  assert.equal(c.SUPABASE_URL, PROD_URL);
  assert.equal(c.SUPABASE_ANON, PROD_ANON);
  assert.equal(c.fgReviewDemo(), false);
  assert.equal(c.fgReviewHidden('invoice'), false);
  assert.equal(c.fgReviewHidden('mypage'), false);
  assert.equal((html.match(/var FG_PROD_ANON = '([^']+)'/) || [])[1], PROD_ANON);
  assert.equal((html.match(/var FG_PROD_URL = '([^']+)'/) || [])[1], PROD_URL);
  assert.ok(html.includes(PROD_URL));
  assert.match(html, /var LS_DEVICE_LOCAL = \[[^\]]*'fg_env'/);
  assert.equal((html.match(/const APP_VERSION = '(\d+)';/) || [])[1], '1220');
  assert.equal((sw.match(/const SW_BUILD = '(\d+)';/) || [])[1], '1220');
});

test('fg_env=review のときだけ審査用の URL と anon', () => {
  const c = run('review');
  assert.equal(c.SUPABASE_URL, DEMO_URL);
  assert.equal(c.SUPABASE_ANON, DEMO_ANON);
  assert.equal(c.fgReviewDemo(), true);
  assert.equal(c.fgReviewHidden('invoice'), true);
  assert.equal(c.fgReviewHidden('dashboard'), true);
  assert.equal(c.fgReviewHidden('mypage'), false);
  assert.equal(c.fgReviewHidden('shift_admin'), false);
  assert.equal(c.fgReviewHidden('chat'), false);
});

test('デモでは組み込みの店・業者・名前を空にする', () => {
  for (const name of ['DEFAULT_STORES', 'DEFAULT_VENDORS', 'DEFAULT_EMPLOYEES']) {
    const line = `if (fgReviewDemo()) ${name}.splice(0, ${name}.length);`;
    assert.equal((html.match(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, name);
  }
  function emptied(on) {
    const ctx = { fgReviewDemo: () => on, DEFAULT_STORES: [{ id: 'F01', name: 'Real Store' }], DEFAULT_VENDORS: [{ id: 'vi1', name: 'Real Vendor' }], DEFAULT_EMPLOYEES: [{ id: 'e1', name: 'Real Person' }] };
    vm.createContext(ctx);
    vm.runInContext([
      "if (fgReviewDemo()) DEFAULT_STORES.splice(0, DEFAULT_STORES.length);",
      "if (fgReviewDemo()) DEFAULT_VENDORS.splice(0, DEFAULT_VENDORS.length);",
      "if (fgReviewDemo()) DEFAULT_EMPLOYEES.splice(0, DEFAULT_EMPLOYEES.length);",
    ].join('\n'), ctx);
    return ctx;
  }
  const demo = emptied(true);
  assert.equal(demo.DEFAULT_STORES.length, 0);
  assert.equal(demo.DEFAULT_VENDORS.length, 0);
  assert.equal(demo.DEFAULT_EMPLOYEES.length, 0);
  const prod = emptied(false);
  assert.equal(prod.DEFAULT_STORES.length, 1);
  assert.equal(prod.DEFAULT_VENDORS[0].name, 'Real Vendor');
  assert.equal(prod.DEFAULT_EMPLOYEES[0].name, 'Real Person');
  assert.ok(html.includes("name:'ToriTon'"));
});

test('ログインの Office の隣に審査用、デモでは帯と本番に戻る', () => {
  assert.ok(html.includes('id="fg-review-banner"'));
  assert.ok(html.includes('Demo / 審査用 — fake data'));
  assert.ok(html.includes('id="fg-review-back"'));
  assert.ok(html.includes('Return to production / 本番に戻る'));
  assert.ok(html.includes('fgReviewSwitch(false)'));
  const boot = bootLoginSource();
  const office = boot.indexOf('>Office</div>');
  const demo = boot.indexOf('審査用（デモ）');
  assert.ok(office >= 0 && demo > office);
  assert.ok(boot.includes('officeCard + demoCard + blankCard'));
  assert.match(boot, /function bootLogin\(\) \{[\s\S]{0,2600}FUNERGY_PK\.paintEntry\(\)/);
  assert.match(boot, /function bootLogin\(\) \{[\s\S]{0,2400}FUNERGY_DL\.paintEntry\(\)/);
  const shown = run('review');
  vm.runInContext('fgReviewPaint();', shown);
  assert.equal(shown.banner.style.display, 'block');
  const hidden = run(null);
  vm.runInContext('fgReviewPaint();', hidden);
  assert.equal(hidden.banner.style.display, 'none');
});

test('送っていない保存があると切り替えない', async () => {
  const blocked = run(null, { _outboxGet: () => [{ key: 'x' }], confirm() { throw new Error('confirm'); } });
  blocked.localStorage.setItem('m_stores', '[{"id":"F01"}]');
  assert.equal(blocked.fgReviewSwitch(true), false);
  assert.equal(blocked.store.has('fg_env'), false);
  assert.equal(blocked.store.get('m_stores'), '[{"id":"F01"}]');
  assert.match(blocked.msg.textContent, /送っていない保存があるので、切り替えません/);
  assert.equal(blocked.toasts.length, 1);
  assert.equal(blocked.reloaded, false);

  const dirty = run(null, { empDirtyCount: () => 2, confirm() { throw new Error('confirm'); } });
  assert.equal(dirty.fgReviewSwitch(true), false);
  assert.equal(dirty.store.has('fg_env'), false);

  const plans = run(null, { shiftPlanPendingList: () => [{ id: 1 }], confirm() { throw new Error('confirm'); } });
  assert.equal(plans.fgReviewSwitch(true), false);
  assert.equal(plans.store.has('fg_env'), false);

  const clean = run(null, { _outboxGet: () => [], empDirtyCount: () => 0, shiftPlanPendingList: () => [], confirm: () => true });
  clean.localStorage.setItem('m_employees', '[{"name":"kept"}]');
  clean.localStorage.setItem('cur_lang', 'ja');
  assert.equal(await clean.fgReviewSwitch(true), true);
  assert.equal(clean.store.get('fg_env'), 'review');
  assert.equal(clean.store.has('m_employees'), false);
  assert.equal(clean.store.has('cur_lang'), false);
  assert.equal(clean.reloaded, true);

  const back = run('review', { confirm: () => false });
  assert.equal(await back.fgReviewSwitch(false), false);
  assert.equal(back.store.get('fg_env'), 'review');

  const returned = run('review', { confirm: () => true });
  returned.localStorage.setItem('m_stores', '[{"id":"D01"}]');
  assert.equal(await returned.fgReviewSwitch(false), true);
  assert.equal(returned.store.has('fg_env'), false);
  assert.equal(returned.store.has('m_stores'), false);
  assert.equal(returned.reloaded, true);
});
