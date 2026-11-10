// secure-state（v1139・段階 2b の 1 つ目）：成長カルテ・賞与のキーを、公開の鍵（anon）ではなくこの関数を通して読み書きする。
// 仕様：docs/SECURE_STATE_V1139_JA.md。
//
// ・データは今までどおり app_state の行（移さない・書き換えない）。この関数はサーバーの鍵（service role）で読み書きする。
//   公開の鍵で読めなくするのは、全部の端末を v1139 にしたあとの SQL（20261108090000：app_state の RLS）。
// ・だれか：PIN のログインの印（本文の pin_session）を work-requests の whoami に確かめてもらう（PIN を確かめるコードは
//   公開しないので、この関数は持たない）。または、メールのログイン（Authorization の Bearer）＋ manager_auth。
//   PIN の印があればそれを使う（その端末の前にいる人）。役割はサーバーが決める（端末の言う役割・名前は使わない）。
// ・CEO・GM（manager_auth の役割）：全部（full）。今までの画面と同じ（成長カルテ・賞与の画面は GM・CEO だけ）。
// ・それ以外の在籍の人（社員と結ばれた印）：画面が使う形だけ（proj）。
//     growth_karte → 全員の入社日（hireDate）と、本人（AM は担当の店・G4 以上は自分の店の人も）の「次期の目標」（終わっていないもの）
//                    （Career Score の強みのカードの「伸ばしていること」と、グレードの区間の入社日に使う）
//     karte_bonus_config → 査定の四半期（quarter）だけ（Career Score の基準点の四半期）
//   ほかのキーは返さない。書けない。
// ・PIN のログインの印が無い・確かめられない人：何も返さない（401）。
// ・v1140（段階 2b の 2 つ目）：Career Score の点・申請・履歴も（下の「v1140」の節・docs/SECURE_CS_V1140_JA.md）。取り込みは cs_have を送った
//   アプリ（v1140）にだけ cs の部分を付ける。答えにはいつも csfn:1（前の版の関数でないことの印）。
// ・v1141（段階 2b の 3 つ目）：ガソリン代の単価（mileage_config）と Score管理（career_cfg）は、決めた人だけがこの関数で書く（下の「v1141」の節・
//   docs/SECURE_SETTINGS_V1141_JA.md）。読むのは今までどおり公開の鍵で。答えにはいつも swfn:1。
// ・v1142（段階 2b の 4 つ目）：採用（応募者・不採用ログ）とお悩み相談室も、この関数で読み書きする（hr_get・hr_op・hr_match。
//   見られる範囲の分だけ返し、書くのは 1 件ずつ。docs/SECURE_HR_V1142_JA.md）。答えにはいつも hrfn:1。
// ・v1143（段階 2b の 5 つ目）：GM・CEO だけが変える賞与・Career Score の設定 8 つ（スコア基準・係数・係数の幅・G3 の職種・4 項目の設定・個人設定・
//   強みの決まり・評価基準・例）も、GM・CEO だけがこの関数で書く（v1141 と同じ道・SW2_KEYS・docs/SECURE_SETTINGS_V1143_JA.md）。答えにはいつも sw2:1。
// ・v1144（段階 2b の 6 つ目）：従業員の表の個人の欄（生年月日・会社カードの下 4 桁・保険の加入・保険料）を、app_state の emp_pii に置いて
//   この関数で読み書きする（pii_get・pii_op・card_match・ins_totals。下の「v1144」の節・docs/SECURE_PII_V1144_JA.md）。答えにはいつも piifn:1。
// ・v1145（段階 2b の 7 つ目）：グレード履歴（grade_hist）も、GM・CEO だけがこの関数で書く（Moto さん 11/10「GM,CEOです」。v1143 と同じ道・GH_KEYS・
//   docs/SECURE_GRADE_HIST_V1145_JA.md）。読むのは今までどおり公開の鍵で。答えにはいつも ghfn:1。
// ・v1146（段階 2b の 8 つ目）：Tip Rate の申請・決定（spl_tip_requests_<名前>）とプレップの時給の表・認定（prep_tables・prep_certs）も、
//   この関数で書く（今の画面で決められる人だけ。下の「v1146」の節・docs/SECURE_TIP_PREP_V1146_JA.md）。読むのは今までどおり公開の鍵で。答えにはいつも tpfn:1。

export const SS_KEYS = ['growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra'];
export const SS_PREFIX = ['spl_bonus_q_'];
export const SS_PROJ = ['growth_karte', 'karte_bonus_config'];
export const SS_FULL_ROLES = ['ceo', 'gm'];
const MGR_ROLES = ['ceo', 'gm', 'office', 'office_crew'];
export const SS_PREFIX_RE = /^spl_bonus_q_[0-9A-Za-z_-]{1,40}$/;   // spl_bonus_q_<四半期>（アプリ・SQL と同じ決まり）
export function ssIsKey(k) {
  if (typeof k !== 'string' || !k || k.length > 200) return false;
  if (SS_KEYS.includes(k)) return true;
  return SS_PREFIX_RE.test(k);
}

// ---- v1140（段階 2b の 2 つ目）：Career Score の点・申請・履歴（仕様：docs/SECURE_CS_V1140_JA.md）
//   lss_emp_<名前>（点）・spl_lss_requests_<名前>（申請）・spl_lss_history_<名前>（履歴・開いたときだけ取る）と、前の統合行
//   lss_scores・lss_requests・lss_history。名前はアプリの従業員の名前そのまま（空白・日本語もある）。
//   CEO・GM：全部（full）。ほかの在籍の人：見られる人の行だけ（scoped・行は丸ごと）。前の統合行は見られる人の分だけ（見せる形・書けない）。
//   見られる人（Moto さん 11/04 の回答）：AM＝担当の店（応援も）・G4＝自分の店の G4 以下・G3＝自分の店の G1・G2・Crew Leader（G2）＝自分の店の G1・
//   Head Chef＝全店の G1（申請は全店）・経理・事務Crew＝本部の人（Office管理のメンバー）・それ以外＝自分だけ。Score管理（career_cfg）で
//   見る・付ける・承認する役にした人も。店のログインなど＝なし。
//   v1144（Codex #138 P1-1）：Head Chef の広い範囲は、GM・CEO が確かめた写しでも Head Chef の人だけ（確かめるまでは G4 の範囲）。
export const CS_PREFIX = ['lss_emp_', 'spl_lss_requests_', 'spl_lss_history_'];
export const CS_LEGACY = ['lss_scores', 'lss_requests', 'lss_history'];
export function csIsKey(k) {
  if (typeof k !== 'string' || !k || k.length > 400) return false;
  if (CS_LEGACY.includes(k)) return true;
  return CS_PREFIX.some(p => k.length > p.length && k.startsWith(p));
}
// { kind: emp|req|hist|legacy, name }
export function csParse(k) {
  if (!csIsKey(k)) return null;
  if (CS_LEGACY.includes(k)) return { kind: 'legacy', name: '' };
  if (k.startsWith('lss_emp_')) return { kind: 'emp', name: k.slice(8) };
  if (k.startsWith('spl_lss_requests_')) return { kind: 'req', name: k.slice(17) };
  return { kind: 'hist', name: k.slice(16) };
}
// 公開の鍵から外すキー（SQL の ss_secret_key と同じ：成長カルテ・賞与＋Career Score）
export const secretKey = k => ssIsKey(k) || csIsKey(k);

// ---- v1141（段階 2b の 3 つ目）：決めた人だけが書ける設定（docs/SECURE_SETTINGS_V1141_JA.md）
//   サーバーが値を信じて使うキー。読むのは今までどおり公開の鍵で（どの画面も読む）。書くのはこの関数だけ（SQL 20261110090000 で
//   公開の鍵の足す・直す・消すを止める）。
//     mileage_config：ガソリン代の単価（work-requests の wr_mileage_rate が精算の金額に使う）・地図の鍵・往復の既定 → CEO・GM・経理（Moto さん 11/04）
//     career_cfg：Score管理（専門職 × グレードの権限。この関数の Career Score の範囲に使う）→ GM・CEO（今の画面と同じ）
//   役割はサーバーが決める（PIN の印は work-requests の whoami・メールのログインは manager_auth）。端末の言う役割は使わない。
// v1143（段階 2b の 5 つ目・docs/SECURE_SETTINGS_V1143_JA.md）：GM・CEO だけが変える賞与・Career Score の設定（今の画面と同じ）。
//   どれもアプリが計算・表示に使う（サーバーは読まない）。公開の鍵で書けると、賞与の係数・基準・個人の設定を書き換えられた。読むのは今までどおり。
//     cs_criteria：スコア基準（昇格の判定と賞与 ① の基準ライン）／bonus_coef・bonus_coef_rng：グレード・職種の係数と幅／
//     bonus_track：その四半期に選んだ G3 の職種／bonus_eval_rule：4 項目の設定（会社共通・グレード・職種）／bonus_eval_ovr：個人設定／
//     cs_strength_rule：強みの決まり（表示）／cs_guide：評価基準・例の文
export const SW2_KEYS = ['cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide'];
// v1145（Moto さん 11/10「GM,CEOです」・docs/SECURE_GRADE_HIST_V1145_JA.md）：グレード履歴（社員ごとの確定日・前後のグレード・前のグレードの期間の評価）。
//   賞与の日割り（区間ごとのグレード）にアプリが使う。公開の鍵で書けると、確定日・グレード・確定した評価を書き換えられた。
//   形は v1143 の 8 つと同じ「キー（社員 ID）→ 記録（オブジェクトか null）」の地図。前の関数（v1144 以前）は「知らないキー」と断るだけで何も書かない
export const GH_KEYS = ['grade_hist'];
export const SW_WRITE = { mileage_config: ['ceo', 'gm', 'office'], career_cfg: ['ceo', 'gm'], ...Object.fromEntries(SW2_KEYS.map(k => [k, ['ceo', 'gm']])),
  ...Object.fromEntries(GH_KEYS.map(k => [k, ['ceo', 'gm']])) };
