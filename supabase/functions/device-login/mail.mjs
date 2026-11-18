// v1189：パスキーのログインのメール（招待・6 桁のコード・メールを変えるときの知らせ）。仕様：docs/PASSKEY_LOGIN_V1189_JA.md。
// 送り手は GM の会社のメール（Gmail API）。アドレスはデータベース（dl_mail.from_addr）にだけあり、ここにもリポジトリにも書かない。
// 頼む権限は「送る」と、つないだアカウントを確かめるための「メールアドレス」だけ（受信箱は読まない）。
// トークンは Google にだけ渡す。間違いは短い理由だけ（トークン・宛先・本文は出さない）。
import { buildNoticeMime, b64url } from '../../../invoice/gmail.mjs';

export const MAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];
const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export function mailAuthUrl({ clientId, redirectUri, state, challenge, loginHint }) {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: MAIL_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256' });
  if (loginHint) p.set('login_hint', loginHint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}
export const mailScopesOk = s => Array.isArray(s) && s.includes('https://www.googleapis.com/auth/gmail.send');

async function timed(fetch, url, init, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...init, signal: ac.signal }); const body = await r.text(); return { status: r.status, ok: r.ok, body }; }
  finally { clearTimeout(t); }
}
// つないだアカウントのメール（OpenID の userinfo）。確かめられたメールだけ
export async function accountOf({ fetch, token }) {
  try {
    const r = await timed(fetch, USERINFO, { headers: { authorization: 'Bearer ' + token } }, 15000);
    if (!r.ok) return null;
    const j = JSON.parse(r.body || 'null');
    return j && typeof j.email === 'string' && j.email_verified !== false ? j.email.trim().toLowerCase() : null;
  } catch { return null; }
}
// 1 通送る（本文だけ・添付なし）。401／403（権限を取り消した・送れない）は auth＝つなぎ直しが要る
export async function sendRaw({ fetch, token, bytes }) {
  try {
    const r = await timed(fetch, SEND, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: b64url(bytes) }) }, 30000);
    if (r.ok) return { ok: true };
    let reason = ''; try { const j = JSON.parse(r.body); reason = j && j.error && (j.error.status || (j.error.errors && j.error.errors[0] && j.error.errors[0].reason)) || ''; } catch { reason = ''; }
    const limited = /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED)$/.test(String(reason));
    return { ok: false, auth: !limited && (r.status === 401 || r.status === 403), error: 'gmail_send_' + r.status };
  } catch { return { ok: false, error: 'gmail_send_network' }; }
}
export function mime({ from, to, subject, text }) {
  return buildNoticeMime({ from: 'Funergy+ <' + from + '>', to, subject, text });
}

const fmt = iso => {   // ハワイ時間（店の時間）
  const d = new Date(iso); if (isNaN(d)) return '';
  const h = new Date(d.getTime() - 10 * 3600 * 1000);
  return `${h.getUTCFullYear()}/${h.getUTCMonth() + 1}/${h.getUTCDate()} ${String(h.getUTCHours()).padStart(2, '0')}:${String(h.getUTCMinutes()).padStart(2, '0')}（ハワイ時間）`;
};
// 招待（新しく・送り直し）とメールの変更（新しいメールへ）
export function inviteMail({ name, link, expiresAt, purpose }) {
  const change = purpose === 'email_change';
  const subject = change ? 'Funergy+：ログインのメールの確かめ / Confirm your login email' : 'Funergy+：ログインの招待 / Your login invitation';
  const ja = [
    `${name} さん`, '',
    change ? 'Funergy+ にログインするメールを、このメールアドレスに変えます。下のリンクを開いて、画面の案内にしたがってください。'
      : 'Funergy+ のログインを、メールとパスキーにします（これからは PIN では入りません）。下のリンクを開いて、画面の案内にしたがってください。',
    '', link, '',
    `・リンクは ${fmt(expiresAt)} まで、1 回だけ使えます。`,
    '・リンクを開くと、このメールアドレスに 6 桁のコードが届きます。そのコードを入れます。',
    '・ご自分のスマホなら、そのあと「パスキー」を保存すると、次からは顔や指でログインできます。',
    '・心当たりがないときは、このメールは開かずに GM に知らせてください。',
  ];
  const en = [
    '', '----', `Hi ${name},`, '',
    change ? 'Your Funergy+ login email is changing to this address. Open the link below and follow the steps.'
      : 'Your Funergy+ login is moving to email and passkey (no more PIN). Open the link below and follow the steps.',
    '', link, '',
    `- The link works once, until ${fmt(expiresAt).replace('（ハワイ時間）', ' (Hawaii time)')}.`,
    '- After you open it, a 6-digit code is sent to this address. Enter that code.',
    '- On your own phone you can then save a passkey and log in with your face or fingerprint next time.',
    '- If you did not expect this email, do not open the link and tell your GM.',
  ];
  return { subject, text: ja.concat(en).join('\n') };
}
export function codeMail({ name, code }) {
  return { subject: 'Funergy+：ログインのコード / Your login code', text: [
    `${name} さん`, '', `Funergy+ のログインのコード：${code}`, '',
    '・10 分間、1 回だけ使えます。', '・ほかの人には教えないでください（GM・本部も聞きません）。', '・心当たりがないときは、このメールは無視して GM に知らせてください。',
    '', '----', `Hi ${name},`, '', `Your Funergy+ login code: ${code}`, '',
    '- It works once, for 10 minutes.', '- Never share it with anyone (your GM or the office will never ask for it).', '- If you did not ask for it, ignore this email and tell your GM.',
  ].join('\n') };
}
export function changeNoticeMail({ name, newMasked }) {
  return { subject: 'Funergy+：ログインのメールを変えます / Your login email is changing', text: [
    `${name} さん`, '', `Funergy+ にログインするメールを、GM が ${newMasked} に変えようとしています。`,
    '新しいメールの確かめが済むまでは、このメールのままです。心当たりがないときは、すぐに GM に知らせてください。',
    '', '----', `Hi ${name},`, '', `Your GM is changing your Funergy+ login email to ${newMasked}.`,
    'Until the new address is confirmed, this address stays in use. If you did not expect this, tell your GM right away.',
  ].join('\n') };
}
export const maskEmail = e => {
  const s = String(e || ''), at = s.indexOf('@'); if (at < 1) return '';
  const u = s.slice(0, at), d = s.slice(at + 1);
  return (u.length <= 2 ? u[0] + '•••' : u[0] + '•••••' + u[u.length - 1]) + '@' + d;
};
