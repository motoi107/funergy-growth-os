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

// Independent review of 337e779 (P2): the person leaves the Office screen from the side menu while it is still loading,
// the tab is hidden (switching apps), and then the load fails or comes back. The other screen must not stay frozen.
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

test('review P2: left for another screen while loading, tab hidden, then the load fails: the other screen is not frozen', async () => {
  const w = world();
  let answer; const gate = new Promise((r) => { answer = r; });
  w.fetch = async () => { w.calls.push('fetch'); await gate; return new Response('{"code":"P0001"}', { status: 400 }); };
  let vis = null;
  w.doc.addEventListener = (k, f) => { if (k === 'visibilitychange') vis = f; };
  const install = loadInstall();
  await install({ win: w.win, doc: w.doc, baseUrl: 'https://example.supabase.co/', fetch: w.fetch,
    archiveFactory: async () => w.archive, storageFactory: async () => ({}), createHost: () => w.host });
  const p = w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { w.el.innerHTML = '<div>office page</div>'; });
  p.catch(() => {});
  await settle();
  assert.equal(w.el.inert, true, 'frozen while loading (as before)');
  // the side menu is outside the main area: go('dashboard') draws the dashboard directly (nothing Office is mounted yet)
  w.win.curPage = 'dashboard';
  w.win.FUNERGY_WEB_OFFICE_RENDER('dashboard', () => { w.el.innerHTML = '<div>dashboard</div>'; });
  assert.match(w.el.innerHTML, /dashboard/);
  w.doc.hidden = true; vis && vis();          // switch apps
  answer(); await settle();
  assert.equal(w.el.inert, false, 'the dashboard can be used');
  assert.doesNotMatch(w.el.innerHTML, /data-web-office-open-failed/);
});

test('review P2: the tab is hidden before the queued load even starts, and the person is on another screen: not frozen', async () => {
  const w = world();
  let vis = null, release0; const hold = new Promise((r) => { release0 = r; });
  w.doc.addEventListener = (k, f) => { if (k === 'visibilitychange') vis = f; };
  w.host.prepare = async () => { await hold; w.calls.push('prepare'); };
  const install = loadInstall();
  await install({ win: w.win, doc: w.doc, baseUrl: 'https://example.supabase.co/', fetch: w.fetch,
    archiveFactory: async () => w.archive, storageFactory: async () => ({}), createHost: () => w.host });
  const p1 = w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => {}); p1.catch(() => {});
  const p2 = w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => {}); p2.catch(() => {});   // a second render waits behind the first
  w.win.curPage = 'dashboard';
  w.doc.hidden = true; vis && vis();
  release0(); await settle();
  assert.equal(w.el.inert, false);
  // v1111: an Office load that waited in the queue is still dropped quietly when the tab is hidden (no warning)
  assert.ok(!w.toasts.some((m) => m.includes('web_office_identity_required')), w.toasts.join(' | '));
});

test('review P2: still on the Office screen when the tab comes back: it stays as it was until the screen is drawn again (no card over it)', async () => {
  const w = world();
  let answer; const gate = new Promise((r) => { answer = r; });
  w.fetch = async () => { w.calls.push('fetch'); await gate; return new Response('{"code":"P0001"}', { status: 400 }); };
  let vis = null;
  w.doc.addEventListener = (k, f) => { if (k === 'visibilitychange') vis = f; };
  let redraws = 0; w.win.renderPage = () => { redraws++; };
  const install = loadInstall();
  await install({ win: w.win, doc: w.doc, baseUrl: 'https://example.supabase.co/', fetch: w.fetch,
    archiveFactory: async () => w.archive, storageFactory: async () => ({}), createHost: () => w.host });
  const p = w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => {}); p.catch(() => {});
  await settle();
  w.doc.hidden = true; vis && vis();
  answer(); await settle();
  assert.equal(w.el.inert, true, 'an Office screen is still showing: left for the redraw when the tab comes back');
  w.doc.hidden = false; vis && vis();
  assert.equal(redraws, 1, 'coming back draws the Office screen again');
});

