// work-requests: ワークセンターの申請の API（v1131・1 段目＝経費 3 種／v1132・2 段目＝評価の変更 3 種と表示設定／v1133・反映の押さえ／v1155・段階 2＝予算と前の承認タブの種類／v1156・チャット／v1161・チャットの添付）。
// 仕様：docs/WORK_REQUESTS_V1131_JA.md・docs/WORK_REQUESTS_V1132_JA.md・docs/WORK_REQUESTS_V1133_JA.md・docs/WORKCENTER_APPROVALS_STAGE2_JA.md・docs/CHAT_V1156_JA.md・docs/CHAT_FILES_V1161_JA.md
// 入り方は PIN のログインの印だけ（deps.verifyPin が確かめて { emp_id, name } を返す）。アプリが送る役割・名前・承認した人は使わない。
// 役割・店・できることは SQL（wr_actor・wr_actions）が決める。この関数は形を整えて渡すだけ。

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^(wr|chat)_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 400)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

// v1161：チャットの添付の置き場所（Storage の非公開の置き場所 chat-files）。サーバーの鍵だけで触る。
// アプリには 1 回だけ使える上げる先（signUpload）と、5 分だけ使える読む先（signDownload）を渡す。中身の先頭の印と大きさは head で確かめる。
export const FILE_BUCKET = 'chat-files';
export function storageApi({ fetch, url, key, bucket = FILE_BUCKET }) {
  const h = { apikey: key, authorization: 'Bearer ' + key };
  const base = `${url}/storage/v1`;
  const P = path => { if (typeof path !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}(\.t)?$/.test(path)) throw new Error('bad_path'); return path; };
  const fail = async (r, what) => { const t = await r.text().catch(() => ''); const e = new Error('storage ' + what + ' ' + r.status + ' ' + t.slice(0, 120)); e.storage = r.status; throw e; };
  return {
    // 1 回だけ使える上げる先（アプリが PUT する）。もう中身があれば上げると断られる（アプリは「もうある」として次へ）
    async signUpload(path) {
      const r = await fetch(`${base}/object/upload/sign/${bucket}/${P(path)}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) await fail(r, 'sign_upload');
      const j = await r.json();
      const u = new URL(base + j.url), token = u.searchParams.get('token');
      if (!token) throw new Error('storage sign_upload no token');
      return { url: u.toString(), token };
    },
    // 5 分だけ使える読む先。download に名前を入れると保存（content-disposition: attachment）
    async signDownload(paths, { expires = 300, download = null } = {}) {
      const r = await fetch(`${base}/object/sign/${bucket}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: expires, paths: paths.map(P) }) });
      if (!r.ok) await fail(r, 'sign');
      const arr = await r.json(), out = {};
      for (const x of Array.isArray(arr) ? arr : []) {
        if (!x || x.error || !x.signedURL || typeof x.path !== 'string') continue;
        out[x.path] = base + x.signedURL + (download ? '&download=' + encodeURIComponent(download) : '');
      }
      return out;
    },
    // 先頭の 16 バイトと全体の大きさ（無ければ null）
    async head(path) {
      const r = await fetch(`${base}/object/authenticated/${bucket}/${P(path)}`, { method: 'GET', headers: { ...h, range: 'bytes=0-15' } });
      if (r.status === 404 || r.status === 400) { await r.text().catch(() => ''); return null; }
      if (!(r.status === 206 || r.status === 200)) await fail(r, 'head');
      const buf = new Uint8Array(await r.arrayBuffer());
      let size = null;
      const cr = r.headers.get('content-range');
      if (r.status === 206 && cr) { const m = /\/(\d+)\s*$/.exec(cr); if (m) size = Number(m[1]); }
      if (size == null && r.status === 200) size = buf.length;
      if (size == null) { const cl = Number(r.headers.get('content-length')); if (r.status === 200 && Number.isFinite(cl)) size = cl; }
      return { bytes: buf.slice(0, 16), size };
    },
    async remove(paths) {
      if (!paths.length) return;
      const r = await fetch(`${base}/object/${bucket}`, { method: 'DELETE', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths.map(P) }) });
      if (!r.ok) await fail(r, 'remove');
      await r.text().catch(() => '');
    },
  };
}

