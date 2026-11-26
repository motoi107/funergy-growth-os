// App Store 審査用の静的ページ（/privacy/・/privacy/ja/・/support/・/support/ja/）。仕様：docs/APPSTORE_REVIEW_JA.md。
// ログインせずに開ける・スクリプトを持たない・外のファイルを読まない・英語版と日本語版の節がそろっていることを確かめる。
// 印（[要確認]＝事実を確かめる・[案]＝会社が決める）の数は英語と日本語でそろえる。中身の文は確かめない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [
  { url: '/privacy/', lang: 'en', pair: '/privacy/ja/', other: '/support/' },
  { url: '/privacy/ja/', lang: 'ja', pair: '/privacy/', other: '/support/ja/' },
  { url: '/support/', lang: 'en', pair: '/support/ja/', other: '/privacy/' },
  { url: '/support/ja/', lang: 'ja', pair: '/support/', other: '/privacy/ja/' },
];
const fileOf = u => path.join(root, u.replace(/^\//, ''), u.endsWith('/') ? 'index.html' : '');
const read = u => readFileSync(fileOf(u), 'utf8');
const ids = html => [...html.matchAll(/<section id="([a-z-]+)"/g)].map(m => m[1]);
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(m => m[1]);

test('4 つのページがあり、HTML の形と言語が正しい', () => {
  for (const p of PAGES) {
    assert.ok(existsSync(fileOf(p.url)), p.url);
    const h = read(p.url);
    assert.match(h, /^<!DOCTYPE html>\n<html lang="(en|ja)">/, p.url);
    assert.equal(h.match(/^<!DOCTYPE html>\n<html lang="(en|ja)">/)[1], p.lang, p.url);
    assert.match(h, /<meta charset="utf-8">/, p.url);
    assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1">/, p.url);
    assert.match(h, /<title>[^<]+ – Funergy\+<\/title>/, p.url);
    assert.match(h, /<\/html>\n$/, p.url);
  }
});

test('ログイン・スクリプト・外のファイルに頼らない（静的なページだけ）', () => {
  for (const p of PAGES) {
    const h = read(p.url);
    assert.doesNotMatch(h, /<script|<iframe|<form|<object|<embed|\son[a-z]+=/i, p.url);
    assert.doesNotMatch(h, /supabase\.co|functions\/v1|localStorage|serviceWorker|apikey/i, p.url);
    for (const v of [...attrs(h, 'src'), ...attrs(h, 'href')]) {
      if (/^#[a-z-]+$/.test(v)) continue;
      if (/^https:\/\/funergy-plus\.com\/(privacy|support)\/(ja\/)?$/.test(v)) continue;   // hreflang の行だけ
      if (v === 'mailto:office@funergygroup.com') continue;   // 会社の公開の窓口（案）
      assert.match(v, /^\/(privacy|support|appicons)\//, `${p.url} → ${v}`);
      assert.ok(existsSync(fileOf(v)), `${p.url} → ${v} が無い`);
    }
    for (const v of attrs(h, 'href').filter(x => x.startsWith('#'))) assert.ok(ids(h).includes(v.slice(1)), `${p.url} の目次 ${v}`);
  }
});

test('英語版と日本語版の節がそろい、互いに行き来できる', () => {
  for (const p of PAGES) {
    const h = read(p.url);
    assert.deepEqual(ids(h), ids(read(p.pair)), `${p.url} と ${p.pair}`);
    assert.ok(attrs(h, 'href').includes(p.pair), `${p.url} → ${p.pair}`);
    assert.ok(attrs(h, 'href').includes(p.other), `${p.url} → ${p.other}`);
    for (const m of [/\[要確認/g, /\[案/g, /class="todo"/g, /class="plan"/g]) assert.equal((h.match(m) || []).length, (read(p.pair).match(m) || []).length, `${p.url} と ${p.pair} の ${m} の数`);
  }
  assert.deepEqual(ids(read('/privacy/')), ['scope', 'collect', 'use', 'access', 'services', 'retention', 'choices', 'security', 'contact']);
  assert.ok(ids(read('/support/')).includes('contact'));
});

test('公開日の印は英語と日本語に 1 つずつ。main へ出すときは残っていない', () => {
  const en = read('/privacy/');
  const ja = read('/privacy/ja/');
  const enTok = (en.match(/\[Publication date\]/g) || []).length;
  const jaTok = (ja.match(/\[公開日\]/g) || []).length;
  assert.equal(enTok, jaTok, '英語と日本語の公開日の印の数');
  const publishing = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main';
  if (publishing) {
    assert.equal(enTok, 0, 'replace [Publication date] with the Hawaii publication date before merging');
    assert.equal(jaTok, 0, 'マージの前に [公開日] をハワイ時間の公開日に置き換える');
  } else {
    assert.equal(enTok, 1, '[Publication date]');
    assert.equal(jaTok, 1, '[公開日]');
  }
});

test('鍵・トークン・本物のアドレスを書いていない', () => {
  for (const p of PAGES) {
    const h = read(p.url);
    assert.doesNotMatch(h, /eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|sb_(publishable|secret)_|AIza[0-9A-Za-z_-]{20,}|-----BEGIN/, p.url);
    assert.doesNotMatch(h, /tgbhgxzehzeouopklhje/, p.url);
  }
});