test('review P3: Career Score view switched away from Office while loading: the card is not drawn over it', async () => {
  const w = world();
  w.host.prepare = async () => { w.calls.push('prepare'); w.win.lssView = 'score'; };
  await openOffice(w);
  assert.equal(w.el.inert, false);
  assert.doesNotMatch(w.el.innerHTML, /data-web-office-open-failed/);
});

// Codex re-review of cd11039 (P2): the Office screen had been shown once (so an Office context exists), it is being
// drawn again, the person leaves it, and the tab is hidden before the queue gets to the other screen.
// The other screen must still be drawn and usable when the tab comes back (it used to stay frozen and undrawn).
function okRows(body) {
  const rs = JSON.parse(body).p_routes;
  const emp = { id: 'e2', name: 'Gm Sample', role: 'gm', status: '在籍' };
  const rows = rs.map((r) => {
    if (r.table === 'employees') return { table: r.table, slot: r.slot, exists: true, version: 1, value: [emp], physical: [{ id: 'e2', data: emp }] };
    if (r.table === 'stores') { const s = [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }]; return { table: r.table, slot: r.slot, exists: true, version: 1, value: s, physical: s.map((d) => ({ id: d.id, data: d })) }; }
    return { table: r.table, slot: r.slot, exists: false, version: 0, value: null, physical: null };
  });
  return JSON.stringify({ schema: 1, rows });
}
async function shownOnce(w) {
  const mem = new Map();
  // values stay objects of the module's own realm (its copy() refuses objects from another realm)
  w.archive = { get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async () => true,
    compareAndSet: async (k, exp, v) => { const cur = mem.has(k) ? mem.get(k) : null; if (JSON.stringify(cur) !== JSON.stringify(exp)) return false; mem.set(k, v); return true; }, close: () => {} };
  w.win.crypto = crypto.webcrypto;
  let gate = null;
  w.fetch = async (url, init) => { w.calls.push('fetch'); if (gate) await gate; return new Response(okRows(init.body), { status: 200 }); };
  let vis = null;
  w.doc.addEventListener = (k, f) => { if (k === 'visibilitychange') vis = f; };
  const install = loadInstall();
  const guard = await install({ win: w.win, doc: w.doc, baseUrl: 'https://example.supabase.co/', fetch: w.fetch,
    archiveFactory: async () => w.archive, storageFactory: async () => ({}), createHost: () => w.host });
  await w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { w.el.innerHTML = '<div>office page</div>'; });
  await settle();
  assert.ok(guard.inspect().context, 'the Office screen was shown (an Office context exists)');
  assert.equal(w.el.inert, false);
  let open; gate = new Promise((r) => { open = r; });
  const again = w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { w.el.innerHTML = '<div>office page</div>'; });
  again.catch(() => {});
  await settle();
  assert.equal(w.el.inert, true, 'frozen while it is drawn again (as before)');
  return { guard, hide: () => { w.doc.hidden = true; vis(); }, show: () => { w.doc.hidden = false; vis(); }, open: () => open() };
}

test('Codex P2 (cd11039): shown once, drawn again, another screen asked for, tab hidden: the other screen is drawn and usable', async () => {
  const w = world();
  const s = await shownOnce(w);
  w.win.curPage = 'dashboard';
  let drawn = 0;
  w.win.FUNERGY_WEB_OFFICE_RENDER('dashboard', () => { drawn++; w.el.innerHTML = '<div>dashboard</div>'; }).catch(() => {});
  s.hide();
  s.open(); await settle();
  s.show(); await settle();
  assert.equal(drawn, 1, 'the dashboard is drawn');
  assert.match(w.el.innerHTML, /dashboard/);
  assert.equal(w.el.inert, false, 'the dashboard can be used');
  assert.equal(s.guard.inspect().context, null, 'the Office context is let go');
});

