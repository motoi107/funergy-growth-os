// v1110: the Office save guard (web-office-cas.<sha256>.js) must not leave the main area frozen when opening
// the Office screen fails before anything is entered (for example native_web_cas_read answers 400).
// The real module is loaded in a VM with a stand-in window / document / host and a fetch that answers 400.
// Synthetic only: no network, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const refs = [...html.matchAll(/<script type="module" src="\.\/(web-office-cas\.([0-9a-f]{64})\.js)"><\/script>/g)];

test('index.html loads exactly one Office guard module, and its name is the sha256 of its content', () => {
  assert.equal(refs.length, 1);
  const buf = fs.readFileSync(new URL(refs[0][1], ROOT));
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), refs[0][2]);
});

function loadInstall() {
  const src = fs.readFileSync(new URL(refs[0][1], ROOT), 'utf8');
  const cut = src.indexOf('// work/owner-production-web-guard/web-entry-v2.mjs');
  assert.ok(cut > 0, 'entry marker');
  const ctx = vm.createContext({ TextEncoder, TextDecoder, URL, Headers, AbortController, Response, setTimeout, clearTimeout, console, structuredClone });
  vm.runInContext(src.slice(0, cut) + '\nglobalThis.__install = installWebOfficeGuard;', ctx);
  return ctx.__install;
}

function world({ canNavigate = true, status = 400 } = {}) {
  const el = { inert: false, innerHTML: '<div class="section-title">Skill Level 承認</div>' };
  const listeners = {};
  const toasts = [], calls = [];
  const win = {
    curPage: 'leadership', lssView: 'office', curRole: 'gm', curRealRole: 'gm', curUserName: 'Gm Sample', curStore: 'ALL', curStoreLogin: false,
    loginPerson: { id: 'e2' },
    getEmployees: () => [{ id: 'e2', name: 'Gm Sample', role: 'gm', status: '在籍' }],
    getStoresAll: () => [{ id: 'F01' }, { id: 'F02' }],
    supaHeaders: () => ({ apikey: 'anon', Authorization: 'Bearer anon' }),
    bizToday: () => '2026-10-29', ocsPeriodNow: () => '2026-Q4',
    showToast: (m) => toasts.push(String(m)),
    t: (ja) => ja,
    renderPage: () => {}, crypto: {}, localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {}, removeEventListener: () => {}, indexedDB: {},
  };
  const doc = { hidden: false, getElementById: (id) => (id === 'main-content' ? el : null), addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener: () => {}, createElement: () => ({}) };
  const host = {
    canNavigate: () => canNavigate, active: () => false, supports: () => false, inspect: () => ({ value: null }),
    prepare: async () => { calls.push('prepare'); }, mount: async () => { calls.push('mount'); },
    deactivate: async () => { calls.push('deactivate'); }, dispose: async () => {}, capture: () => {}, captureList: () => {},
  };
  const fetch = async () => { calls.push('fetch'); return new Response('{"code":"P0001"}', { status }); };
  const archive = { get: async () => null, put: async () => true, compareAndSet: async () => true, close: () => {} };
  return { el, win, doc, host, fetch, archive, toasts, calls };
}

async function openOffice(w) {
  const install = loadInstall();
  await install({ win: w.win, doc: w.doc, baseUrl: 'https://example.supabase.co/', fetch: w.fetch,
    archiveFactory: async () => w.archive, storageFactory: async () => ({}), createHost: () => w.host });
  let original = 0;
  const p = w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { original++; w.el.innerHTML = '<div>office page</div>'; });
  await p.catch(() => {});
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));   // the recovery runs on the queue after the failure
  return original;
}

test('server answers 400: the screen is not frozen, it shows the reason with try again / back', async () => {
  const w = world();
  const original = await openOffice(w);
  assert.equal(original, 0, 'the Office page was never drawn');
  assert.equal(w.el.inert, false, 'the main area can be used again');
  assert.match(w.el.innerHTML, /data-web-office-open-failed/);
  assert.match(w.el.innerHTML, /web_cas_http_400/);
  assert.match(w.el.innerHTML, /renderPage\(curPage\)/);
  assert.match(w.el.innerHTML, /setLssView\('score'\)/);
  assert.ok(w.calls.includes('fetch') && w.calls.includes('deactivate'));
  assert.ok(w.toasts.some((m) => m.includes('web_cas_http_400')));
});

test('inputs that are not saved yet: keep the old protection (stay frozen, nothing replaced)', async () => {
  const w = world({ canNavigate: false });
  await openOffice(w);
  assert.equal(w.el.inert, true);
  assert.match(w.el.innerHTML, /Skill Level/);
  assert.ok(!w.calls.includes('deactivate'));
});

test('the person already moved to another screen: unfreeze, but do not draw the card over it', async () => {
  const w = world();
  w.host.prepare = async () => { w.win.curPage = 'skill'; };
  await openOffice(w);
  assert.equal(w.el.inert, false);
  assert.doesNotMatch(w.el.innerHTML, /data-web-office-open-failed/);
});

test('English labels go through t()', async () => {
  const w = world();
  w.win.t = (ja, en) => en;
  await openOffice(w);
  assert.match(w.el.innerHTML, /Could not open the Office evaluation/);
  assert.match(w.el.innerHTML, /Back to Career Score/);
});
