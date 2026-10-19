// The words of a notice to Moto about the QuickBooks forwarding (UI案56): the same for the mail and LINE (the app words its own
// copy from the same data). Names, counts and times only: never a key, a token, a mail body or an original's content.

const KIND_TITLE = {
  first_sent: 'QuickBooks：このシステムから初めて送れました',
  unknown: 'QuickBooks：送ったか分からない原本があります',
  error_final: 'QuickBooks：送れずに止まりました',
  content_changed: 'QuickBooks：原本が差し替わっていました（送っていません）',
  backlog: 'QuickBooks：処理が残っています',
  auth: 'Gmail の許可が切れました（QuickBooks への送信を止めています）',
  intake_error: 'Invoice取込：読み取れない原本があります',
  rename_error: 'Invoice取込：ファイル名を変えられません（QuickBooks へ送れません）',
};

// HH:MM (or MM/DD HH:MM) in Hawaii time; Hawaii has no daylight saving time.
export function hst(iso, withDate = true) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t - 10 * 3600000), p = n => String(n).padStart(2, '0');
  const hm = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  return withDate ? p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + ' ' + hm : hm;
}
const clip = (s, n) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, n);
const where = d => clip(d.name, 120) + (d.store ? '（' + clip(d.store_label || d.store, 30) + '）' : '');
const NEXT = '次にすること：Funergy+ → Invoice取込 → 取込状況';

export function noticeText(a) {
  const d = a.data || {}, title = KIND_TITLE[a.kind] || 'QuickBooks の転送';
  let body;
  switch (a.kind) {
    case 'first_sent':
      body = [where(d) + ' を送りました。',
        '反映 ' + hst(d.posted_at) + ' → 名前 ' + hst(d.renamed_at, false) + ' → 台帳 ' + hst(d.queued_at, false) + ' → 送信開始 ' + hst(d.started_at, false) + ' → 送信済み ' + hst(d.sent_at, false),
        'Gmail の ID：' + clip(d.message_id, 60),
        'メール送信済みまでです。QuickBooks での取り込みは QuickBooks で確かめてください。この知らせは最初の 1 通だけです。'];
      break;
    case 'unknown':
      body = ['送ったかどうか分からない原本が 1 件あります。自動では送り直しません。', '・' + where(d) + (d.at ? '　' + hst(d.at) : ''),
        NEXT + 'で「Gmail の送信済みを調べる」を押してください。見つかれば送信済みにします。見つからなければ、確かめて「もう一度送る」。'];
      break;
    case 'error_final':
      body = [where(d) + '：やり直し ' + (Number(d.attempts) || 5) + ' 回を使い切りました（' + clip(d.error, 80) + '）。自動ではもう送りません。', NEXT + 'で確かめてください。'];
      break;
    case 'content_changed':
      body = [where(d) + '：台帳に積んだときと Drive の原本の中身が違うので、送っていません。', 'Invoice取込で新しい中身を確かめてください（確かめて反映すると、改めて送ります）。'];
      break;
    case 'backlog':
      body = ['送れていない原本が残っています。',
        ...(Number(d.waiting) ? ['・30 分以上 送れていない：' + Number(d.waiting) + ' 件' + (d.oldest ? '（いちばん古いもの ' + hst(d.oldest) + ' に台帳へ）' : '')] : []),
        ...(Number(d.unknown) ? ['・結果不明のまま 12 時間以上：' + Number(d.unknown) + ' 件'] : []),
        ...(Number(d.stopped) ? ['・送れずに止まったまま 12 時間以上：' + Number(d.stopped) + ' 件'] : []),
        ...(Number(d.external) ? ['・前の転送（ChatGPT）の残り：' + Number(d.external) + ' 件（3 時間以上）'] : []),
        'Gmail の接続：' + ({ ok: 'つながっています', expired: '許可が切れています', denied: '許可が足りません', disconnected: '切ってあります' }[d.gmail] || 'まだ'),
        NEXT + 'を見てください。（この知らせは 1 日 1 回まで）'];
      break;
    case 'auth':
      body = ['QuickBooks への送信を止めています。台帳に積むのは続けるので、つなぎ直せば待っている分から送ります。',
        '次にすること：Funergy+ → Invoice取込 → 設定 → Gmail の接続で「つなぎ直す」（moto@ でログインして許可）。'];
      break;
    case 'intake_error':
      body = [where(d) + '：' + (d.status === 'unsupported' ? '読めない形式です' : '読み取りに 3 回失敗しました') + (d.error ? '（' + clip(d.error, 80) + '）' : '') + '。',
        NEXT + 'の「エラー」で確かめてください。'];
      break;
    case 'rename_error':
      body = [where(d) + '：ファイル名を 3 回変えられませんでした（' + clip(d.error, 80) + '）。名前を変えるまで QuickBooks へ送りません。', NEXT + 'の「エラー」で確かめてください。'];
      break;
    default:
      body = [NEXT + 'を見てください。'];
  }
  const text = body.join('\n');
  return { title, text, line: '【' + title + '】\n' + text };
}