export function swIsKey(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(SW_WRITE, k); }
// 値の形（決めた人が書くときに確かめる：おかしな単価で、ガソリン代の申請が全部止まらないように）
//   mileage_config：アプリが書く形（包まない）だけ。包んだ形（{__st:…}）は断る（wr_mileage_rate は中身を読み、アプリの画面は外を読むので、
//     外と中で違う単価になる。アプリは書かない＝独立レビュー P3-1）。単価は 0.01〜5（それより小さいと短い距離が 0 セントになり申請が止まる）。
//   career_cfg：'<部門>|<G>' ごとの記録（オブジェクトか null）の地図。おかしな記録は、クラウドにもうある同じ記録だけ通す
//     （ほかの人が前に入れたものが残っていても、GM・CEO の保存が止まらないように＝独立レビュー P2-1。新しく入れることはできない）。
//   v1143 の 8 つ・v1145 の grade_hist：career_cfg と同じ「キー → 記録（オブジェクトか null）」の地図（キーは 200 字まで）。おかしな記録は、クラウドにもうある同じ記録だけ通す。
export function swCgEntryOk(k, x, max = 100) { return typeof k === 'string' && k.length <= max && (x === null || (typeof x === 'object' && !Array.isArray(x))); }
export function swCgBadKeys(value, max = 100) { return (value && typeof value === 'object' && !Array.isArray(value)) ? Object.keys(value).filter(k => !swCgEntryOk(k, value[k], max)) : []; }
const swMapMax = key => (key === 'career_cfg' ? 100 : 200);
const swMapKey = key => key === 'career_cfg' || SW2_KEYS.includes(key) || GH_KEYS.includes(key);
export function swShapeOk(key, value, cloud) {
  let s;
  try { s = JSON.stringify(value === undefined ? null : value); } catch { return false; }
  if (key === 'mileage_config') {
    if (s.length > 20000) return false;
    const v = value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (Object.prototype.hasOwnProperty.call(v, '__st')) return false;   // 包んだ形は書かない（上）
    const r = v.ratePerMile;
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0.01 || r > 5) return false;   // 0.01〜5（wr_mileage_rate が使える単価で、短い距離も 1 セント以上）
    if (v.gmapsKey !== undefined && v.gmapsKey !== null && (typeof v.gmapsKey !== 'string' || v.gmapsKey.length > 300)) return false;
    if (v.roundTripDefault !== undefined && typeof v.roundTripDefault !== 'boolean') return false;
    return true;
  }
  if (swMapKey(key)) {
    if (s.length > (key === 'career_cfg' ? 1000000 : 6000000)) return false;   // v1143 の 8 つ・grade_hist は 600 万字まで（本文の上限 800 万字の内側。履歴を持つ評価基準・例・個人設定・グレード履歴が大きくなっても GM・CEO の保存を止めない）
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const c = (cloud && typeof cloud === 'object' && !Array.isArray(cloud)) ? cloud : null;
    return swCgBadKeys(value, swMapMax(key)).every(k => !!c && Object.prototype.hasOwnProperty.call(c, k) && canon(c[k]) === canon(value[k]));
  }
  return false;
}
// ---- v1146（段階 2b の 8 つ目・Moto さん 11/10「Tip Rate とプレップから」・docs/SECURE_TIP_PREP_V1146_JA.md）
//   Tip Rate の申請・決定（spl_tip_requests_<名前>・前の統合行 tip_requests）、プレップの時給の表（prep_tables）と認定（prep_certs）。
//   チップの配分（v1092 から Tip Rate で）と時給（v1106 から認定の Lv × 表）にアプリが使う。公開の鍵で書けると、自分の Tip Rate を「承認」にする・
//   時給の表を書き換える・自分の認定を足す、ができた。読むのは今までどおり公開の鍵で（どの端末も配分と人件費を計算する）。書くのはこの関数だけ。
//   だれが何を変えてよいかは、今の画面で決められる人と同じ（Moto さん 11/10「今の画面で決められる人だけ」）：
//     Tip Rate の承認・却下・引き上げ（自分の Tip Rate は決めない・店では分けない＝今の画面と同じ）：
//       CEO・GM・確かめた AM（いつも）。役割 g4 の人・Head Chef（GM・CEO が確かめた G4）は、ワークセンターを使い始めるまで（使い始めたら GM に申請＝v1135）。
//       Corporate Chef（GM・CEO が確かめた G5 の Head Chef の印）はいつも（画面の決まりと同じ）。役割は今の社員の表（画面と同じ）・グレードは確かめた写しとの狭いほう。
//     Tip Rate の申請（申請中を足す）：本人だけ。決めたものは消さない・申請中に戻さない（決め直しは、前の決定より新しい決定だけ＝v1091 の合流と同じ）。
//     承認センターが記録に付ける印（_dG・_stK・_stT・_dT・_mut：率・状態・決めた人は変えない。v1087）は、だれでも付け直せる（古い写しの端末が外すことも＝今までの合流と同じ）。
//     本人かは、名前をそろえて（全角・空白・大文字）この人の名前（PIN の印・確かめた写し・社員の表の自分の行）と比べる。名前が分からない人は決めない・申請しない。
//     前の統合行（tip_requests）：だれも変えない（読むだけ。v720 からアプリは書かない。Codex #140 6766283780）。
//     プレップの時給の表：GM・CEO。プレップの認定：GM・CEO（申請・承認・却下・直接決める・表の切り替え・指定を外す）。「反映した」の印だけは経理も。
//   決めた人でなくても、クラウドと同じ値なら書かずに通す（v1141 と同じ）。前の決定より古い写しの送り直しも（covers：アプリが書かない）。
//   書くのは、確かめた行が変わっていないときだけ（読んだ行で確かめ、その行に条件を付けて書く。違えば 409）。
export const TP_KEYS = ['prep_tables', 'prep_certs', 'tip_requests'];
export const TP_TIP_PRE = 'spl_tip_requests_';
// spl_tip_requests_ で始まる名前は長さによらず（SQL の ss_guard_key と同じ。アプリはこの名前で始まる行をすべて Tip Rate として読む）。書くのは 200 字までの名前だけ（tpPut）
export function tpIsKey(k) { return typeof k === 'string' && (TP_KEYS.includes(k) || (k.startsWith(TP_TIP_PRE) && k.length > TP_TIP_PRE.length)); }
export const TIP_DECIDE = ['ceo', 'gm', 'am'];
const TIP_ST = ['申請中', '承認', '却下'];
const TIP_DEC_FIELDS = ['approver', 'approvedDate', 'decAt', 'decDay', 'decHst', 'fromDay', 'prevRate'];
// 承認センターの印（v1087 の _apSyncRecStamp・_apRecordState）。率・状態・決めた時刻（decAt）ではない（配分にも Tip Rate にも使わない）
export const TIP_STAMPS = ['_dG', '_stK', '_stT', '_dT', '_mut'];
function tipStampsOk(r) {
  for (const k of TIP_STAMPS) {
    if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
    const v = r[k];
    if (v === null || v === undefined || v === '') continue;
    if (k === '_stK') { if (typeof v !== 'string' || v.length > 120) return false; continue; }
    const n = typeof v === 'string' && v.length <= 20 ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false;
  }
  return true;
}
const hasV = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null && o[k] !== '';
// 名前をそろえる（本人かを見るため）：NFKC・空白を 1 つに・前後の空白を取る・小文字
export const tipNk = s => typeof s === 'string' ? s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() : '';
const tipDecT = r => { const t = Number(r && r.decAt); return Number.isFinite(t) && t > 0 ? t : 0; };
const tipId = r => (r && (typeof r.id === 'string' || typeof r.id === 'number')) ? String(r.id) : null;
const omit = (o, ks) => { const x = {}; for (const k of Object.keys(o || {})) if (!ks.includes(k)) x[k] = o[k]; return x; };
// 1 件の形（Tip Rate）：id・名前（行の名前と同じ）・状態・率（0〜100）
function tipEntryOk(r, name) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const id = tipId(r); if (!id || id.length > 80) return false;
  if (r.name !== name) return false;
  if (!TIP_ST.includes(r.status)) return false;
  const rt = Number(r.rate); if (!Number.isFinite(rt) || rt < 0 || rt > 100) return false;
  return true;
}
// 書いてよいか：'ok'・'forbidden'（この人は変えられない）・'bad'（形がおかしい）。cloud はいまのクラウドの値（無ければ null）
//   a：{ role, name, dec }（name は社員の表・GM・CEO が確かめた写し。本人かどうかに使う。dec：Tip Rate を決められる人か＝関数の tipDecider）
export function tpCheck(key, cloud, value, a) {
  let s; try { s = JSON.stringify(value === undefined ? null : value); } catch { return 'bad'; }
  if (s.length > 4000000) return 'bad';
  const role = a && a.role, top = role === 'ceo' || role === 'gm';
  if (key === 'prep_tables' || key === 'prep_certs') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'bad';
    const c = (cloud && typeof cloud === 'object' && !Array.isArray(cloud)) ? cloud : {};
    // 形のおかしな記録は、クラウドにもうある同じ記録だけ（v1143 と同じ）
    if (!swCgBadKeys(value, 200).every(k => Object.prototype.hasOwnProperty.call(c, k) && canon(c[k]) === canon(value[k]))) return 'bad';
    if (top) return 'ok';
    if (key === 'prep_tables' || role !== 'office') return 'forbidden';
    // 経理：承認した認定に「反映した」の印を付けるだけ（中身はそのまま。時刻 _at は進む）
    for (const id of new Set([...Object.keys(c), ...Object.keys(value)])) {
      const o = c[id], n = value[id];
      if (canon(o === undefined ? null : o) === canon(n === undefined ? null : n)) continue;
      if (!o || !n || typeof o !== 'object' || typeof n !== 'object') return 'forbidden';
      if (o.state !== 'approved' || n.state !== 'approved' || (o.toast && o.toast.at)) return 'forbidden';
      const tt = n.toast;
      if (!tt || typeof tt !== 'object' || Array.isArray(tt) || typeof tt.at !== 'string' || !tt.at || tt.at.length > 40 || typeof tt.by !== 'string' || tt.by.length > 120 || Object.keys(tt).some(k => k !== 'at' && k !== 'by')) return 'forbidden';
      if (canon(omit(o, ['toast', '_at'])) !== canon(omit(n, ['toast', '_at']))) return 'forbidden';
    }
    return 'ok';
  }
  if (key === 'tip_requests') {
    // 前の統合行（全員の分）：読むだけ（Codex #140 6766283780 の P2）。v720 から、アプリは人ごとの行に書き、この行には書かない
    // （統合行にしか無い記録を人ごとの行へ移すのは端末の中だけ。クラウドの統合行には触らない）。アプリはこの行の記録も読む（_splitRead）ので、
    // 変えられると人ごとの行の決まり（自分の Tip Rate は決めない・申請は本人だけ・決めたものは消さない）を通らずに Tip Rate を変えられた。
    // クラウドと同じ値は tpPut が書かずに通す。それ以外はだれも変えない（GM・CEO も）
    if (!Array.isArray(value)) return 'bad';
    return canon(cloud === undefined ? null : cloud) === canon(value) ? 'ok' : 'forbidden';
  }
  // spl_tip_requests_<名前>
  const name = key.slice(TP_TIP_PRE.length);
  if (!Array.isArray(value) || value.length > 2000) return 'bad';
  const C = Array.isArray(cloud) ? cloud : [];
  const cBy = new Map(); for (const r of C) { const id = tipId(r); if (id != null) cBy.set(id, r); }
  const nBy = new Map();
  for (const r of value) {
    const id = tipId(r);
    if (id == null || nBy.has(id)) return 'bad';
    nBy.set(id, r);
    if (!tipEntryOk(r, name) && !(cBy.has(id) && canon(cBy.get(id)) === canon(r))) return 'bad';   // 形のおかしな記録は、クラウドにもうある同じ記録だけ
  }
  // 本人か（Codex #140 6766283780 の P3）：名前の書き方の違い（全角・空白・大文字）をそろえ、この人の名前（PIN の印・確かめた写し・社員の表の
  // 自分の行：tpPut の tipActorNames）のどれかと同じなら本人。名前が 1 つも分からない人は、本人かを決められないので決めない・申請もしない
  const mine = new Set([a && a.name, ...((a && Array.isArray(a.names)) ? a.names : [])].map(tipNk).filter(Boolean));
  const self = mine.has(tipNk(name));
  const decider = !!(a && a.dec) && mine.size > 0 && !self;
  for (const [id, o] of cBy) {
    const n = nBy.get(id);
    if (!n) return 'forbidden';   // 消さない（だれも）
    if (canon(o) === canon(n)) continue;
    if (!tipStampsOk(n)) return 'bad';
    // 承認センターの印だけが違う：だれでも（付け直す・古い写しが外す。率・状態・決めた時刻は同じ）
    if (canon(omit(o, TIP_STAMPS)) === canon(omit(n, TIP_STAMPS))) continue;
    if (!decider) return 'forbidden';
    if (!tipEntryOk(n, name) || n.name !== o.name || Number(n.rate) !== Number(o.rate)) return 'forbidden';
    if (o.status === '申請中') continue;   // 承認・却下（決める）・申請中のまま（決める人だけが直す）
    // 決めたもの：前の決定より新しい決定だけ（v1091 の合流と同じ。時刻の無い前の記録に時刻を付けるのも）。申請中には戻さない
    if (n.status === '申請中' || !(tipDecT(n) > tipDecT(o))) return 'forbidden';
  }
  for (const [id, n] of nBy) {
    if (cBy.has(id)) continue;
    if (!tipStampsOk(n)) return 'bad';
    if (n.status === '申請中') {   // 申請：本人だけ・決めた印なし
      if (!self || TIP_DEC_FIELDS.some(k => hasV(n, k))) return 'forbidden';
      continue;
    }
    // 引き上げ（決める人が、ほかの人の）。前の統合行にだけあった前の決定（時刻なし）を人ごとの行へ移すのも（v720 の畳み込み）
    if (decider) continue;
    return 'forbidden';
  }
  return 'ok';
}
// ---- v1142（段階 2b の 4 つ目）：採用（応募者・不採用ログ）とお悩み相談室（docs/SECURE_HR_V1142_JA.md）
//   applicants・reject_log・growthhub は、どれも app_state の 1 行（配列）。読むのも書くのもこの関数で（公開の鍵から外すのは、全部の端末を
//   1142 にしたあとの SQL 20261111090000）。見られる範囲はサーバーが決め、範囲の分だけ返す。書くのは 1 件ずつ（hr_op）：
//   サーバーが行を読み、その 1 件だけを直して、読んだ行が変わっていないときだけ書く（一部だけの写しで全体を上書きしない）。
//     応募者：CEO・GM・経理＝全部／AM＝確かめた担当の店＋「未分類」／G4＝自分の店＋「未分類」／店長・リーダー（SL・G2）＝自分の店／ほか＝なし
//     不採用ログ：応募者と同じ範囲（Moto さん 11/04：全部は CEO・GM・経理だけ）。足すのは「不採用にする」（hr_op reject）だけ
//     応募の入力の「前に不採用」の確かめ（hr_match）：全店の不採用ログから、当たった分だけ（日付・店・理由・メモ）
//     お悩み相談室：CEO・GM・経理＝全部／AM＝担当の店／G4・店長（SL の Store Manager）＝自分の店／ほか＝自分の相談だけ（今の画面と同じ）
export const HR_KEYS = ['applicants', 'reject_log', 'growthhub'];
export function hrIsKey(k) { return typeof k === 'string' && HR_KEYS.includes(k); }
const HR_ALL = ['ceo', 'gm', 'office'];
const HR_LABEL = { ceo: 'CEO', gm: 'GM', office: '経理' };
const HR_UNSORTED = '未分類';
const HR_CID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const AP_ACTIVE = ['応募中', '新規応募', '要確認'];
const HR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function hrStr(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : (typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : ''); }
// 前に不採用の人か（アプリの findPriorRejects と同じ：名前・電話（7 桁以上）・メールのどれかが同じ）
export function hrMatches(probe, log) {
  const name = String((probe && probe.name) || '').trim().toLowerCase();
  const phone = String((probe && probe.phone) || '').replace(/[^0-9]/g, '');
  const email = String((probe && probe.email) || '').trim().toLowerCase();
  return (Array.isArray(log) ? log : []).filter(r => {
    if (!r || typeof r !== 'object') return false;
    const rn = String(r.name || '').trim().toLowerCase(), rp = String(r.phone || '').replace(/[^0-9]/g, ''), re = String(r.email || '').trim().toLowerCase();
    return (!!name && rn === name) || (!!phone && phone.length >= 7 && rp === phone) || (!!email && re === email);
  });
}
// 当たった不採用の記録から見せる分（名前・電話・メールは出さない＝入れた人がもう知っている）
export function hrPrior(r) { return { rejectDate: hrStr(r.rejectDate, 40), store: hrStr(r.store, 80), reason: hrStr(r.reason, 300), memo: hrStr(r.memo, 2000) }; }
// 応募者の 1 件（アプリが送る形）。_ で始まる欄（_prior など、この関数が付けたもの）は落とす
export function hrApClean(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const x = {};
  for (const [k, v] of Object.entries(rec)) if (k.charAt(0) !== '_') x[k] = v;
  if (typeof x.id !== 'string' || !HR_ID_RE.test(x.id)) return null;
  if (typeof x.store !== 'string' || !x.store.trim() || x.store.length > 80) return null;
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 200) return null;
  if (typeof x.status !== 'string' || x.status.length > 40) return null;
  let s; try { s = JSON.stringify(x); } catch { return null; }
  if (s.length > 50000) return null;
  return x;
}
export function hrApStrip(rec) {
  const x = {};
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) for (const [k, v] of Object.entries(rec)) if (k.charAt(0) !== '_') x[k] = v;
  return x;
}
// ---- v1144（段階 2b の 6 つ目）：従業員の表の個人の欄（docs/SECURE_PII_V1144_JA.md）
//   生年月日（dob）・会社カードの下 4 桁（cardLast4）・医療／歯科保険の加入（insurance・dental）・会社負担の保険料（月額・insuranceAmt）は、
//   従業員の表（公開の鍵で読める）から外し、app_state の 1 行 emp_pii（社員 ID → 欄）に置く。読み書きはこの関数で（pii_get・pii_op）。
//   SQL 20261113090000 が、従業員の表に残っている欄を emp_pii に写して消す（それまでは、emp_pii に無い人は従業員の表の値を読む）。
//   見られる人（Moto さん 11/09：今の従業員マスターと同じ）：CEO・GM＝全員の 5 つ／経理・Head Chef＝全員の 4 つ（保険料を除く）／
//   AM＝担当の店（応援も）と本部（ALL）の人の 4 つ／事務Crew＝生年月日があるかだけ（エラーセンターの確かめ）／ほか＝なし。
//   Head Chef は、今の社員の表と GM・CEO が確かめた写し（wr_people.chef・SQL 20261113080000）の両方で Head Chef の人だけ（Codex #138 P1-1）。
//   保険料（人ごと）は GM・CEO だけ（今の画面で直せる人）。店ごとの合計（人件費に入れる）はだれにでも返す（ins_totals・ログイン不要。
//   店舗の PIN のタブレットでも人件費が今と同じになるように。Moto さん 11/09）。
//   カードの下 4 桁の照合（card_match）：レシート管理を使える人（自分の PIN・メールのログイン）に、当たった人の ID と名前だけ（Moto さん 11/09）。
export const PII_KEY = 'emp_pii';
export const PII_FIELDS = ['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
export const PII_HR = ['dob', 'cardLast4', 'insurance', 'dental'];
const PII_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function piiIsKey(k) { return k === PII_KEY; }
// 比べるための形（空・無い・false をそろえる。アプリの piiCmp と同じ）
export function piiCmp(k, v) {
  if (k === 'insurance' || k === 'dental') return v === true || v === 'true';
  if (k === 'insuranceAmt') { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  return v == null ? '' : String(v).trim();
}
// 書くときの形（おかしな値は undefined＝断る）
export function piiValid(k, v) {
  if (k === 'dob') {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const [y, m, d] = v.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
    if (y < 1900 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined;
    return v;
  }
  if (k === 'cardLast4') {
    if (v === '' || v === null || v === undefined) return '';
    return typeof v === 'string' && /^\d{4}(,\d{4}){0,9}$/.test(v) ? v : undefined;
  }
  if (k === 'insurance' || k === 'dental') return typeof v === 'boolean' ? v : undefined;
  if (k === 'insuranceAmt') {
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : undefined;
  }
  return undefined;
}
// 返すときの形（前からの値は形を問わず、短い文字・真偽・数だけ）
function piiOut(v) {
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 200);
  return null;
}
// 退職・OS を止めた人（work-requests の wr_emp_out と同じ）
const empOut = e => { const d = obj(e && e.data) || {}; return String((e && e.status) || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true'; };
// 肩書きと役割からのグレード（SQL の wr_grade と同じ。大きいほう）
const TITLE_G = { 'General Manager': 6, 'Area Manager': 5, 'Corporate Chef': 5, 'Customer Service Manager': 5, 'Store Manager': 4, 'Head Chef': 4, 'Office Manager': 4, 'Accountant': 4,
  'Server Leader': 3, 'Kitchen Leader': 3, 'Operation Leader': 3, 'Store Leader': 3, 'Accounting Leader': 3, 'Crew Leader': 2, 'Office Crew Leader': 2,
  'Crew': 1, 'Office Crew': 1, 'Office Staff': 1, 'Prep': 1, 'Prep Specialist': 1 };
const ROLE_G = { ceo: 7, gm: 6, am: 5, g4: 4, chef: 4, sl: 3, g2: 2 };
export function wrGrade(title, role) {
  const t = Object.prototype.hasOwnProperty.call(TITLE_G, String(title == null ? '' : title).trim()) ? TITLE_G[String(title).trim()] : 0;
  const r = Object.prototype.hasOwnProperty.call(ROLE_G, String(role || '')) ? ROLE_G[role] : 1;
  return Math.max(t, r);
}
// アプリの empGrade（肩書きが先・無ければ役割）と cgPermOf（専門職 × グレードの権限の行）
const APP_TITLE_G = { G1: ['Crew', 'Office Crew', 'Office Staff', 'Prep', 'Prep Specialist'], G2: ['Crew Leader', 'Office Crew Leader'],
  G3: ['Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader'], G4: ['Store Manager', 'Head Chef', 'Office Manager', 'Accountant'],
  G5: ['Area Manager', 'Corporate Chef', 'Customer Service Manager'], G6: ['General Manager'] };
const APP_ROLE_G = { gm: 'G6', am: 'G5', g4: 'G4', chef: 'G4', sl: 'G3', g2: 'G2', crew: 'G1', office_crew: 'G1' };
export function appGrade(title, role) {
  for (const g of Object.keys(APP_TITLE_G)) if (title && APP_TITLE_G[g].includes(title)) return g;
  return APP_ROLE_G[role] || '';
}
const SPEC_DEPTS = ['経理', '調理', 'サービス', 'マーケ'];
const TITLE_DEPT = { 'Accountant': '経理', 'Office Manager': '経理', 'Office Crew Leader': '経理', 'Accounting Leader': '経理', 'Head Chef': '調理', 'Corporate Chef': '調理', 'Customer Service Manager': 'サービス' };
const CHEF_TITLES = ['Head Chef', 'Corporate Chef'];
// 社員の表（今）で Head Chef か：役割 chef か、肩書きが Head Chef・Corporate Chef（列、無ければ中身）。SQL の wr_chef と同じ決まり（列で見る）
const liveChef = e => { const d = obj(e && e.data) || {}; return String((e && e.role) || d.role || '') === 'chef' || CHEF_TITLES.includes(String((e && e.title) || d.title || '').trim()); };
const HQ_ROLES = ['office', 'office_crew', 'chef'];   // 経理・事務Crew が見る本部の人（Office管理のメンバー）
const OFFICE_ROLES = ['office', 'office_crew'];
// キーの順によらない文字（クラウドの jsonb はキーを並べ替えて返す）
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const pendingSt = s => s == null || s === '申請中';

const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer|pin)[^\s]*/gi, '$1:***').slice(0, 200);
const err = (code, status) => { const e = new Error(code); e.code = code; e.status = status; return e; };
const bad = () => err('bad_value', 400);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x && x.length <= 64) : []);
const te = new TextEncoder();
const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', te.encode(String(s)))); }