// 中身の先頭の印（名前だけ .pdf にした別のファイルは断る）
const startsWith = (b, sig) => sig.every((v, i) => b[i] === v);
const MAGIC = { jpg: [[0xff, 0xd8, 0xff]], pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], xlsx: [[0x50, 0x4b, 0x03, 0x04]], docx: [[0x50, 0x4b, 0x03, 0x04]], pptx: [[0x50, 0x4b, 0x03, 0x04]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], doc: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], ppt: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] };
const BINARY = [[0xff, 0xd8, 0xff], [0x25, 0x50, 0x44, 0x46], [0x50, 0x4b, 0x03, 0x04], [0xd0, 0xcf, 0x11, 0xe0], [0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x89, 0x50, 0x4e, 0x47], [0x47, 0x49, 0x46, 0x38], [0x1f, 0x8b]];
export function sniffOk(ext, bytes) {
  if (!bytes || !bytes.length) return false;
  if (ext === 'csv' || ext === 'txt') {   // 文字：NUL が無く、ほかの形の印で始まらない
    if (bytes.some(x => x === 0)) return false;
    return !BINARY.some(sig => startsWith(bytes, sig));
  }
  const sigs = MAGIC[ext];
  return !!sigs && sigs.some(sig => startsWith(bytes, sig));
}
export const FILE_EXTS = ['jpg', 'pdf', 'xlsx', 'xls', 'csv', 'docx', 'doc', 'pptx', 'ppt', 'txt'];
export const FILE_MAX = { count: 5, size: 10485760, thumb: 1048576 };

const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer)[^\s]*/gi, '$1:***').slice(0, 200);
const bad = () => { const e = new Error('bad_value'); e.code = 'bad_value'; return e; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// 文字は黙って切らない（長すぎれば断る・画面も同じ長さで止める）
const TS = (v, n) => { if (v == null) return ''; if (typeof v !== 'string') throw bad(); const x = v.replace(CTRL, '').trim(); if (x.length > n) throw bad(); return x; };
const isDate = v => {
  if (typeof v !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
const DT = v => { if (!isDate(v)) throw bad(); return v; };
const DTO = v => (v == null || v === '' ? '' : DT(v));
const CENTS = v => { if (!Number.isInteger(v) || v <= 0 || v > 100000000) throw bad(); return v; };
const KEY = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(v)) throw bad(); return v; };
const STORE = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_\-]{1,30}$/.test(v)) throw bad(); return v; };
const REV = v => { if (!Number.isInteger(v) || v < 1 || v > 1e9) throw bad(); return v; };
const ID = v => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null);
const CODE = v => (typeof v === 'string' && /^[A-Z]{2}-\d{4}-\d{4,6}$/.test(v) ? v : null);

export const KINDS = ['mileage', 'reimburse', 'expense_pre'];
// v1132：評価の変更（G4 → GM）。スキル Lv・Career Score・Tip Rate
export const EVAL_KINDS = ['skill', 'cs', 'tiprate'];
// v1155：段階 2。前の「承認」タブの種類と予算（前の画面で申請したとき、その記録をここに写す）
export const S2_KINDS = ['budget', 'leave', 'shift', 'hire', 'resign', 'promo', 'tip_self', 'skill_self', 'prep', 'plan'];
export const ALL_KINDS = [...KINDS, ...EVAL_KINDS, ...S2_KINDS];
export const TIP_RATES = [80, 90, 100];
const EMP = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(v)) throw bad(); return v; };
// v1156：チャット
export const CHAT = { body: 2000, title: 60, reason: 200, members: 49, mentions: 50 };
const TID = v => { const x = ID(v); if (!x) throw bad(); return x; };
const SEQ = v => { if (!Number.isInteger(v) || v < 0 || v > 1e12) throw bad(); return v; };
const EMPS = (v, min, max) => { if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(); return [...new Set(v.map(EMP))]; };
// 本文：空・長すぎは断る（黙って切らない）。改行は残す
const BODY = v => { if (typeof v !== 'string') throw bad(); const x = v.replace(CTRL, '').trim(); if (!x || x.length > CHAT.body) throw bad(); return x; };
// v1161：ファイルのあるメッセージは本文が空でもよい
const BODY_OPT = v => { if (v == null) return ''; if (typeof v !== 'string') throw bad(); const x = v.replace(CTRL, '').trim(); if (x.length > CHAT.body) throw bad(); return x; };
const FILES = v => { if (v == null) return []; if (!Array.isArray(v) || v.length > FILE_MAX.count) throw bad(); const o = v.map(TID); if (new Set(o).size !== o.length) throw bad(); return o; };
const MENTIONS = v => (v == null ? [] : EMPS(v, 0, CHAT.mentions));
const LV = (v, max, nullable) => { if (v == null && nullable) return null; if (!Number.isInteger(v) || v < 0 || v > max) throw bad(); return v; };
const NUMN = (v, max) => { if (v == null) return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw bad(); return Math.round(v * 100) / 100; };
export const MILEAGE_PURPOSES = ['買い出し', 'ミーティング', '銀行・郵便', '店舗間移動', 'その他'];
export const LIMITS = { text: 200, long: 600, note: 400, method: 60, name: 80 };