test('Codex P2 (cd11039): Career Score switched from the Office tab to another tab, tab hidden: the other tab is drawn', async () => {
  const w = world();
  const s = await shownOnce(w);
  w.win.lssView = 'score';
  let drawn = 0;
  w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { drawn++; w.el.innerHTML = '<div>score tab</div>'; }).catch(() => {});
  s.hide();
  s.open(); await settle();
  s.show(); await settle();
  assert.equal(drawn, 1);
  assert.match(w.el.innerHTML, /score tab/);
  assert.equal(w.el.inert, false);
});

test('Codex P2 (cd11039): two screens asked for while hidden: only the newest one is drawn', async () => {
  const w = world();
  const s = await shownOnce(w);
  const drawn = [];
  w.win.curPage = 'dashboard';
  w.win.FUNERGY_WEB_OFFICE_RENDER('dashboard', () => { drawn.push('dashboard'); }).catch(() => {});
  s.hide();
  w.win.curPage = 'skill';
  w.win.FUNERGY_WEB_OFFICE_RENDER('skill', () => { drawn.push('skill'); w.el.innerHTML = '<div>skill</div>'; }).catch(() => {});
  s.open(); await settle();
  assert.deepEqual(drawn, ['skill']);
  assert.equal(w.el.inert, false);
});

test('Codex P2 (cd11039): inputs that are not saved yet: the other screen is still not drawn over them (old protection)', async () => {
  const w = world();
  const s = await shownOnce(w);
  w.host.canNavigate = () => false;
  w.win.curPage = 'dashboard';
  let drawn = 0;
  w.win.FUNERGY_WEB_OFFICE_RENDER('dashboard', () => { drawn++; }).catch(() => {});
  s.hide();
  s.open(); await settle();
  s.show(); await settle();
  assert.equal(drawn, 0);
  assert.equal(w.el.inert, true);
});

test('after the fix: a non-Office screen whose clean-up fails is still drawn (nothing unsaved)', async () => {
  const w = world();
  const s = await shownOnce(w);
  s.open(); await settle();
  assert.ok(s.guard.inspect().context, 'drawn again');
  let n = 0;
  w.host.deactivate = async () => { n++; if (n === 1) throw Error('office_root_busy'); };
  w.win.curPage = 'dashboard';
  let drawn = 0;
  w.win.FUNERGY_WEB_OFFICE_RENDER('dashboard', () => { drawn++; w.el.innerHTML = '<div>dashboard</div>'; }).catch(() => {});
  await settle();
  assert.equal(drawn, 1);
  assert.equal(w.el.inert, false);
  assert.doesNotMatch(w.el.innerHTML, /data-web-office-open-failed/);
  // and the queue keeps working afterwards
  w.win.curPage = 'leadership';
  let office = 0;
  await w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { office++; });
  await settle();
  assert.equal(office, 1);
  assert.equal(w.el.inert, false);
});

test('Codex P2 (cd11039): tab hidden, then the clean-up for the other screen fails once: it is still drawn', async () => {
  const w = world();
  const s = await shownOnce(w);
  let boom = false;
  w.host.deactivate = async () => { w.calls.push('deactivate'); if (boom) { boom = false; throw Error('office_root_busy'); } };
  w.win.curPage = 'dashboard';
  let drawn = 0;
  w.win.FUNERGY_WEB_OFFICE_RENDER('dashboard', () => { drawn++; w.el.innerHTML = '<div>dashboard</div>'; }).catch(() => {});
  s.hide();
  boom = true;
  s.open(); await settle();
  assert.equal(drawn, 1);
  assert.equal(w.el.inert, false);
});

test('Codex P2 (cd11039): the clean-up fails and the Career Score view went back to Office meanwhile: the other tab is not drawn', async () => {
  const w = world();
  const s = await shownOnce(w);
  s.open(); await settle();
  w.host.deactivate = async () => { w.calls.push('deactivate'); w.win.lssView = 'office'; throw Error('office_root_busy'); };
  w.win.lssView = 'score';
  let drawn = 0;
  w.win.FUNERGY_WEB_OFFICE_RENDER('leadership', () => { drawn++; }).catch(() => {});
  await settle();
  assert.equal(drawn, 0);
});