// PostgREST の updated_at（小数 0〜6 桁）→ マイクロ秒。読めなければ null（アプリの _tsMicro と同じ）
export function tsMicro(s) {
  if (s == null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(s).trim());
  if (!m) return null;
  let off = m[4] || 'Z';
  if (off !== 'Z' && off !== 'z') { let o = off.replace(':', ''); if (o.length === 3) o += '00'; off = o.slice(0, 3) + ':' + o.slice(3, 5); } else off = 'Z';
  const sec = Date.parse(m[1] + 'T' + m[2] + off);
  if (!Number.isFinite(sec)) return null;
  return sec * 1000 + Number(((m[3] || '') + '000000').slice(0, 6));
}

// ---- 見せる形（proj）
function goalsOf(e) {
  const g = Array.isArray(e && e.goals) ? e.goals : [];
  return g.filter(x => x && typeof x === 'object' && !x.done && String(x.text || '').trim())
    .slice(0, 50).map(x => ({ text: String(x.text).slice(0, 500), due: typeof x.due === 'string' ? x.due.slice(0, 20) : '' }));
}
export function projKarte(v, mayGoals) {
  const out = {};
  const m = obj(v); if (!m) return out;
  for (const [id, e] of Object.entries(m)) {
    if (!obj(e) || id.length > 64 || id.startsWith('__')) continue;
    const p = {};
    if (typeof e.hireDate === 'string' && e.hireDate && e.hireDate.length <= 30) p.hireDate = e.hireDate;
    if (mayGoals(id)) { const g = goalsOf(e); if (g.length) p.goals = g; }
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}
// アプリの kbCfgPlain と同じ読み方（包んだ形 __st は、外側の欄が中より先）
const KB_ST_META = { __st: 1, v: 1, _at: 1, _by: 1, _deleted: 1 };
function kbPlain(r, depth = 0) {
  if (!(obj(r) && r.__st === 1) || depth > 20) return r;
  const top = {}; for (const k of Object.keys(r)) if (!KB_ST_META[k]) top[k] = r[k];
  const inner = kbPlain(r.v, depth + 1);
  return { ...(obj(inner) || {}), ...top };
}
export function projKbCfg(v) {
  const r = obj(kbPlain(v)); if (!r) return {};
  const q = r.quarter;
  return (typeof q === 'string' && q.length <= 20) || (typeof q === 'number' && Number.isFinite(q)) ? { quarter: q } : {};
}
// メールのログインか：Bearer が JWT で role が authenticated（公開の鍵（role anon）・新しい形の鍵（JWT でない）はメールのログインでない）
export function jwtRole(tok) {
  try {
    const p = String(tok).split('.');
    if (p.length !== 3 || p[1].length > 4000) return '';
    const b = p[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '==='.slice((b.length + 3) % 4));
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    return j && typeof j.role === 'string' ? j.role : '';
  } catch { return ''; }
}

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const now = deps.now || (() => Date.now());
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const wrUrl = env('SS_WR_URL') || (url + '/functions/v1/work-requests');
  const origins = ['https://funergy-plus.com', ...String(env('SS_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const sv = { apikey: service, authorization: 'Bearer ' + service };
  const timeout = (ms = 8000) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const cache = new Map();     // sha256(印) → { a, exp }（60 秒。同じ印で何度も work-requests を呼ばない）
  const fails = new Map();     // 成長カルテの PIN の間違い：社員 ID → [時刻…]

  async function rest(path, opt = {}) {
    const r = await fetch(url + '/rest/v1/' + path, { ...opt, headers: { ...sv, 'content-type': 'application/json', ...(opt.headers || {}) }, signal: timeout(opt.ms || 20000) });
    const t = await r.text();
    if (!r.ok) { const e = err(r.status === 409 ? 'conflict' : 'db', r.status); e.detail = t.slice(0, 200); throw e; }
    return t ? JSON.parse(t) : null;
  }

  // ---- だれか
  async function pinActor(tok) {
    if (typeof tok !== 'string' || !tok || tok.length > 4000) return { deny: 'pin_shape' };
    const h = await sha256(tok);
    const c = cache.get(h);
    if (c && c.exp > now()) return c.a;
    let r;
    try {
      r = await fetch(wrUrl, { method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', pin_session: tok }), signal: timeout() });
    } catch { return { err: 'auth_unavailable' }; }
    if (r.status === 401 || r.status === 403) {
      try { await r.text(); } catch { /* */ }
      const d = { deny: 'pin' };
      cache.set(h, { a: d, exp: now() + 30000 });   // 断られた印も 30 秒覚える（同じ印で何度も work-requests を呼ばない）
      return d;
    }
    if (!r.ok) { try { await r.text(); } catch { /* */ } return { err: 'auth_unavailable' }; }   // work-requests が無い（404）・PIN を確かめられない（503）など
    let j = null; try { j = await r.json(); } catch { return { err: 'auth_unavailable' }; }
    const me = obj(j && j.me);
    if (!me || typeof me.emp !== 'string' || !me.emp || me.emp.length > 64) return { deny: 'pin' };
    const a = { via: 'pin', emp: me.emp, role: typeof me.role === 'string' ? me.role : '', grade: Number.isInteger(me.grade) ? me.grade : 0,
      stores: arr(me.stores), am: arr(me.am_stores), name: typeof me.name === 'string' && me.name.length <= 120 ? me.name : '',
      confirmed: me.confirmed === true,   // v1142：GM・CEO が確かめた写しがあるか（G4・店長の範囲に要る）。v1140：名前（GM・CEO が確かめた写しか、PIN の印の名前）
      live: j.live === true ? true : (j.live === false ? false : null) };   // v1146：ワークセンターを使い始めたか（G4・Head Chef が Tip Rate を決めるか）
    if (cache.size > 500) { for (const [k, v] of cache) if (!(v.exp > now())) cache.delete(k); if (cache.size > 500) cache.clear(); }
    cache.set(h, { a, exp: now() + 60000 });
    return a;
  }
  async function emailActor(auth) {
    let r;
    try { r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal: timeout() }); } catch { return { err: 'auth_unavailable' }; }
    if (!r.ok) { try { await r.text(); } catch { /* */ } return (r.status >= 500 || r.status === 429) ? { err: 'auth_unavailable' } : { deny: 'email' }; }
    let u = null; try { u = await r.json(); } catch { return { deny: 'email' }; }
    const uid = u && typeof u.id === 'string' && /^[0-9a-f-]{36}$/i.test(u.id) ? u.id : null;
    if (!uid) return { deny: 'email' };
    const rows = await rest('manager_auth?user_id=eq.' + encodeURIComponent(uid) + '&select=role,emp_id');
    const m = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!m || !MGR_ROLES.includes(m.role)) return { deny: 'email_role' };
    const emp = m.emp_id == null || m.emp_id === '' ? null : String(m.emp_id);
    let name = '';
    if (emp) {
      const es = await rest('employees?id=eq.' + encodeURIComponent(emp) + '&select=status,data,name');
      const e0 = Array.isArray(es) ? es[0] : null, d = e0 && obj(e0.data) ? e0.data : {};
      // work-requests の wr_emp_out と同じ：表の status・data の status が退職、または OS を止めた人
      if (e0 && (String(e0.status || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true')) return { deny: 'email_out' };
      if (e0 && typeof e0.name === 'string' && e0.name.length <= 120) name = e0.name;   // v1140：メールのログインの人の名前は社員の表（経理・事務Crew・GM・CEO）
    }
    return { via: 'email', emp, role: m.role, grade: 0, stores: [], am: [], name };
  }
  async function actorOf(req, body) {
    const tok = body.pin_session;
    const auth = req.headers.get('authorization') || '';
    const email = auth.startsWith('Bearer ') && auth.length <= 4000 && jwtRole(auth.slice(7)) === 'authenticated';
    // PIN の印がある要求は、その印だけで決める。確かめられない（work-requests の 404・503・通信の失敗・読めない答え）ときも
    // メールのログインへ切り替えない（Codex の P1：共有の端末に GM のメールのログインが残っていると、Crew の PIN の要求が GM の権限になっていた）
    if (tok !== undefined && tok !== null && tok !== '') return await pinActor(tok);
    if (email) return await emailActor(auth);
    return { deny: 'none' };
  }
  const levelOf = a => (SS_FULL_ROLES.includes(a.role) ? 'full' : (a.emp ? 'proj' : 'none'));
  // v1144（Codex #138 P1-1）：Head Chef として広い範囲（全員の個人の欄・全店の Career Score）を見るのは、GM・CEO が確かめた写し
  // （wr_people.chef・SQL 20261113080000）でも Head Chef のときだけ。社員の表の肩書き・役割は公開の鍵で書けるので、それだけでは広げない。
  // 列が無い（SQL の前）・読めない・写しが無いときは Head Chef としない（狭いほう）。今の社員の表でも Head Chef か（liveChef）は呼ぶ側が見る
  async function confChef(a) {
    if (!a || a.role !== 'staff' || !(a.grade >= 4) || typeof a.emp !== 'string' || !a.emp) return false;
    try {
      const r = await rest('wr_people?emp_id=eq.' + encodeURIComponent(a.emp) + '&select=chef');
      return Array.isArray(r) && r.length === 1 && !!r[0] && r[0].chef === true;
    } catch { return false; }
  }

  // v1146：Tip Rate を決められる人か（今の画面と同じ。画面の Tip Rate の画面の承認・引き上げ＝ROLE_CONFIG の canApprove と v1135 の止め）。
  //   CEO・GM・確かめた AM：いつも。役割 g4（画面では AM と同じ扱い）：ワークセンターを使い始めるまで。
  //   役割 chef：GM・CEO が確かめた Head Chef の印があるとき。Head Chef（G4）は使い始めるまで、Corporate Chef（G5）はいつも。
  //   役割は今の社員の表（画面が使う役割と同じ。公開の鍵で書ける＝今の画面と同じ確かさ）、グレードは GM・CEO が確かめた写しとの狭いほう（whoami）。
  //   使い始めたか（live）は work-requests の whoami の答え（wr_settings・サーバーの鍵だけ）。分からないときは使い始めたとみなす（狭いほう）
  async function tipDecider(a) {
    if (!a) return false;
    if (TIP_DECIDE.includes(a.role)) return true;
    if (a.role !== 'staff' || !(a.grade >= 4) || a.confirmed !== true || typeof a.emp !== 'string' || !a.emp) return false;
    let e = null;
    try { const r = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=role,data'); e = Array.isArray(r) && r.length === 1 ? r[0] : null; } catch { return false; }
    if (!e) return false;
    const d = obj(e.data) || {}, role = String(e.role || d.role || '');
    const notLive = a.live === false;
    if (role === 'g4') return notLive;
    if (role === 'chef') return (a.grade >= 5 || notLive) && await confChef(a);
    return false;
  }

  // v1146（Codex #140 6766283780 の P3）：本人かを見るための、この人の名前。PIN の印・確かめた写しの名前（a.name）と、社員の表の自分の行の名前（列と data）。
  //   社員と結ばれていない人（社員 ID の無いメールのログイン）は a.name だけ（空なら本人かを決められない＝決めない・申請しない）。読めなければ失敗（500。端末は送り直す）
  async function tipActorNames(a) {
    const out = [a && a.name];
    if (a && typeof a.emp === 'string' && a.emp) {
      const r = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=name,data');
      for (const e of (Array.isArray(r) ? r : [])) { const d = obj(e && e.data) || {}; out.push(e && e.name, d.name); }
    }
    return out.filter(x => typeof x === 'string' && x.length <= 200);
  }

  // 目標を見せてよい人：本人。AM は担当の店（と自分の店）、G4 以上は自分の店の人（Career Score の一覧で見られる人）
  async function goalsGate(a) {
    const self = id => id === a.emp;
    self.sig = 's';
    let stores = [];
    if (a.role === 'am') stores = [...new Set([...a.am, ...a.stores])];
    else if (a.role === 'staff' && a.grade >= 4) stores = a.stores;
    if (!stores.length) return self;
    let emps = [], mgr = [], ams = [];
    try { [emps, mgr, ams] = await Promise.all([rest('employees?select=id,store&limit=5000'), rest('manager_auth?select=emp_id&limit=1000'), rest('wr_people?select=emp_id&role=eq.am&limit=1000')]); }
    catch { return self; }
    // 社員の表の店は公開の鍵で書けるので、CEO・GM・経理・事務Crew（manager_auth）と AM（GM・CEO が確かめた写し）の目標は、店を書き換えても見せない
    const top = new Set([...(Array.isArray(mgr) ? mgr : []), ...(Array.isArray(ams) ? ams : [])].map(x => String((x && x.emp_id) || '')).filter(Boolean));
    const ok = new Set((Array.isArray(emps) ? emps : []).filter(e => e && stores.includes(String(e.store || '')) && !top.has(String(e.id))).map(e => String(e.id)));
    const fn = id => self(id) || ok.has(id);
    fn.sig = 'g:' + [...ok].sort().join(',');
    return fn;
  }

  // ---- 行
  const IN = keys => 'in.(' + keys.map(k => '"' + String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
  const SEL_ALL = 'or=' + encodeURIComponent('(key.' + IN(SS_KEYS) + ',' + SS_PREFIX.map(p => 'key.like.' + p + '*').join(',') + ')');
  async function readRows(keys) {
    const q = keys ? 'key=' + encodeURIComponent(IN(keys)) : SEL_ALL;
    const rows = await rest('app_state?select=key,value,updated_at&' + q + '&limit=1000');
    return (Array.isArray(rows) ? rows : []).filter(r => r && ssIsKey(r.key) && r.key !== 'karte_pin');
  }
  // 行の一覧と印（md5）：app_state_index（v1098）があればそれ（サーバーの鍵で呼ぶ）。無ければ null
  // 独立レビュー P2-2：PostgREST は 1 回に返す行に上限（既定 1000）があるので、空のページが来るまで読む
  async function index() {
    try {
      const out = [];
      for (let off = 0, page = 0; page < 100; page++) {
        const rows = await rest('rpc/app_state_index?order=key.asc&limit=1000&offset=' + off, { method: 'POST', body: JSON.stringify({ p_skip_prefix: ['invoice_purchase_', 'lunch_photo_', 'spl_lss_history_'] }) });
        if (!Array.isArray(rows)) return null;
        if (!rows.length) break;
        off += rows.length;
        // v1140：Career Score のキーも（履歴は開いたときだけ取るので一覧に入れない）
        for (const r of rows) if (r && (ssIsKey(r.key) || (csIsKey(r.key) && csParse(r.key).kind !== 'hist')) && r.key !== 'karte_pin' && /^[0-9a-f]{32}$/.test(String(r.h || ''))) out.push({ key: r.key, v: 'h:' + r.h });
        if (page === 99) return null;   // 読み切れない：中身から作る
      }
      return out;
    } catch { return null; }
  }


  // ================================================================ v1140：Career Score
  // 行を読む（キーが多いときは URL が長くなりすぎないよう分ける）
  async function readKeysAny(keys) {
    const out = [];
    let batch = [], len = 0;
    const flush = async () => {
      if (!batch.length) return;
      const rows = await rest('app_state?select=key,value,updated_at&key=' + encodeURIComponent(IN(batch)) + '&limit=1000');
      if (Array.isArray(rows)) out.push(...rows);
      batch = []; len = 0;
    };
    for (const k of keys) {
      const el = encodeURIComponent(k).length + 8;
      if (len + el > 6000 && batch.length) await flush();
      batch.push(k); len += el;
    }
    await flush();
    return out.filter(r => r && csIsKey(r.key));
  }
  // Career Score の行を全部（履歴は hist のときだけ）。1000 行ずつ、空のページが来るまで（独立レビュー P3：上限の行数が 1000 より小さいサーバーでも切れない）。
  // 読み切れない（50 ページ）ときは失敗にする（途中までの一覧で、端末の写しを消さない）
  async function readCsAll(hist) {
    const q = hist ? 'key=like.spl_lss_history_*'
      : 'or=' + encodeURIComponent('(key.' + IN(CS_LEGACY) + ',key.like.lss_emp_*,key.like.spl_lss_requests_*)');
    const out = [];
    for (let off = 0, page = 0; ; page++) {
      if (page >= 50) throw err('db', 500);
      const rows = await rest('app_state?select=key,value,updated_at&' + q + '&order=key.asc&limit=1000&offset=' + off);
      if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows); off += rows.length;
    }
    return out.filter(r => r && csIsKey(r.key) && (hist ? csParse(r.key).kind === 'hist' : csParse(r.key).kind !== 'hist'));
  }
  // 人の表（社員の表・manager_auth・GM・CEO が確かめた写し・Score管理の権限）。社員の表の店・肩書き・役割・名前は公開の鍵で書けるので、
  // CEO・GM・経理・事務Crew（manager_auth）と AM（確かめた写し）の人は、店で決まる範囲には入れない（v1139 の目標と同じ）。
  // 退職の人も返す（同じ名前の人を見分けるため。範囲には入れない）。確かめた写しの名前が社員の表の名前と違えば、その名前も持つ（confName）
  async function csPeople() {
    const [emps, mgr, wrp, cfgRows] = await Promise.all([
      rest('employees?select=id,name,store,support,role,title,status,data&limit=5000'),
      rest('manager_auth?select=emp_id,role&limit=1000'),
      rest('wr_people?select=emp_id,name,role,grade&limit=2000'),
      rest('app_state?select=value&key=eq.career_cfg'),
    ]);
    const mrole = new Map(), conf = new Map();
    for (const m of (Array.isArray(mgr) ? mgr : [])) if (m && m.emp_id != null && MGR_ROLES.includes(m.role)) mrole.set(String(m.emp_id), m.role);
    for (const c of (Array.isArray(wrp) ? wrp : [])) if (c && c.emp_id != null) conf.set(String(c.emp_id), { role: c.role, grade: Number.isInteger(c.grade) ? c.grade : 0, name: typeof c.name === 'string' ? c.name : '' });
    const cfg = obj(Array.isArray(cfgRows) && cfgRows[0] ? cfgRows[0].value : null) || {};
    const list = [], ids = new Set();
    for (const e of (Array.isArray(emps) ? emps : [])) {
      if (!e || e.id == null || typeof e.name !== 'string' || !e.name) continue;
      const d = obj(e.data) || {}, id = String(e.id), c = conf.get(id) || null, mr = mrole.get(id) || '';
      const role = String(e.role || d.role || ''), title = String(e.title || d.title || '');
      const support = Array.isArray(e.support) ? e.support : (Array.isArray(d.support) ? d.support : []);
      const out = String(e.status || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true';
      const gL = wrGrade(title, role), gS = Math.max(gL, c ? c.grade : 0);
      const dept = (typeof d.career === 'string' && d.career) || TITLE_DEPT[title] || '';
      const ag = appGrade(title, role);
      const cfgView = [], cfgEdit = [], cfgApprove = [];
      if (SPEC_DEPTS.includes(dept) && ag) {
        const x = obj(cfg[dept + '|' + (ag === 'G1-P' ? 'G1' : ag)]);
        const pick = f => (x && !x._deleted && Array.isArray(x[f])) ? x[f].filter(r => typeof r === 'string') : [];
        cfgEdit.push(...pick('csEdit')); cfgApprove.push(...pick('csApprove'));
        cfgView.push(...pick('csView'), ...cfgEdit, ...cfgApprove);   // 付ける・承認する役は見られる（アプリの cgCsGranted と同じ）
      }
      ids.add(id);
      list.push({ id, name: e.name, confName: c && c.name && c.name !== e.name ? c.name : '', store: String(e.store || d.store || ''), support: support.filter(x => typeof x === 'string'), role, title, out, gS,
        top: !!mr || !!(c && c.role === 'am'), boss: mr === 'ceo' || mr === 'gm', confAm: !!(c && c.role === 'am'), cfgView, cfgEdit, cfgApprove });
    }
    // 確かめた写しにだけある人（社員の表に行が無い）：その名前はだれにも見せない
    for (const [id, c] of conf) if (!ids.has(id) && c.name) list.push({ id, name: c.name, confName: '', store: '', support: [], role: '', title: '', out: true, gS: 0, top: true, boss: false, confAm: c.role === 'am', cfgView: [], cfgEdit: [], cfgApprove: [] });
    return list;
  }
  // 見られる人（see）・申請を見られる人（req）・点（lss_emp_）を書ける人（emp：そのまま／ojt：分野の下限を上げるだけ＝名前 → 上げてよい上限）・
  // 履歴を書ける人（hist）・本人（self）。名前の Set（Map）。
  // 点・申請・履歴は名前で持っているので、名前で決める。社員の表の名前は公開の鍵で書き換えられるので（独立レビュー P1-1）、
  // その名前を持つ人（社員の表の名前・確かめた写しの名前。退職の人も）が全員その範囲に入るときだけ、その名前を渡す。
  // 本人の名前は、その名前を持つのが本人だけのときだけ。本人とほかの人が同じ名前なら、その名前は渡さない（だれの点か分からない）
  async function csScope(a) {
    const P = await csPeople();
    const actorId = String(a.emp || '');
    const me = actorId ? (P.find(p => p.id === actorId && !p.out) || null) : null;
    const isChef = a.role === 'staff' && a.grade >= 4 && !!me && (me.role === 'chef' || CHEF_TITLES.includes(me.title)) && await confChef(a);   // v1144：確かめた写しでも Head Chef
    // Score管理（career_cfg）の役職：アプリの役割と同じ名前
    const R = ['office', 'office_crew', 'am'].includes(a.role) ? a.role
      : a.role === 'staff' ? (isChef ? 'chef' : a.grade >= 4 ? 'g4' : a.grade === 3 ? 'sl' : '') : '';
    const S = a.role === 'am' ? [...new Set([...a.am, ...a.stores])] : a.stores;
    const inStores = p => S.length > 0 && (S.includes(p.store) || p.support.some(x => S.includes(x)));
    const okOf = p => {
      if (p.out) return null;
      let vis = false;
      if (a.role === 'am') vis = !p.top && inStores(p);
      else if (a.role === 'staff') {
        if (isChef) vis = !p.top && !OFFICE_ROLES.includes(p.role);              // Head Chef：全店の人（申請と、その判断に要る点。本部の事務の人は入れない）
        else if (a.grade >= 4) vis = !p.top && inStores(p) && p.gS <= 4;          // G4：自分の店の G4 以下
        else if (a.grade === 3) vis = !p.top && inStores(p) && p.gS <= 2;         // G3：自分の店の G1・G2
        else if (a.grade === 2) vis = !p.top && inStores(p) && p.gS === 1;        // Crew Leader：自分の店の G1
      } else if (a.role === 'office' || a.role === 'office_crew') vis = HQ_ROLES.includes(p.role) && !p.boss && !p.confAm;   // 本部の人（Office管理のメンバー）
      // Score管理で選ばれた役（GM・CEO・確かめた AM の人は除く。G4 は G4 以下。G4・G3 は自分の店の人だけ＝一覧と同じ）
      const gOk = !!R && !p.boss && !p.confAm && (R !== 'g4' || p.gS <= 4) && (!['g4', 'sl'].includes(R) || inStores(p));
      const gView = gOk && p.cfgView.includes(R);
      // 点・履歴を直接書く：承認する役（承認すると点と履歴を書く）。付ける役は AM だけが直接（AM より下の役は申請＝アプリの lssNeedsApproval）
      const gWrite = gOk && (p.cfgApprove.includes(R) || (R === 'am' && p.cfgEdit.includes(R)));
      const full = (a.role === 'am' && vis) || gWrite;
      // OJT の合格（ワークセンターを使い始める前は直接）：サインできる人（G3 以上＝アプリの g2CanEdit）が、範囲の G1・G2（OJT の相手）の分野の下限を上げるだけ
      const ojt = !full && a.role === 'staff' && a.grade >= 3 && vis && p.gS <= 2;
      return { see: vis || gView, req: vis || gView, emp: full ? 2 : ojt ? 1 : 0, hist: full, cap: p.gS <= 1 ? 2 : 3 };
    };
    const byName = new Map();
    const hold = (n, p) => { if (!n) return; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(p); };
    for (const p of P) { hold(p.name, p); hold(p.confName, p); }
    const onlyMe = n => { const hs = byName.get(n); return !!hs && hs.length > 0 && hs.every(h => h.id === actorId); };
    const see = new Set(), req = new Set(), emp = new Set(), ojt = new Map(), hist = new Set(), self = new Set();
    if (me && onlyMe(me.name)) self.add(me.name);
    if (me && a.name && a.name !== me.name) {
      if (onlyMe(a.name)) self.add(a.name);                                       // GM・CEO が確かめた写しの名前（社員の表はまだ前の名前）
      else if (a.name.trim() === me.name.trim() && onlyMe(me.name) && !byName.has(a.name)) self.add(a.name);   // 名前の前後の空白だけ違う
    }
    for (const [n, hs] of byName) {
      if (hs.some(h => h.id === actorId)) continue;                               // 本人の名前（上）。本人とほかの人が同じ名前なら渡さない
      const oks = hs.map(okOf);
      if (oks.some(o => !o)) continue;                                            // 退職の人・社員の表に無い人と同じ名前
      if (oks.every(o => o.see)) see.add(n);
      if (oks.every(o => o.req)) req.add(n);
      if (oks.every(o => o.emp === 2)) emp.add(n);
      else if (oks.every(o => o.emp >= 1)) ojt.set(n, Math.min(...oks.map(o => o.cap)));
      if (oks.every(o => o.hist)) hist.add(n);
    }
    for (const n of self) { see.add(n); req.add(n); }                            // 自分の点・履歴は書けない（自己評価は申請）
    return { see, req, emp, ojt, hist, self };
  }
  const csSig = sc => [...sc.see].sort().join('\u0001') + '\u0002' + [...sc.req].sort().join('\u0001');
  function csProject(key, value, sc) {
    if (key === 'lss_scores') { const m = obj(value) || {}; const o = {}; for (const [n, v] of Object.entries(m)) if (sc.see.has(n)) o[n] = v; return o; }
    const list = Array.isArray(value) ? value : [];
    const set = key === 'lss_requests' ? sc.req : sc.see;
    return list.filter(r => obj(r) && typeof r.name === 'string' && set.has(r.name));
  }
  function csCanRead(p, sc) {
    if (p.kind === 'legacy') return true;
    return p.kind === 'req' ? sc.req.has(p.name) : sc.see.has(p.name);
  }

  async function csPull(a, b, idx) {
    const level = levelOf(a);
    if (level === 'none') return { level: 'none', names: [], req_names: [], index: [], rows: [] };
    const have = obj(b.cs_have) || {};
    if (level === 'full') {
      if (idx) {
        const need = idx.filter(x => have[x.key] !== x.v).map(x => x.key);
        const ver = Object.fromEntries(idx.map(x => [x.key, x.v]));
        const rows = need.length ? await readKeysAny(need) : [];
        return { level, names: null, req_names: null, index: idx, rows: rows.filter(r => ver[r.key]).map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, v: ver[r.key] })) };
      }
      const rows = await readCsAll(false), out = [];
      for (const r of rows) out.push({ key: r.key, value: r.value, updated_at: r.updated_at, v: 'x:' + await sha256(JSON.stringify(r.value)) });
      return { level, names: null, req_names: null, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
    }
    const sc = await csScope(a), sig = await sha256(csSig(sc));
    const names = [...sc.see].sort(), req_names = [...sc.req].sort();
    let base;   // [{key, v（元の行の印）}]
    if (idx) base = idx;
    else {
      const rows = await readCsAll(false);
      base = [];
      for (const r of rows) base.push({ key: r.key, v: 'x:' + await sha256(JSON.stringify(r.value)), row: r });
    }
    const sidx = [];
    for (const x of base) {
      const p = csParse(x.key);
      if (!p || !csCanRead(p, sc)) continue;
      sidx.push({ key: x.key, v: p.kind === 'legacy' ? 'p:' + await sha256(x.v + '|' + sig) : x.v, row: x.row });
    }
    const need = sidx.filter(x => have[x.key] !== x.v);
    let rows = need.filter(x => x.row).map(x => x.row);
    const toRead = need.filter(x => !x.row).map(x => x.key);
    if (toRead.length) rows = rows.concat(await readKeysAny(toRead));
    const ver = Object.fromEntries(sidx.map(x => [x.key, x.v]));
    return { level: 'scoped', names, req_names, index: sidx.map(x => ({ key: x.key, v: x.v })),
      rows: rows.filter(r => ver[r.key]).map(r => ({ key: r.key, value: csParse(r.key).kind === 'legacy' ? csProject(r.key, r.value, sc) : r.value, updated_at: r.updated_at, v: ver[r.key] })) };
  }
  // 履歴（開いたときだけ）：見られる人の spl_lss_history_
  async function csHist(a) {
    const level = levelOf(a);
    if (level === 'none') throw err('forbidden', 403);
    const rows = await readCsAll(true);
    if (level === 'full') return { level, names: null, rows: rows.map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at })) };
    const sc = await csScope(a);
    return { level: 'scoped', names: [...sc.see].sort(), rows: rows.filter(r => sc.see.has(csParse(r.key).name)).map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at })) };
  }
  async function csGet(a, key) {
    const level = levelOf(a);
    if (level === 'none') throw err('forbidden', 403);
    const p = csParse(key);
    let sc = null;
    if (level !== 'full') { sc = await csScope(a); if (!csCanRead(p, sc)) throw err('forbidden', 403); }
    const rows = await readKeysAny([key]);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    const r = rows[0];
    if (sc && p.kind === 'legacy') return { exists: true, value: csProject(key, r.value, sc), updated_at: r.updated_at, proj: true };
    return { exists: true, value: r.value, updated_at: r.updated_at };
  }
  // 書く前の確かめ（CEO・GM 以外）。cur：今の行の値（無ければ null）。ダメなら forbidden（403）か bad_value（400）
  // OJT の合格で分野の下限を上げるだけか（アプリの g2RaiseAxisFloor）：点を下げない・消さない・上げるのは上限（G1 は 2、G2 は 3）まで。
  // 点のほかの欄は変えない（日付・OJT の印・保存の印は変えてよい。評価者・状態は無かったときだけ入れてよい）。base：今の点（無ければ前の統合行のその人の分）
  const OJT_FREE = new Set(['scores', 'date', 'autoOjt', '_at', '_by', '_set', 'evaluator', 'status']);
  function ojtRaiseOk(base, value, cap) {
    const c = obj(base) || {};
    if (!obj(value)) return false;
    for (const k of new Set([...Object.keys(c), ...Object.keys(value)])) {
      if (OJT_FREE.has(k)) continue;
      if (canon(c[k] === undefined ? null : c[k]) !== canon(value[k] === undefined ? null : value[k])) return false;
    }
    for (const k of ['evaluator', 'status']) {
      const had = c[k] !== undefined && c[k] !== null && c[k] !== '';
      if (had ? canon(c[k]) !== canon(value[k] === undefined ? null : value[k]) : (value[k] != null && (typeof value[k] !== 'string' || value[k].length > 60))) return false;
    }
    if (value.autoOjt !== undefined && value.autoOjt !== true && canon(value.autoOjt) !== canon(c.autoOjt === undefined ? null : c.autoOjt)) return false;
    const cs = obj(c.scores) || {}, vs = obj(value.scores);
    if (!vs) return false;
    for (const id of Object.keys(cs)) if (!Object.prototype.hasOwnProperty.call(vs, id)) return false;     // 消さない
    for (const [id, v] of Object.entries(vs)) {
      const had = Object.prototype.hasOwnProperty.call(cs, id);
      if (had && canon(cs[id]) === canon(v)) continue;
      const before = had ? (parseInt(cs[id], 10) || 0) : 0;
      if (typeof v !== 'number' || !Number.isInteger(v) || v > cap || v <= before) return false;            // 上げるだけ・上限まで
    }
    return true;
  }
  function csCheck(p, value, cur, sc, base) {
    if (p.kind === 'legacy') throw err('forbidden', 403);                          // 前の統合行は CEO・GM だけ（見せる形で書き戻さない）
    const may = p.kind === 'req' ? sc.req.has(p.name) : p.kind === 'emp' ? (sc.emp.has(p.name) || sc.ojt.has(p.name)) : sc.hist.has(p.name);
    if (!may) throw err('forbidden', 403);
    if (JSON.stringify(value === undefined ? null : value).length > 2000000) throw bad();
    if (p.kind === 'emp') {
      if (!obj(value)) throw bad();
      if (!sc.emp.has(p.name) && !ojtRaiseOk(cur != null ? cur : base, value, sc.ojt.get(p.name))) throw err('forbidden', 403);   // OJT の合格だけ（独立レビュー P2-2）
      return;
    }
    if (!Array.isArray(value) || value.length > 5000) throw bad();
    if (!value.every(r => obj(r) && r.name === p.name)) throw bad();              // 別の人の記録を混ぜない
    const curList = Array.isArray(cur) ? cur.filter(r => obj(r)) : [];
    if (p.kind === 'hist') {                                                       // 履歴は足すだけ（消さない・書き換えない）
      const have = new Set(value.map(canon));
      if (!curList.every(r => have.has(canon(r)))) throw err('forbidden', 403);
      return;
    }
    // 申請：今ある申請を消さない
    const byId = new Map(value.filter(r => r.id != null).map(r => [String(r.id), r]));
    if (!curList.every(r => r.id == null || byId.has(String(r.id)))) throw err('forbidden', 403);
    if (!sc.self.has(p.name)) return;
    // 自分の申請の行：新しい申請（申請中）を足す・自分で取り下げる（取消）だけ。自分で承認・却下しない・ほかの人が出した申請を書き換えない
    const curById = new Map(curList.filter(r => r.id != null).map(r => [String(r.id), r]));
    const strip = o => { const x = { ...o }; delete x.status; delete x.supersededAt; delete x.wr; delete x._mut; return canon(x); };
    for (const r of value) {
      const c = r.id == null ? null : curById.get(String(r.id));
      if (!c) { if (!pendingSt(r.status)) throw err('forbidden', 403); continue; }
      if (canon(c) === canon(r)) continue;
      if (strip(c) !== strip(r)) throw err('forbidden', 403);
      if (r.status !== c.status && !(pendingSt(c.status) && r.status === '取消')) throw err('forbidden', 403);
    }
  }
  async function csPut(a, b) {
    const key = b.key, p = csParse(key);
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    if (levelOf(a) === 'full') return writeRow(key, b.value, e);
    if (levelOf(a) === 'none') throw err('forbidden', 403);
    const sc = await csScope(a);
    const rows = await readKeysAny([key]), cur = rows[0] || null;
    let base = null;   // OJT の合格で点の行がまだ無い人：アプリは前の統合行のその人の分から下限を上げる（getLssScores）
    if (p.kind === 'emp' && !cur && !sc.emp.has(p.name) && sc.ojt.has(p.name)) {
      const lg = await readKeysAny(['lss_scores']);
      const m = lg[0] && obj(lg[0].value);
      base = m && obj(m[p.name]) ? m[p.name] : null;
    }
    csCheck(p, b.value, cur ? cur.value : null, sc, base);
    // 確かめた行に書く（読んだあとに変わっていれば conflict）。expect があればそれとも合わせる
    if (e) {
      if (e.exists && e.updated_at != null && tsMicro(e.updated_at) == null) throw bad();
      if (!!cur !== e.exists) throw err('conflict', 409);
      if (cur && (e.updated_at == null ? cur.updated_at != null : tsMicro(cur.updated_at) !== tsMicro(e.updated_at))) throw err('conflict', 409);
    }
    return writeRow(key, b.value, cur ? { exists: true, updated_at: cur.updated_at } : { exists: false });
  }

  async function pull(a, b) {
    // v1140：Career Score（cs_have を送ってきたアプリ＝v1140 から。前の版のアプリには付けない）
    const wantCs = obj(b.cs_have) !== null;
    const idxAll = levelOf(a) === 'none' ? null : await index();
    const out = await pullKb(a, b, idxAll && idxAll.filter(x => ssIsKey(x.key)));
    if (wantCs) {
      try { out.cs = await csPull(a, b, idxAll && idxAll.filter(x => csIsKey(x.key))); }
      catch (e) { console.error('secure-state cs pull', safeErr(e)); out.cs = { error: 'scope' }; }   // 見られる人を決められなかった：端末の写しはそのまま
    }
    return out;
  }
  async function pullKb(a, b, idx0) {
    const level = levelOf(a);
    if (level === 'none') return { level, index: [], rows: [] };
    const have = obj(b.have) || {};
    if (level === 'full') {
      const idx = idx0;
      if (idx) {
        const need = idx.filter(x => have[x.key] !== x.v).map(x => x.key);
        const rows = need.length ? await readRows(need) : [];
        const ver = Object.fromEntries(idx.map(x => [x.key, x.v]));
        return { level, index: idx, rows: rows.map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, v: ver[r.key] || null })).filter(r => r.v) };
      }
      const rows = await readRows(null);
      const out = [];
      for (const r of rows) out.push({ key: r.key, value: r.value, updated_at: r.updated_at, v: 'x:' + await sha256(JSON.stringify(r.value)) });
      return { level, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
    }
    // proj：見せる形にしてから印を付ける。印は元の行の印（md5）と見せる範囲から作り、変わっていなければ行を読まない
    //（成長カルテは大きく、CEO・GM 以外のログインと 10 分ごとの同期のたびに読んでいた：独立レビュー P3）
    const gate = await goalsGate(a);
    const idx = idx0;
    if (idx) {
      const pidx = [];
      for (const x of idx) if (SS_PROJ.includes(x.key)) pidx.push({ key: x.key, v: 'p:' + await sha256(x.v + '|' + (x.key === 'growth_karte' ? a.emp + '|' + gate.sig : '')) });
      const need = pidx.filter(x => have[x.key] !== x.v).map(x => x.key);
      const rows = need.length ? await readRows(need) : [];
      const pv = Object.fromEntries(pidx.map(x => [x.key, x.v]));
      return { level, index: pidx, rows: rows.filter(r => pv[r.key]).map(r => ({ key: r.key, value: r.key === 'growth_karte' ? projKarte(r.value, gate) : projKbCfg(r.value), updated_at: r.updated_at, v: pv[r.key] })) };
    }
    const rows = await readRows(SS_PROJ);
    const out = [];
    for (const r of rows) {
      const value = r.key === 'growth_karte' ? projKarte(r.value, gate) : projKbCfg(r.value);
      out.push({ key: r.key, value, updated_at: r.updated_at, v: 'p:' + await sha256(JSON.stringify(value)) });
    }
    return { level, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
  }

  async function get(a, b) {
    const key = b.key;
    if (csIsKey(key)) return csGet(a, key);   // v1140
    if (!ssIsKey(key) || key === 'karte_pin') throw bad();
    const level = levelOf(a);
    if (level === 'none' || (level === 'proj' && !SS_PROJ.includes(key))) throw err('forbidden', 403);
    const rows = await readRows([key]);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    const r = rows[0];
    if (level === 'proj') return { exists: true, value: key === 'growth_karte' ? projKarte(r.value, await goalsGate(a)) : projKbCfg(r.value), updated_at: r.updated_at, proj: true };
    return { exists: true, value: r.value, updated_at: r.updated_at };
  }

  // 書く。expect が無い：今までの upsert と同じ（読んだ行によらず書く）。expect.exists=false：行が無いときだけ。expect.exists=true：updated_at が同じときだけ
  // v1141：決めた人だけが書ける設定。決めた人でなくても、クラウドと同じ値なら書かずに通す（一括の送り直しなどで、変えていない設定を送っても止まらない）
  async function swPut(a, b) {
    const key = b.key;
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    const cur = async () => { const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key)); return Array.isArray(rows) && rows[0] ? rows[0] : null; };
    if (!SW_WRITE[key].includes(a.role)) {
      // 決めた人でなければ書かない。クラウドと同じ値なら（まとめて送り直す端末のため）書かずに通す。
      // 書かないので値の形は見ない（クラウドの値そのものの形がおかしくても、送り直しが止まらないように＝独立レビュー P3-6）
      const c = await cur();
      if (c && canon(c.value) === canon(b.value)) return { ok: true, updated_at: c.updated_at, same: true };
      throw err('forbidden', 403);
    }
    let cloud;
    if (swMapKey(key) && swCgBadKeys(b.value, swMapMax(key)).length) { const c = await cur(); cloud = c ? c.value : null; }
    if (!swShapeOk(key, b.value, cloud)) throw bad();
    // by：書いた人の役割（アプリが「設定 › 診断と記録」に残す。③ の前の確かめで、関数が決めた人として書いたことが分かる：Codex #135 の P2）
    return { ...(await writeRow(key, b.value, e)), by: a.role };
  }

  // v1146：Tip Rate・プレップ。読んだ行で確かめ（tpCheck）、その行が変わっていないときだけ書く
  async function tpPut(a, b) {
    const key = b.key;
    if (!Object.prototype.hasOwnProperty.call(b, 'value') || key.length > 200) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key));
    const c = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (c && canon(c.value) === canon(b.value)) return { ok: true, updated_at: c.updated_at, same: true, by: a.role };   // クラウドと同じ：書かずに通す
    // 端末が読んだ行（expect）から変わっていれば 409（端末は読み直して合わせてから送り直す。古い写しを「断られた」にしない）
    if (e && (e.exists !== !!c || (c && e.exists && tsMicro(e.updated_at) !== tsMicro(c.updated_at)))) throw err('conflict', 409);
    const dec = key.startsWith(TP_TIP_PRE) ? await tipDecider(a) : false;   // 名前の分からない人は申請を足せない・決めない（本人かを決められない：tpCheck）
    const names = key.startsWith(TP_TIP_PRE) ? await tipActorNames(a) : [];
    const v = tpCheck(key, c ? c.value : null, b.value, { role: a.role, name: a.name, names, dec });
    if (v === 'bad') throw bad();
    if (v !== 'ok') throw err('forbidden', 403);
    // 確かめた行に条件を付けて書く（確かめたあと・書く前にほかの端末が書いていれば 409）
    return { ...(await writeRow(key, b.value, c ? { exists: true, updated_at: c.updated_at } : { exists: false })), by: a.role };
  }

  async function put(a, b) {
    const key = b.key;
    if (tpIsKey(key)) return tpPut(a, b);   // v1146
    if (swIsKey(key)) return swPut(a, b);   // v1141
    if (csIsKey(key)) return csPut(a, b);   // v1140
    if (!ssIsKey(key) || key === 'karte_pin') throw bad();
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    return writeRow(key, b.value, b.expect);
  }
  async function writeRow(key, value, e) {
    const b = { value };
    const pref = { prefer: 'return=representation' };
    if (e === undefined || e === null) {
      const ts = new Date(now()).toISOString();
      const rows = await rest('app_state?select=key,updated_at', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ key, value: b.value, updated_at: ts }) });
      return { ok: true, updated_at: Array.isArray(rows) && rows[0] ? rows[0].updated_at : ts };
    }
    if (!obj(e) || typeof e.exists !== 'boolean') throw bad();
    if (!e.exists) {
      const ts = new Date(now()).toISOString();
      try {
        const rows = await rest('app_state?select=key,updated_at', { method: 'POST', headers: pref, body: JSON.stringify({ key, value: b.value, updated_at: ts }) });
        return { ok: true, updated_at: Array.isArray(rows) && rows[0] ? rows[0].updated_at : ts };
      } catch (x) { if (x.code === 'conflict') throw err('conflict', 409); throw x; }
    }
    const rt = e.updated_at;
    let ts;
    if (rt == null) ts = new Date(now()).toISOString();
    else {
      const base = tsMicro(rt);
      if (base == null) throw bad();
      ts = new Date(Math.max(now(), Math.floor(base / 1000) + 1)).toISOString();   // 読んだ時刻より後の、次のミリ秒の境目以降（アプリの _casTs と同じ）
    }
    const cond = rt == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(String(rt));
    const rows = await rest('app_state?key=eq.' + encodeURIComponent(key) + '&' + cond + '&select=key,updated_at', { method: 'PATCH', headers: pref,
      body: JSON.stringify({ value: b.value, updated_at: ts }) });
    if (!(Array.isArray(rows) && rows.length === 1)) throw err('conflict', 409);
    return { ok: true, updated_at: rows[0].updated_at };
  }

  // ---- 成長カルテの PIN（4 桁）。サーバーで確かめる。値は app_state の karte_pin に、PIN そのものではなく PBKDF2 の印で置く
  //   （前の版の平文の値・行が無いとき（初期値 1234）も確かめられる。合えば印に置き換える）
  const PIN_RE = /^\d{4}$/;
  async function pbkdf2(pin, saltHex, it) {
    const salt = new Uint8Array(saltHex.match(/../g).map(x => parseInt(x, 16)));
    const k = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, 256));
  }
  const same = (x, y) => { if (typeof x !== 'string' || typeof y !== 'string' || x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0; };
  async function pinRow() {
    const rows = await rest('app_state?select=value,updated_at&key=eq.karte_pin');
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  async function pinMatches(row, pin) {
    const v = row ? row.value : null;
    if (v == null || v === '') return same(pin, '1234');                         // 行が無い：今までの初期値
    if (typeof v === 'string' || typeof v === 'number') return same(pin, String(v));   // 前の版の平文
    const o = obj(v);
    if (!o || typeof o.h !== 'string' || typeof o.s !== 'string' || !/^[0-9a-f]{32}$/.test(o.s) || !Number.isInteger(o.it) || o.it < 1000 || o.it > 2000000) return false;
    return same(await pbkdf2(pin, o.s, o.it), o.h);
  }
  async function pinStore(pin, row, by) {
    const s = hex(crypto.getRandomValues(new Uint8Array(16))), it = 150000;
    const value = { h: await pbkdf2(pin, s, it), s, it, at: new Date(now()).toISOString(), by: String(by || '').slice(0, 64) };
    if (row) {
      const cond = row.updated_at == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(String(row.updated_at));
      const base = tsMicro(row.updated_at);
      const ts = new Date(Math.max(now(), base == null ? 0 : Math.floor(base / 1000) + 1)).toISOString();
      const r = await rest('app_state?key=eq.karte_pin&' + cond + '&select=key', { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ value, updated_at: ts }) });
      return Array.isArray(r) && r.length === 1;
    }
    try { await rest('app_state?select=key', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ key: 'karte_pin', value, updated_at: new Date(now()).toISOString() }) }); return true; }
    catch (x) { if (x.code === 'conflict') return false; throw x; }
  }
  function pinGuard(a) {
    const k = String(a.emp || a.role), t = now(), list = (fails.get(k) || []).filter(x => t - x < 10 * 60000);
    fails.set(k, list);
    if (list.length >= 5) throw err('locked', 429);
    return () => { list.push(t); fails.set(k, list); };
  }
  async function pinCheck(a, b) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (typeof b.pin !== 'string' || !PIN_RE.test(b.pin)) return { ok: false };
    const miss = pinGuard(a);
    const row = await pinRow();
    if (!(await pinMatches(row, b.pin))) { miss(); return { ok: false }; }
    fails.delete(String(a.emp || a.role));
    if (!row || !obj(row.value)) { try { await pinStore(b.pin, row, a.emp); } catch { /* 印に置き換えられなくても、合ったことは返す */ } }
    return { ok: true };
  }
  async function pinSet(a, b) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (typeof b.pin !== 'string' || !PIN_RE.test(b.pin) || typeof b.cur !== 'string' || !PIN_RE.test(b.cur)) throw bad();
    const miss = pinGuard(a);
    const row = await pinRow();
    if (!(await pinMatches(row, b.cur))) { miss(); return { ok: false, why: 'cur' }; }
    fails.delete(String(a.emp || a.role));
    if (!(await pinStore(b.pin, row, a.emp))) throw err('conflict', 409);
    return { ok: true };
  }

  // ================================================================ v1142：採用（応募者・不採用ログ）とお悩み相談室（docs/SECURE_HR_V1142_JA.md）
  // 見られる範囲はサーバーが決める（今の画面と同じ。Moto さん 11/04：不採用ログの全部は CEO・GM・経理、AM・店長は担当・自分の店の分だけ。
  // お悩み相談室は今のまま）。社員の表（役割・肩書き・店）と店の表（ブランド）は公開の鍵で書けるので、AM の担当の店は GM・CEO が確かめた写し、
  // G3 以上の店は確かめた写しと今の社員の表の重なり（work-requests の whoami が決めた a.am・a.stores）を使う。
  async function hrScope(a) {
    const sc = { all: false, ap: [], gh: [], mgr: false, name: typeof a.name === 'string' ? a.name.trim() : '', store: '' };
    // 何も見せない・本人の分も無い（名前を残さない）：退職・OS を止めた・社員がいない人。PIN の確かめは 60 秒覚えているので、
    // そのあいだに退職にしても、ここで今の社員の表を見て止める（Codex #136 6736973993 の P2-1：前は名前が残り、本人の相談を読み書きできた）
    const none = { ...sc, name: '' };
    const out = e => { const d = obj(e && e.data) || {}; return String((e && e.status) || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true'; };
    if (HR_ALL.includes(a.role)) {
      if (a.emp) {   // 社員と結ばれている CEO・GM・経理も、今の社員の表で退職・OS 停止なら止める（メールのログインは emailActor が止める。PIN は 60 秒のあいだ）
        const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,status,data');
        // 社員の行が無くなった（消した）人も止める（Codex #136 6738169923 の P2-1：前は行が無いと「退職でない」になり、PIN を覚えている 60 秒のあいだ全部が見えた）。
        // 社員と結ばれていないメールのログイン（a.emp が空）は今までどおり
        const e0 = Array.isArray(es) ? es[0] : null;
        if (!e0 || out(e0)) return none;
      }
      return { ...sc, all: true, mgr: true, name: sc.name || HR_LABEL[a.role] };   // 社員と結ばれていないメールのログインも（担当の名前）
    }
    if (!a.emp) return none;
    const [es, st] = await Promise.all([
      rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,name,role,title,store,status,data'),
      rest('stores?select=id,name,brand,data&limit=1000'),
    ]);
    const e = Array.isArray(es) ? es[0] : null;
    if (!e) return none;
    const d = obj(e.data) || {};
    if (out(e)) return none;
    const rr = String(e.role || d.role || ''), title = String(e.title || d.title || '');
    const home = String(e.store || d.store || '');
    sc.store = home;
    if (!sc.name && typeof e.name === 'string') sc.name = e.name.trim();
    if (a.role !== 'am' && a.role !== 'staff') return sc;                        // 事務Crew：応募者・不採用ログは見ない（今の画面と同じ）。相談は自分の分だけ
    const S = (Array.isArray(st) ? st : []).filter(s => s && s.id != null);
    const labels = (ids, withName) => {
      const out = [];
      for (const s of S) if (ids.includes(String(s.id))) {
        const sd = obj(s.data) || {};   // 列が空なら中身（data）の値（アプリは同じものを両方に書く）
        const brand = typeof s.brand === 'string' && s.brand.trim() ? s.brand : sd.brand, name = typeof s.name === 'string' && s.name.trim() ? s.name : sd.name;
        if (typeof brand === 'string' && brand.trim()) out.push(brand.trim());
        if (withName && typeof name === 'string' && name.trim()) out.push(name.trim());
      }
      return [...new Set(out)];
    };
    const own = a.stores.includes(home) ? [home] : [];                           // 自分の店（配属の店。whoami の店の中にあるときだけ）
    // G4・店長（Store Manager＝G4）の範囲は、GM・CEO が確かめた写しのある人だけ（社員の表の役割・肩書きは公開の鍵で書けるので、
    // 確かめた写しの無い人のグレードは whoami が 3 までにする。独立レビュー 7e3f878 P2-3）。確かめがまだの AM・G4 は G3 と同じ（配属の店）
    const g4ok = a.confirmed === true && Number(a.grade) >= 4;
    if (a.role === 'am') { sc.ap = [...labels(a.am, false), HR_UNSORTED]; sc.gh = [...a.am]; sc.mgr = true; }
    else if ((rr === 'g4' || rr === 'am') && g4ok) { sc.ap = [...labels(own, false), HR_UNSORTED]; sc.gh = own; sc.mgr = true; }   // アプリ：G4 は AM 扱い（担当＝配属の店）
    else if (rr === 'g4' || rr === 'am' || rr === 'sl' || rr === 'g2') {        // アプリ：G2 は SL 扱い。店長（SL・Store Manager）は相談も
      sc.ap = labels(own, true);
      if (rr === 'sl' && title === 'Store Manager' && g4ok) { sc.gh = own; sc.mgr = true; }
    }
    return sc;
  }
  const hrApIn = (sc, r) => sc.all || sc.ap.includes(String((r && r.store) || '').trim());
  const hrGhMgr = (sc, p) => sc.all || (sc.mgr && sc.gh.includes(String((p && p.store) || '')));
  const hrOwn = (sc, p) => !!sc.name && !!p && typeof p.author === 'string' && p.author.trim() === sc.name;
  function hrProject(key, value, sc, log) {
    const list = Array.isArray(value) ? value.filter(x => obj(x)) : [];
    if (key === 'applicants') {
      return list.filter(r => hrApIn(sc, r)).map(r => {
        const x = { ...r };
        delete x._prior;
        if (AP_ACTIVE.includes(x.status)) { const m = hrMatches(x, log); if (m.length) x._prior = m.slice(-5).map(hrPrior); }
        return x;
      });
    }
    if (key === 'reject_log') return list.filter(r => hrApIn(sc, r));
    return list.filter(p => hrGhMgr(sc, p) || hrOwn(sc, p));                       // growthhub
  }
  const hrLevel = (key, sc) => (sc.all ? 'all' : key === 'growthhub' ? 'scoped' : (sc.ap.length ? 'scoped' : 'none'));
  async function hrRow(key) {
    const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key));
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  async function hrView(key, sc) {
    const [row, lg] = await Promise.all([hrRow(key), key === 'applicants' ? hrRow('reject_log') : Promise.resolve(null)]);
    const log = lg && Array.isArray(lg.value) ? lg.value.filter(x => obj(x)) : [];
    return { exists: !!row, value: hrProject(key, row ? row.value : null, sc, log), updated_at: row ? row.updated_at : null, level: hrLevel(key, sc) };
  }
  // 読んで・直して・読んだ行が変わっていないときだけ書く（変わっていれば読み直してやり直す。5 回まで）。fn が undefined を返せば書かない
  async function hrRmw(key, fn) {
    for (let i = 0; i < 5; i++) {
      const row = await hrRow(key);
      if (row && row.value != null && !Array.isArray(row.value)) throw err('db', 500);   // 配列でない行（形が違う）：空とみなして上書きしない
      const cur = row && Array.isArray(row.value) ? row.value : [];
      const next = fn(cur.slice());
      if (next === undefined) return false;
      if (JSON.stringify(next).length > 8000000) throw bad();
      try { await writeRow(key, next, row ? { exists: true, updated_at: row.updated_at } : { exists: false }); return true; }
      catch (x) { if (x.code !== 'conflict') throw x; }
    }
    throw err('conflict', 409);
  }
  async function hrGet(a, b) {
    if (!hrIsKey(b.key)) throw bad();
    return hrView(b.key, await hrScope(a));
  }
  // 応募の入力の「前に不採用」の確かめ：全店の不採用ログから、当たった分だけ（Moto さん 11/04）。応募者を足せる人だけ
  async function hrMatch(a, b) {
    const sc = await hrScope(a);
    if (!sc.all && !sc.ap.length) throw err('forbidden', 403);
    const probe = { name: hrStr(b.name, 120), phone: hrStr(b.phone, 60), email: hrStr(b.email, 200) };
    const lg = await hrRow('reject_log');
    return { matches: hrMatches(probe, lg && Array.isArray(lg.value) ? lg.value.filter(x => obj(x)) : []).slice(-5).map(hrPrior) };
  }
  async function hrOp(a, b) {
    const key = b.key, op = b.op;
    if (!hrIsKey(key) || key === 'reject_log' || typeof op !== 'string') throw bad();
    const sc = await hrScope(a);
    if (key === 'applicants') {
      if (op === 'put') {
        const rec = hrApClean(b.rec);
        if (!rec) throw bad();
        const base = b.create === true ? null : hrApClean(b.base);                 // 直すときは、端末が読んだときの記録が要る
        if (b.create !== true && (!base || base.id !== rec.id)) throw bad();
        // 足す・直すのは、応募者を見られる人（今の画面で一覧が出る人）だけ。応募店舗は今までどおりどの店でも選べる（見られない店にすると一覧から消える）
        if (!sc.all && !sc.ap.length) throw err('forbidden', 403);
        let created = false;
        await hrRmw('applicants', cur => {
          const i = cur.findIndex(r => obj(r) && String(r.id) === rec.id);
          if (i >= 0) {
            if (b.create === true) throw err('conflict', 409);                     // 新しく足すつもりが同じ ID：上書きしない（どの店の人かも言わない）
            if (!hrApIn(sc, cur[i])) throw err('forbidden', 403);                 // 見られない店の応募者は書き換えない
            // 端末が読んだときの記録（base）と比べて、この端末が変えた欄だけを今の記録に重ねる。同じ欄をほかの端末も変えていたら 409
            // （古い写しで、ほかの人が変えた状態・Onboarding の印を戻さない。独立レビュー 7e3f878 P2-2）
            const cur0 = hrApStrip(cur[i]), next = { ...cur0 };
            for (const k of new Set([...Object.keys(base), ...Object.keys(rec)])) {
              if (canon(base[k]) === canon(rec[k])) continue;
              if (canon(cur0[k]) !== canon(base[k]) && canon(cur0[k]) !== canon(rec[k])) throw err('conflict', 409);
              if (rec[k] === undefined) delete next[k]; else next[k] = rec[k];
            }
            const merged = hrApClean(next);
            if (!merged) throw bad();
            if (canon(cur[i]) === canon(merged)) return undefined;
            cur[i] = merged;
          } else {
            if (b.create !== true) throw err('gone', 410);                        // 直そうとした応募者がもう無い（ほかの端末で不採用にした など）
            cur.push(rec); created = true;
          }
          return cur;
        });
        return { ...(await hrView('applicants', sc)), created };
      }
      if (op === 'reject') {
        const id = typeof b.id === 'string' && HR_ID_RE.test(b.id) ? b.id : null;
        if (!id) throw bad();
        const why = { rejectDate: hrStr(b.rejectDate, 40), reason: hrStr(b.reason, 300), memo: hrStr(b.memo, 2000), by: hrStr(b.by, 80) || sc.name };
        // 不採用ログに写す → 応募者の一覧から外す。外すのは、ログに写したときの記録のまま（ほかの端末が直していない）ときだけ。
        // 直されていたら、今の記録をログに写し直してからもう一度（5 回まで）。前は写したあとに直された電話番号などが消えた（Codex #136 6736973993 の P2-2）。
        // ログの記録は同じ応募者に 1 つ（やり直しても 2 つにならない）。理由・日付・メモは最初の不採用のまま、応募者から写した欄だけ今の記録に
        // 読む順：不採用ログ → 応募者。ログは「先に読んだログの行のまま」のときだけ書く（変わっていれば読み直す）。
        // こうすると、ログにもうある記録は、こちらが応募者を読むより前に読んだ応募者から写したもの＝こちらの写しのほうが新しい（か同じ）。
        // 古い不採用の処理が、あとから完了した新しいログを古い電話番号などに戻すことはない（Codex #136 6738169923 の P2-2：
        // 前は応募者を先に読み、そのあいだに直し＋ほかの不採用が完了すると、古い写しでログを上書きして成功にしていた）。
        let done = false;
        for (let t = 0; t < 8 && !done; t++) {
          const lg = await hrRow('reject_log');
          if (lg && lg.value != null && !Array.isArray(lg.value)) throw err('db', 500);   // 配列でない行（形が違う）：上書きしない
          const logs = lg && Array.isArray(lg.value) ? lg.value : [];
          const row = await hrRow('applicants');
          const ap = (row && Array.isArray(row.value) ? row.value : []).find(r => obj(r) && String(r.id) === id) || null;
          if (!ap) {
            // 応募者がもう無い：ほかの端末が不採用を終えた（ログを読んだあとに終わったこともあるので、ログを読み直す）
            const lg2 = await hrRow('reject_log');
            const was = (lg2 && Array.isArray(lg2.value) ? lg2.value : []).find(r => obj(r) && r.aid === id);
            if (!was) throw err('gone', 410);
            if (!hrApIn(sc, was)) throw err('forbidden', 403);
            done = true; break;
          }
          if (!hrApIn(sc, ap)) throw err('forbidden', 403);
          const copy = { aid: id, name: hrStr(ap.name, 200), phone: hrStr(ap.phone, 60), email: hrStr(ap.email, 200), store: hrStr(ap.store, 80), applyDate: hrStr(ap.date, 40), resumeName: hrStr(ap.resumeName, 200) };
          const entry = { ...copy, ...why };
          if (!entry.reason || !entry.rejectDate) throw bad();
          const cur = logs.slice();
          const i = cur.findIndex(r => obj(r) && r.aid === id);
          let next = null;
          if (i < 0) next = cur.concat([entry]);
          else { const e1 = { ...cur[i], ...copy }; if (canon(e1) !== canon(cur[i])) { cur[i] = e1; next = cur; } }
          if (next) {
            if (JSON.stringify(next).length > 8000000) throw bad();
            try { await writeRow('reject_log', next, lg ? { exists: true, updated_at: lg.updated_at } : { exists: false }); }
            catch (x) { if (x.code !== 'conflict') throw x; continue; }   // 読んだあとにログが変わった：はじめから読み直す
          }
          let moved = false;
          await hrRmw('applicants', cur => {
            const i = cur.findIndex(r => obj(r) && String(r.id) === id);
            if (i < 0) return undefined;
            if (!hrApIn(sc, cur[i])) throw err('forbidden', 403);
            if (canon(cur[i]) !== canon(ap)) { moved = true; return undefined; }   // ログに写したあとに直された：写し直してから
            cur.splice(i, 1); return cur;
          });
          if (!moved) done = true;
        }
        if (!done) throw err('conflict', 409);
        const [v1, v2] = await Promise.all([hrView('applicants', sc), hrView('reject_log', sc)]);
        return { ...v1, reject_log: v2 };
      }
      throw bad();
    }
    // growthhub
    if (op === 'post') {
      const title = hrStr(b.title, 200), body = hrStr(b.body, 5000);
      if (!title || !body || !sc.name) throw err(sc.name ? 'bad_value' : 'forbidden', sc.name ? 400 : 403);
      const cid = typeof b.cid === 'string' && HR_CID_RE.test(b.cid) ? b.cid : '';   // 同じ送信を 2 回押しても 1 つ（答えが届かなかったとき）
      let id = '';
      await hrRmw('growthhub', cur => {
        const same = cid ? cur.find(p => obj(p) && p.cid === cid && p.author === sc.name) : null;
        if (same) { id = String(same.id); return undefined; }
        let n = now();
        const ids = new Set(cur.map(p => obj(p) && String(p.id)));
        while (ids.has('gh' + n)) n++;
        id = 'gh' + n;
        return cur.concat([{ id, title, body, author: sc.name, store: sc.store, date: hrStr(b.date, 40), status: '未対応', replies: [], ...(cid ? { cid } : {}) }]);
      });
      return { ...(await hrView('growthhub', sc)), id };
    }
    const id = typeof b.id === 'string' && HR_ID_RE.test(b.id) ? b.id : null;
    if (!id) throw bad();
    if (!['reply', 'status', 'assign'].includes(op)) throw bad();
    let mgrOut = false;
    await hrRmw('growthhub', cur => {
      const p = cur.find(x => obj(x) && String(x.id) === id);
      if (!p) throw err('gone', 410);
      const mgr = hrGhMgr(sc, p), mine = hrOwn(sc, p);
      if (op === 'reply') {
        if (!mgr && !mine) throw err('forbidden', 403);
        const text = hrStr(b.text, 5000);
        if (!text) throw bad();
        mgrOut = mgr;
        const cid = typeof b.cid === 'string' && HR_CID_RE.test(b.cid) ? b.cid : '';
        if (cid && Array.isArray(p.replies) && p.replies.some(r => obj(r) && r.cid === cid)) return undefined;   // 同じ返信をもう一度（答えが届かなかった）
        p.replies = (Array.isArray(p.replies) ? p.replies : []).concat([{ author: mgr ? (hrStr(b.author, 60) || sc.name || '管理者') : sc.name, byMgr: mgr, text, date: hrStr(b.date, 40), ...(cid ? { cid } : {}) }]);
        if (mgr && (p.status || '未対応') === '未対応') p.status = '対応中';
        return cur;
      }
      if (!mgr) throw err('forbidden', 403);
      if (op === 'status') {
        if (!['未対応', '対応中', '解決'].includes(b.status)) throw bad();
        if (p.status === b.status) return undefined;
        p.status = b.status; return cur;
      }
      if (b.off === true) { if (!p.assignee) return undefined; p.assignee = ''; return cur; }
      if (!sc.name) throw err('forbidden', 403);
      p.assignee = sc.name; p.assignedAt = hrStr(b.at, 40);
      if ((p.status || '未対応') === '未対応') p.status = '対応中';
      return cur;
    });
    return { ...(await hrView('growthhub', sc)), mgr: mgrOut };
  }

  // ---- v1144：従業員の個人の欄（生年月日・カードの下 4 桁・保険の加入・保険料）
  // 見られる範囲。lv：full（5 つ）／hr（保険料を除く 4 つ）／flag（生年月日があるかだけ）／none。ok(e)：その社員の行が範囲か。
  // newOk：社員の表にまだ無い人（今登録した人）にも書ける（CEO・GM・経理）。amt：保険料を見る・直す（GM・CEO）
  async function piiScope(a) {
    const none = { lv: 'none', ok: () => false, newOk: false, amt: false };
    let me = null;
    if (a.emp) {   // 社員と結ばれた人：行が無い・退職・OS を止めた人は何も（PIN の確かめは 60 秒覚えているので、今の社員の表で見る。hrScope と同じ）
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,role,title,store,status,data');
      me = Array.isArray(es) ? es[0] || null : null;
      if (!me || empOut(me)) return none;
    }
    if (a.role === 'ceo' || a.role === 'gm') return { lv: 'full', ok: () => true, newOk: true, amt: true };
    if (a.role === 'office') return { lv: 'hr', ok: () => true, newOk: true, amt: false };
    if (a.role === 'office_crew') return { lv: 'flag', ok: () => true, newOk: false, amt: false };
    if (!me) return none;
    if (a.role === 'am') {   // 担当の店（応援も）と本部（ALL）の人：アプリの従業員マスターの絞り込みと同じ
      const S = [...new Set([...a.am, ...a.stores])];
      const ok = e => {
        const d = obj(e && e.data) || {};
        const st = String((d.store != null && d.store !== '') ? d.store : ((e && e.store) || ''));
        const sup = Array.isArray(d.support) ? d.support : (Array.isArray(e && e.support) ? e.support : []);
        return st === 'ALL' || S.includes(st) || sup.some(x => S.includes(String(x)));
      };
      return { lv: 'hr', ok, newOk: false, amt: false };
    }
    // Head Chef（Corporate Chef も）：全員（v950 から従業員マスターで全店の人を見る）。今の社員の表と、GM・CEO が確かめた写し（wr_people.chef）の
    // 両方で Head Chef のときだけ（Codex #138 P1-1：確かめた店長が自分の肩書きを Head Chef に書き換えるだけでは広げない）
    if (a.role === 'staff' && a.grade >= 4 && liveChef(me) && await confChef(a)) return { lv: 'hr', ok: () => true, newOk: false, amt: false };
    return none;
  }
  async function piiLoad() {
    const [row, emps] = await Promise.all([hrRow(PII_KEY), rest('employees?select=id,name,role,title,store,support,status,data&limit=5000')]);
    if (row && row.value != null && !obj(row.value)) throw err('db', 500);   // オブジェクトでない行（形が違う）：読まない・上書きしない
    return { row, map: row ? obj(row.value) || {} : {}, emps: (Array.isArray(emps) ? emps : []).filter(e => e && e.id != null) };
  }
  // その人の欄：emp_pii にあればそれ（書いたときに全部の欄を持たせる）。無ければ従業員の表の値（SQL 20261113090000 の前）
  function piiOf(map, id, e) {
    const en = obj(map[id]);
    const src = en || obj(e && e.data) || {};
    const o = {};
    for (const k of PII_FIELDS) if (Object.prototype.hasOwnProperty.call(src, k)) o[k] = piiOut(src[k]);
    return o;
  }
  function piiProject(f, lv) {
    if (lv === 'flag') return piiCmp('dob', f.dob) !== '' ? { _dobSet: true } : null;
    const ks = lv === 'full' ? PII_FIELDS : PII_HR;
    const o = {};
    let n = 0;
    for (const k of ks) if (Object.prototype.hasOwnProperty.call(f, k)) { o[k] = f[k]; n++; }
    return n ? o : null;
  }
  async function piiGet(a) {
    const sc = await piiScope(a);
    if (sc.lv === 'none') return { level: 'none', data: {}, updated_at: null };
    const { row, map, emps } = await piiLoad();
    const data = {}, seen = new Set();
    for (const e of emps) {
      const id = String(e.id);
      seen.add(id);
      if (!sc.ok(e)) continue;
      const p = piiProject(piiOf(map, id, e), sc.lv);
      if (p) data[id] = p;
    }
    // 社員の表にまだ無い人（登録した端末がまだ送れていない）：書ける人（CEO・GM・経理）にだけ
    if (sc.newOk) for (const id of Object.keys(map)) if (!seen.has(id) && PII_ID_RE.test(id) && obj(map[id])) { const p = piiProject(piiOf(map, id, null), sc.lv); if (p) data[id] = p; }
    return { level: sc.lv, data, updated_at: row ? row.updated_at : null };
  }
  // 1 人の欄を直す。base＝画面を開いたときの値。サーバーの今の値が base と違い、送った値とも違う欄があれば 409（ほかの端末が同じ欄を直した）。
  // 読んだ行が変わっていないときだけ書く（5 回まで）。書くとき、その人の欄を全部 emp_pii に持たせる（従業員の表の値も写す）
  async function piiOp(a, b) {
    const id = b.id;
    if (typeof id !== 'string' || !PII_ID_RE.test(id)) throw bad();
    const set = obj(b.set), base = obj(b.base) || {};
    if (!set) throw bad();
    const ks = Object.keys(set);
    if (!ks.length || ks.some(k => !PII_FIELDS.includes(k))) throw bad();
    const val = {};
    for (const k of ks) { const v = piiValid(k, set[k]); if (v === undefined) throw bad(); val[k] = v; }
    const sc = await piiScope(a);
    if (sc.lv !== 'full' && sc.lv !== 'hr') throw err('forbidden', 403);
    if (ks.includes('insuranceAmt') && !sc.amt) throw err('forbidden', 403);
    const who = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 120) : (HR_LABEL[a.role] || a.role);
    for (let t = 0; t < 5; t++) {
      const { row, map, emps } = await piiLoad();
      const e = emps.find(x => String(x.id) === id) || null;
      if (e) { if (!sc.ok(e)) throw err('forbidden', 403); }
      else if (!sc.newOk) throw err('not_found', 404);   // 社員の表にまだ無い人：社員の行が届いてから（アプリはもう一度送る）
      const cur = piiOf(map, id, e);
      let changed = false;
      for (const k of ks) {
        const c = canon(piiCmp(k, cur[k]));
        if (c === canon(piiCmp(k, val[k]))) continue;
        if (c !== canon(piiCmp(k, base[k]))) throw err('conflict', 409);
        changed = true;
      }
      if (!changed) return { same: true, entry: piiProject(cur, sc.lv) || {}, level: sc.lv, by: a.role };
      const next = { ...cur, ...val, _at: new Date(now()).toISOString(), _by: who };
      const value = { ...map, [id]: next };
      if (JSON.stringify(value).length > 2000000) throw bad();
      try { await writeRow(PII_KEY, value, row ? { exists: true, updated_at: row.updated_at } : { exists: false }); }
      catch (x) { if (x.code !== 'conflict') throw x; continue; }   // 読んだあとに行が変わった：読み直して比べ直す
      return { same: false, entry: piiProject(next, sc.lv) || {}, level: sc.lv, by: a.role };
    }
    throw err('conflict', 409);
  }
  // カードの下 4 桁の照合：レシート管理を使える人（CEO・GM・経理・事務Crew・AM・G3 以上）。在籍の G2 以上の人（アプリの empsByCardLast4 と同じ）の ID と名前だけ。
  // 全部の 4 桁を当てて調べられないように、10 分で 200 件まで（関数の 1 つの実行環境の中で数える）
  const cardHits = new Map();
  async function cardMatch(a, b) {
    if (!(['ceo', 'gm', 'office', 'office_crew', 'am'].includes(a.role) || (a.role === 'staff' && a.grade >= 3))) throw err('forbidden', 403);
    const list = Array.isArray(b.last4s) ? b.last4s : [b.last4];
    if (!list.length || list.length > 20 || list.some(x => typeof x !== 'string' || !/^\d{4}$/.test(x))) throw bad();
    if (a.emp) {
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,status,data');
      const me = Array.isArray(es) ? es[0] || null : null;
      if (!me || empOut(me)) throw err('forbidden', 403);
    }
    const hk = a.emp ? 'e:' + a.emp : 'r:' + a.role + ':' + a.via;
    const t0 = now(), hits = (cardHits.get(hk) || []).filter(x => t0 - x < 600000);
    if (hits.length + list.length > 200) throw err('locked', 429);
    for (let i = 0; i < list.length; i++) hits.push(t0);
    cardHits.set(hk, hits);
    if (cardHits.size > 500) for (const [k, v] of cardHits) if (!v.some(x => t0 - x < 600000)) cardHits.delete(k);
    const { map, emps } = await piiLoad();
    const out = {};
    for (const l4 of list) out[l4] = [];
    for (const e of emps) {
      const d = obj(e.data) || {}, id = String(e.id);
      const st = String(d.status != null ? d.status : (e.status || ''));
      if (st && st !== '在籍') continue;
      const g = Number(String(appGrade(String(d.title || e.title || ''), String(d.role || e.role || ''))).replace('G', '')) || 0;
      if (g < 2) continue;
      const cards = String(piiOf(map, id, e).cardLast4 || '').split(',').map(x => x.trim());
      for (const l4 of Object.keys(out)) if (cards.includes(l4)) out[l4].push({ id, name: String(d.name || e.name || '').slice(0, 120) });
    }
    return { matches: out };
  }
  // 店ごとの保険料の合計（月額）：アプリの storeInsuranceMonthly と同じ（配属の店・退職でない人）。だれにでも（ログイン不要）
  async function insTotals() {
    const { map, emps } = await piiLoad();
    const totals = {};
    for (const e of emps) {
      const d = obj(e.data) || {}, id = String(e.id);
      const st = String(d.store != null ? d.store : (e.store || ''));
      const status = String(d.status != null ? d.status : (e.status || ''));
      if (!st || status === '退職') continue;
      const f = piiOf(map, id, e);
      const amt = f.insuranceAmt != null ? (Number(f.insuranceAmt) || 0) : 0;
      if (!amt) continue;
      totals[st] = (totals[st] || 0) + amt;
    }
    return { totals };
  }

  const ACTIONS = { pull, get, put, hist: csHist, pin_check: pinCheck, pin_set: pinSet, hr_get: hrGet, hr_op: hrOp, hr_match: hrMatch, pii_get: piiGet, pii_op: piiOp, card_match: cardMatch };
  const CODES = { forbidden: 403, bad_value: 400, conflict: 409, locked: 429, gone: 410, not_found: 404 };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin', fn: 1 }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    // 答えにはいつも fn:1（アプリは fn の無い答え（ゲートウェイの 401・関数が無い 404 など）を「関数が使えない」とみなす）
    // csfn:1＝Career Score も扱う関数（v1140）。アプリは csfn の無い答えを「前の版の関数」とみなし、Career Score を今までどおり REST で
    //（取り込みの答えの Career Score の部分は cs。名前を分けている）
    // swfn:1＝決めた人だけが書ける設定（v1141）も扱う関数。アプリは swfn の無い答えを前の版とみなし、その設定を今までどおり REST で書く
    // hrfn:1＝採用（応募者・不採用ログ）とお悩み相談室（v1142）も扱う関数。アプリは hrfn の無い答えを前の版とみなし、今までどおり REST で
    // sw2:1＝v1143 の設定（GM・CEO だけが変える賞与・Career Score の設定）も扱う。アプリは sw2 の無い答えを前の版とみなし、その設定を今までどおり REST で書く
    // piifn:1＝従業員の個人の欄（v1144）も扱う。アプリは piifn の無い答えを前の版とみなし、その欄を今までどおり従業員の表に書く
    // ghfn:1＝グレード履歴（v1145）も扱う。アプリは ghfn の無い答えを前の版とみなし、グレード履歴を今までどおり REST で書く
    // tpfn:1＝Tip Rate・プレップ（v1146）も扱う。アプリは tpfn の無い答えを前の版とみなし、その 2 つを今までどおり REST で書く
    const json = (v, s = 200) => new Response(JSON.stringify({ ...v, fn: 1, csfn: 1, swfn: 1, hrfn: 1, sw2: 1, piifn: 1, ghfn: 1, tpfn: 1 }), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 8000000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!obj(body)) return json({ error: 'bad_json' }, 400);
    // v1144：店ごとの保険料の合計は、ログインを確かめずに返す（店舗の PIN のタブレットでも人件費が今と同じに。人ごとの額は返さない）
    if (body.action === 'ins_totals') {
      try { return json(await insTotals()); } catch (e) { console.error('secure-state', 'ins_totals', safeErr(e)); return json({ error: 'error' }, 500); }
    }
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const a = await actorOf(req, body);
      if (a.err) return json({ error: a.err }, 503);
      if (a.deny) { console.warn('secure-state unauthorized', body.action, a.deny); return json({ error: 'unauthorized' }, 401); }
      return json(await fn(a, body));
    } catch (e) {
      const code = e && e.code && CODES[e.code] ? e.code : '';
      if (code) return json({ error: code }, CODES[code]);
      console.error('secure-state', body.action, safeErr(e));
      return json({ error: 'error' }, 500);
    }
  };
}

// ---- 起動（supabase/functions/secure-state/index.ts と同じ）
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