// 申請の中身（種類ごとに決まった欄だけ。ほかは捨てる）
export function normPayload(kind, p) {
  p = obj(p);
  const L = LIMITS;
  if (kind === 'mileage') {
    const miles = p.one_way_miles;
    if (typeof miles !== 'number' || !Number.isFinite(miles) || miles <= 0 || miles > 1000) throw bad();
    const purpose = TS(p.purpose, 40);
    if (!MILEAGE_PURPOSES.includes(purpose)) throw bad();
    return { date: DT(p.date), purpose, origin: TS(p.origin, L.text), destination: TS(p.destination, L.text), one_way_miles: Math.round(miles * 10) / 10,
      round_trip: p.round_trip === true, memo: TS(p.memo, L.long) };
  }
  if (kind === 'reimburse') {
    const payer = TS(p.payer, L.name), vendor = TS(p.vendor, L.text);
    if (!payer || !vendor) throw bad();
    const rc = obj(p.receipt);
    const path = TS(rc.path, 300), drive = TS(rc.drive_url, 400);
    if (path && !/^[A-Za-z0-9_\-./]+$/.test(path)) throw bad();
    if (drive && !/^https:\/\/(drive|docs)\.google\.com\//.test(drive)) throw bad();
    // v1161（8B）：申請のチャットの写真・PDF を領収書にしたもの。開けるのはこの申請に結んだファイルだけ（SQL の wr_receipt_file が確かめる）
    const cf = rc.chat_file == null || rc.chat_file === '' ? null : TID(rc.chat_file);
    let receipt = path || drive ? { path, drive_url: drive } : null;
    if (cf) receipt = { chat_file: cf, name: TS(rc.name, 120), kind: rc.kind === 'pdf' ? 'pdf' : 'photo' };
    return { date: DT(p.date), payer, payer_is_employee: p.payer_is_employee === true, vendor, purpose: TS(p.purpose, 40), purpose_memo: TS(p.purpose_memo, L.long),
      amount_cents: CENTS(p.amount_cents), receipt, memo: TS(p.memo, L.long) };
  }
  if (kind === 'expense_pre') {
    const purpose = TS(p.purpose, L.text);
    if (!purpose) throw bad();
    const pp = p.per_person_cents == null ? null : CENTS(p.per_person_cents);
    const n = p.participants == null ? null : (Number.isInteger(p.participants) && p.participants > 0 && p.participants <= 1000 ? p.participants : (() => { throw bad(); })());
    return { date: DT(p.date), dept: TS(p.dept, 60), project: TS(p.project, L.text), purpose, description: TS(p.description, L.long), location: TS(p.location, L.text),
      participants: n, per_person_cents: pp, total_cents: CENTS(p.total_cents), memo: TS(p.memo, L.long) };
  }
  // v1132：評価の変更。対象の人・今の値 → 申請する値・理由（必ず）。対象・店・グレードはサーバー（wr_norm_eval）がもう一度確かめる。
  if (EVAL_KINDS.includes(kind)) {
    const reason = TS(p.reason, L.long);
    if (!reason) throw bad();
    const base = { target_emp: EMP(p.target_emp), target_name: TS(p.target_name, L.name), reason };
    if (kind === 'tiprate') {
      if (!TIP_RATES.includes(p.rate_to)) throw bad();
      return { ...base, rate_from: LV(p.rate_from, 100, true), rate_to: p.rate_to, from_day: DT(p.from_day) };
    }
    const max = kind === 'skill' ? 30 : 200, top = kind === 'skill' ? 5 : 3;
    if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > max) throw bad();
    const seen = new Set();
    const items = p.items.map(x => {
      x = obj(x);
      const k = kind === 'skill' ? TS(x.pos, 60) : TS(x.key, 40);
      if (!k || seen.has(k)) throw bad();
      seen.add(k);
      const from = LV(x.from, top, true), to = LV(x.to, top, kind === 'cs');   // Career Score は「未採点に戻す」（null）もある
      return kind === 'skill' ? { pos: k, from, to } : { key: k, label: TS(x.label, 120), from, to };
    });
    if (kind === 'skill') return { ...base, items };
    const lss = TS(p.lss_req, 80);
    if (!lss || !/^[A-Za-z0-9_.:-]+$/.test(lss)) throw bad();
    return { ...base, items, lss_req: lss, quarter: TS(p.quarter, 20), total_from: NUMN(p.total_from, 10000), total_to: NUMN(p.total_to, 10000) };
  }
  // v1155：段階 2。前の画面の記録の写し（見出し・申請した人・表示用の項目）。正式な値は今までどおりアプリの共通データ。
  // 予算は月の売上予算の合計（セント）と日ごと（セント）も。中身はサーバー（wr_s2_norm）がもう一度確かめる。
  if (S2_KINDS.includes(kind)) {
    if (typeof p.ap_id !== 'string' || !/^ap\d{6,20}$/.test(p.ap_id)) throw bad();
    const title = TS(p.title, L.text);
    if (!title) throw bad();
    const out = { ap_id: p.ap_id, title, from_name: TS(p.from_name, L.name), target_name: TS(p.target_name, L.name), store_name: TS(p.store_name, L.name),
      detail: TS(p.detail, L.long) };
    // 前の画面の記録の ref（表示だけ・形が違えば落とす）
    if (typeof p.ref === 'string' && /^[A-Za-z0-9_.:@-]{1,80}$/.test(p.ref)) out.ref = p.ref;
    if (p.facts != null) {
      if (!Array.isArray(p.facts) || p.facts.length > 12) throw bad();
      out.facts = p.facts.map(x => { x = obj(x); const k = TS(x.k, 40), v = TS(x.v, L.text); if (!k) throw bad(); return { k, v }; });
    }
    const ym = p.ym == null || p.ym === '' ? null : (typeof p.ym === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(p.ym) ? p.ym : (() => { throw bad(); })());
    if ((kind === 'budget' || kind === 'plan') && !ym) throw bad();
    if (ym) out.ym = ym;
    if (kind === 'budget') {
      const t = p.total_cents;
      if (!Number.isInteger(t) || t < 0 || t > 100000000000) throw bad();
      out.total_cents = t;
      if (p.days != null) {
        const d = obj(p.days), ks = Object.keys(d);
        if (ks.length > 31) throw bad();
        out.days = {};
        for (const k of ks) {
          if (!isDate(k) || k.slice(0, 7) !== ym) throw bad();
          const v = d[k];
          if (!Number.isInteger(v) || v < 0 || v > 10000000000) throw bad();
          out.days[k] = v;
        }
      }
      out.basis = TS(p.basis, L.text); out.focus = TS(p.focus, L.long);
    }
    if (kind === 'prep' && p.from_day != null && p.from_day !== '') out.from_day = DT(p.from_day);
    return out;
  }
  throw bad();
}

// v1133：評価の変更の反映は apply_start（押さえる）→ 書く → apply_done／apply_fail／apply_cancel（押さえたときの鍵 claim が要る）。前の版の apply は SQL が断る
export const ACTS = ['edit', 'resubmit', 'withdraw', 'approve', 'return', 'reject', 'check', 'pay', 'dup_ok', 'undo', 'apply_start', 'apply_done', 'apply_fail', 'apply_cancel'];
const CLAIMED = ['apply_done', 'apply_fail', 'apply_cancel'];

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const storage = deps.storage || storageApi({ fetch, url, key: service });
  const waitUntil = typeof deps.waitUntil === 'function' ? deps.waitUntil : null;
  // あと片づけ（消したメッセージのファイル・送らなかったファイル）。答えを待たせない（関数の実行環境があれば裏で）
  const later = fn => {
    const q = Promise.resolve().then(fn).catch(e => console.error('work-requests files cleanup', safeErr(e)));
    if (waitUntil) { try { waitUntil(q); return undefined; } catch { /* 下で待つ */ } }
    return q;
  };
  async function purge(limit) {
    let r;
    try { r = await db.rpc('chat_file_purge_list', { limit }); }
    catch (e) {   // 添付の SQL がまだ（関数が無い）なら消すものも無い
      if (e && (e.status === 404 || /chat_file_purge_list|does not exist|Could not find the function|42883/.test(String(e.message || '')))) return 0;
      throw e;
    }
    const files = (r && Array.isArray(r.files)) ? r.files : [];
    if (!files.length) return 0;
    await storage.remove(files.flatMap(f => (f.thumb ? [f.path, f.path + '.t'] : [f.path])));   // 失敗したら消しかけのまま（10 分後にもう一度）
    await db.rpc('chat_file_purged', { ids: files.map(f => f.id) });
    return files.length;
  }
  const fileErr = code => { const e = new Error(code); e.code = code; return e; };
  // 上げたものを確かめる（先頭の印・大きさ・写真は小さい写真も）。まだ無ければ file_missing（アプリが上げ直す）
  async function verifyFile(w, f) {
    const main = await storage.head(f.path);
    if (!main) throw fileErr('file_missing');
    let ok = main.size != null && main.size > 0 && main.size <= FILE_MAX.size && sniffOk(f.ext, main.bytes), reason = ok ? '' : 'content';
    if (ok && f.thumb_path) {
      const th = await storage.head(f.thumb_path);
      if (!th) throw fileErr('file_missing');
      if (!(th.size != null && th.size > 0 && th.size <= FILE_MAX.thumb && sniffOk('jpg', th.bytes))) { ok = false; reason = 'thumb'; }
    }
    await db.rpc('chat_file_mark', { ...w, id: f.id, ok, size: ok ? main.size : null, reason: ok ? null : reason });
    if (!ok) throw fileErr('file_bad');
  }
  const verifyPin = typeof deps.verifyPin === 'function' ? deps.verifyPin : null;
  const origins = ['https://funergy-plus.com', ...String(env('WR_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];

  // 呼んだ人：本文の pin_session（auth-pin が出した印）だけ。メールのログインは使わない（アプリは PIN だけ）。
  async function actorOf(body) {
    const tok = body.pin_session;
    if (tok === undefined || tok === null || tok === '') return { deny: 'none' };
    if (!verifyPin) { const e = new Error('pin_check_missing'); e.code = 'pin_check_missing'; throw e; }
    if (typeof tok !== 'string' || tok.length > 4000) return { deny: 'pin_shape' };
    let who = null;
    try { who = await verifyPin(tok); } catch { return { deny: 'pin_check_error' }; }
    if (!who || typeof who !== 'object') return { deny: 'pin_mark' };
    const emp_id = typeof who.emp_id === 'string' && who.emp_id && who.emp_id.length <= 64 ? who.emp_id : null;
    const name = typeof who.name === 'string' && who.name.trim() && who.name.length <= 80 ? who.name : null;
    // 社員 ID の無い印（auth-pin v1085 より前の名前だけの印）は断る。名前は社員の表（公開の鍵で書ける）で引くことになるため（独立レビュー 272b159 の B）。
    // v1085 からの印には社員 ID が入る。前の印は期限（14 日）を過ぎている。
    if (!emp_id) return { deny: 'pin_no_emp' };
    return { emp_id, name };
  }

  const ref = b => { const id = ID(b.id), code = CODE(b.code); if (!id && !code) throw bad(); return id ? { id } : { code }; };
  const ACTIONS = {
    // fn：関数の版（v1132 は 2・v1133 から 3・v1155 から 4＝段階 2 の種類を受ける）・sql：SQL の段（2 段目の SQL が無ければ 1・反映の押さえ（v1133）が無ければ 2）。アプリは評価の変更が断られたとき、これで前の版かを見分ける
    // v1156 から fn 5（チャット）・chat：チャットの SQL が入っていれば 1（添付の SQL があれば 2）。v1159 から fn 6（段階 3 の s3_import）。v1161 から fn 7（添付）
    whoami: async w => {
      const [me, st, cs] = await Promise.all([db.rpc('wr_whoami', w), db.rpc('wr_stage', {}).catch(() => null), db.rpc('chat_stage', {}).catch(() => null)]);
      return { ...me, fn: 7, sql: (st && Number.isInteger(st.stage)) ? st.stage : 1, chat: (cs && Number.isInteger(cs.chat)) ? cs.chat : 0 };
    },
    list: (w, b) => {
      const scope = ['todo', 'mine', 'team'].includes(b.scope) ? b.scope : 'todo';
      const state = ['open', 'closed', 'all'].includes(b.state) ? b.state : 'open';
      const kind = b.kind == null || b.kind === '' ? null : (ALL_KINDS.includes(b.kind) ? b.kind : (() => { throw bad(); })());
      const store = b.store == null || b.store === '' ? null : STORE(b.store);
      const limit = Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 1000 ? b.limit : 300;
      return db.rpc('wr_list', { ...w, scope, state, kind, store, from: DTO(b.from), to: DTO(b.to), limit });
    },
    get: (w, b) => db.rpc('wr_get', { ...w, ...ref(b) }),
    submit: (w, b) => {
      if (!ALL_KINDS.includes(b.kind)) throw bad();
      return db.rpc('wr_submit', { ...w, kind: b.kind, store_id: STORE(b.store_id), payload: normPayload(b.kind, b.payload), client_key: KEY(b.client_key),
        dup_reason: TS(b.dup_reason, LIMITS.note) || null });
    },
    act: (w, b) => {
      // 本文の action は 'act'（この関数の入口）。申請に何をするかは op。
      if (!ACTS.includes(b.op)) throw bad();
      const p = { ...w, ...ref(b), action: b.op, expect_rev: REV(b.expect_rev), client_key: KEY(b.client_key), note: TS(b.note, LIMITS.note) || null };
      if (b.op === 'edit' || b.op === 'resubmit') {
        if (!ALL_KINDS.includes(b.kind)) throw bad();
        p.payload = normPayload(b.kind, b.payload);
        p.dup_reason = TS(b.dup_reason, LIMITS.note) || null;
      }
      if (b.op === 'pay') { p.pay_date = DT(b.pay_date); p.pay_method = TS(b.pay_method, LIMITS.method); if (!p.pay_method) throw bad(); p.legacy_ack = b.legacy_ack === true; }
      if (CLAIMED.includes(b.op)) p.claim = KEY(b.claim);
      return db.rpc('wr_act', p);
    },
    settings_save: (w, b) => {
      if (typeof b.live !== 'boolean') throw bad();
      return db.rpc('wr_settings_save', { ...w, live: b.live, expect_rev: REV(b.expect_rev) });
    },
    // v1159：段階 3。前の「承認」タブの記録を写す（GM・CEO の端末がログインのたびに自動で・UI案74 の 3B）。
    // 端末は前の記録の id と表示用の中身だけを送る。状態・種類・店・申請した人はサーバーが共通データから読む（wr_s3_import）
    s3_import: (w, b) => {
      if (!Array.isArray(b.items) || b.items.length > 100) throw bad();
      const seen = new Set();
      const items = b.items.map(x => {
        x = obj(x);
        if (typeof x.ap_id !== 'string' || !/^ap\d{6,20}$/.test(x.ap_id) || seen.has(x.ap_id)) throw bad();
        seen.add(x.ap_id);
        if (!S2_KINDS.includes(x.kind)) throw bad();
        const payload = normPayload(x.kind, x.payload);
        if (payload.ap_id !== x.ap_id) throw bad();
        return { ap_id: x.ap_id, kind: x.kind, store_id: STORE(x.store_id), payload };
      });
      return db.rpc('wr_s3_import', { ...w, items });
    },
    // v1155：段階 2 を使い始める／止める（GM・CEO）
    s2_save: (w, b) => {
      if (typeof b.s2 !== 'boolean') throw bad();
      return db.rpc('wr_s2_save', { ...w, s2: b.s2, expect_rev: REV(b.expect_rev) });
    },
    legacy_import: w => db.rpc('wr_legacy_import', w),
    // 承認・閲覧の権限の写し（GM・CEO）：違いを見る・見た一覧（digest）のとおりに合わせる
    people_diff: w => db.rpc('wr_people_diff', w),
    people_sync: (w, b) => {
      if (typeof b.digest !== 'string' || !/^[0-9a-f]{32}$/.test(b.digest)) throw bad();
      const q = { ...w, digest: b.digest };
      if (b.emps != null) {
        if (!Array.isArray(b.emps) || b.emps.length > 500 || !b.emps.every(x => typeof x === 'string' && x && x.length <= 64)) throw bad();
        q.emps = b.emps;
      }
      return db.rpc('wr_people_sync', q);
    },
    // v1132：スキルマトリクスの「自分の表示設定」（人 × 店・非表示の人の社員 ID）
    view_get: (w, b) => db.rpc('wr_view_get', { ...w, store: STORE(b.store) }),
    view_save: (w, b) => {
      if (!Array.isArray(b.hidden) || b.hidden.length > 500) throw bad();
      const hidden = [...new Set(b.hidden.map(EMP))];
      if (!Number.isInteger(b.expect_rev) || b.expect_rev < 0 || b.expect_rev > 1e9) throw bad();
      return db.rpc('wr_view_save', { ...w, store: STORE(b.store), hidden, expect_rev: b.expect_rev });
    },
    // v1156：チャット（DM・グループ・申請の案件）。だれが読める・書けるかは SQL（chat_*）が決める
    chat_sync: (w, b) => db.rpc('chat_sync', { ...w, since: b.since == null ? 0 : SEQ(b.since), limit: Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 500 ? b.limit : 200 }),
    chat_messages: (w, b) => {
      const q = { ...w, thread: TID(b.thread), limit: Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 100 ? b.limit : 100 };
      if (b.after != null) q.after = SEQ(b.after);
      if (b.before != null) q.before = SEQ(b.before);
      if (q.after != null && q.before != null) throw bad();
      return db.rpc('chat_messages_get', q);
    },
    chat_mentions: (w, b) => db.rpc('chat_my_mentions', { ...w, limit: Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 100 ? b.limit : 50 }),
    chat_people: w => db.rpc('chat_people', w),
    chat_open_dm: (w, b) => db.rpc('chat_open_dm', { ...w, to: EMP(b.to) }),
    chat_create_group: (w, b) => {
      const title = TS(b.title, CHAT.title); if (!title) throw bad();
      return db.rpc('chat_create_group', { ...w, title, members: EMPS(b.members, 1, CHAT.members), client_key: KEY(b.client_key) });
    },
    chat_case: (w, b) => db.rpc('chat_case', { ...w, ...ref(b) }),
    chat_send: async (w, b) => {
      const thread = TID(b.thread), files = FILES(b.files), client_key = KEY(b.client_key), mentions = MENTIONS(b.mentions);
      if (!files.length) return db.rpc('chat_send', { ...w, thread, body: BODY(b.body), mentions, client_key });
      const body = BODY_OPT(b.body);
      // 上げたファイルを確かめてから送る（確かめたもの・もう送ったものは飛ばす）。だれの・どの会話のファイルかは SQL が確かめる
      const pend = await db.rpc('chat_file_pending', { ...w, thread, ids: files });
      for (const f of (pend && Array.isArray(pend.files)) ? pend.files : []) {
        if (f.status === 'up') await verifyFile(w, f);
        else if (f.status === 'bad') throw fileErr('file_bad');
      }
      return db.rpc('chat_send', { ...w, thread, body, mentions, client_key, files });
    },
    chat_edit: (w, b) => db.rpc('chat_edit', { ...w, id: TID(b.id), body: BODY_OPT(b.body), mentions: MENTIONS(b.mentions) }),
    chat_delete: async (w, b) => {
      const r = await db.rpc('chat_delete', { ...w, id: TID(b.id) });
      await later(() => purge(20));   // 5A：消したメッセージのファイルもサーバーから
      return r;
    },
    // v1161：添付を上げる準備（同じ鍵は同じ 1 つ）。種類・大きさ・数はサーバーが決める
    chat_file_start: async (w, b) => {
      const ext = typeof b.ext === 'string' ? b.ext.toLowerCase() : '';
      if (!FILE_EXTS.includes(ext)) throw fileErr('file_type');
      if (!Number.isInteger(b.size) || b.size < 1) throw bad();
      if (b.size > FILE_MAX.size) throw fileErr('file_big');
      const q = { ...w, thread: TID(b.thread), client_key: KEY(b.client_key), name: TS(typeof b.name === 'string' ? b.name.slice(0, 200) : '', 200), ext, size: b.size };
      if (ext === 'jpg') { if (!Number.isInteger(b.w) || !Number.isInteger(b.h)) throw bad(); q.w = b.w; q.h = b.h; }
      const f = await db.rpc('chat_file_start', q);
      const out = { id: f.id, status: f.status, name: f.name, ext: f.ext, kind: f.kind, size: f.size, w: f.w, h: f.h, thumb: f.thumb, mime: f.mime };
      if (f.status === 'up') {
        out.upload = await storage.signUpload(f.path);
        if (f.thumb_path) out.thumb_upload = await storage.signUpload(f.thumb_path);
      }
      if (!f.replay) await later(() => purge(10));   // 送らなかったファイル（1 日）を少しずつ消す（実行環境があれば裏で）
      return out;
    },
    // 開く・保存する：5 分だけ使えるリンク。ids は一覧の小さい写真をまとめて（30 まで）
    chat_file_url: async (w, b) => {
      const ids = b.ids != null ? (Array.isArray(b.ids) && b.ids.length >= 1 && b.ids.length <= 30 ? [...new Set(b.ids.map(TID))] : (() => { throw bad(); })()) : [TID(b.id)];
      const thumb = b.thumb === true, download = b.download === true;
      if (download && ids.length !== 1) throw bad();
      const r = await db.rpc('chat_files_access', { ...w, ids, thumb });
      const files = (r && Array.isArray(r.files)) ? r.files : [];
      if (!files.length && b.ids == null) throw fileErr('not_found');
      const urls = files.length ? await storage.signDownload(files.map(f => f.path), { download: download ? files[0].name || 'file' : null }) : {};
      const items = files.map(f => ({ id: f.id, url: urls[f.path] || null, name: f.name, mime: f.mime, kind: f.kind })).filter(x => x.url);
      if (!items.length && b.ids == null) throw fileErr('storage');
      return b.ids == null ? { ...items[0], expires: 300 } : { items, expires: 300 };
    },
    // 7A：この会話のファイル
    chat_files: (w, b) => {
      const q = { ...w, thread: TID(b.thread), limit: Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 60 ? b.limit : 30 };
      if (b.before != null) q.before = SEQ(b.before);
      return db.rpc('chat_files_list', q);
    },
    // 8B：申請のチャットの写真・PDF を建て替え経費の領収書にする（申請した本人）
    wr_receipt_chat: (w, b) => db.rpc('wr_receipt_from_chat', { ...w, ...ref(b), file: TID(b.file), expect_rev: REV(b.expect_rev), client_key: KEY(b.client_key) }),
    wr_receipt_url: async (w, b) => {
      const f = await db.rpc('wr_receipt_file', { ...w, ...ref(b) });
      const urls = await storage.signDownload([f.path], { download: b.download === true ? f.name || 'receipt' : null });
      if (!urls[f.path]) throw fileErr('storage');
      return { url: urls[f.path], name: f.name, mime: f.mime, kind: f.kind, expires: 300 };
    },
    chat_hide: (w, b) => {
      if (typeof b.hide !== 'boolean') throw bad();
      return db.rpc('chat_hide', { ...w, id: TID(b.id), hide: b.hide, reason: TS(b.reason, CHAT.reason) });
    },
    chat_read: (w, b) => db.rpc('chat_read', { ...w, thread: TID(b.thread), seq: SEQ(b.seq) }),
    chat_add: (w, b) => {
      if (typeof b.history !== 'boolean') throw bad();
      return db.rpc('chat_add', { ...w, thread: TID(b.thread), members: EMPS(b.members, 1, CHAT.members), history: b.history });
    },
    chat_remove: (w, b) => db.rpc('chat_remove', { ...w, thread: TID(b.thread), emp: EMP(b.emp) }),
    chat_rename: (w, b) => {
      const title = TS(b.title, CHAT.title); if (!title) throw bad();
      return db.rpc('chat_rename', { ...w, thread: TID(b.thread), title, expect_rev: REV(b.expect_rev) });
    },
  };
  const ERR = { forbidden: 403, not_live: 409, conflict: 409, not_found: 404, bad_value: 400, no_rate: 409, reason_required: 400,
    dup_unresolved: 409, legacy_paid: 409, pin_check_missing: 503, not_member: 409, too_late: 409, too_many: 409, chat_missing: 503,
    file_type: 400, file_big: 413, file_bad: 409, file_missing: 409, file_many: 409, files_missing: 503, storage: 502 };
  // チャットの SQL がまだ無い（関数が見つからない）＝ 503 chat_missing（アプリは「サーバーの準備がまだ」と出す）
  const chatMissing = (action, e) => typeof action === 'string' && action.startsWith('chat_')
    && (e.status === 404 || /(function public\.chat_[a-z_]+\(.*\) does not exist|Could not find the function public\.chat_)/i.test(String(e.message || '')));
  // v1161：添付の SQL（20261124090000）がまだ（添付の関数が無い）＝ 503 files_missing
  const FILE_ACTIONS = ['chat_file_start', 'chat_file_url', 'chat_files', 'wr_receipt_chat', 'wr_receipt_url', 'chat_send'];
  const filesMissing = (action, e) => FILE_ACTIONS.includes(action)
    && /(chat_file_|chat_files_|wr_receipt_)[a-z_]*/.test(String(e.message || '')) && (e.status === 404 || /does not exist|Could not find the function/i.test(String(e.message || '')));

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin' }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 60000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_json' }, 400);
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const who = await actorOf(body);
      if (!who || who.deny) { console.warn('work-requests unauthorized', body.action, (who && who.deny) || 'none'); return json({ error: 'unauthorized' }, 401); }
      return json(await fn(who, body));
    } catch (e) {
      const msg = String(e.message || 'error'), code0 = msg.split(/[\s:]/)[0];
      const code = ERR[code0] ? code0 : (filesMissing(body && body.action, e) ? 'files_missing' : chatMissing(body && body.action, e) ? 'chat_missing' : code0);
      const status = ERR[code] || 500;
      if (status === 500 || status === 502) console.error('work-requests', body && body.action, safeErr(e));
      return json({ error: status === 500 ? 'error' : code }, status);
    }
  };
}
