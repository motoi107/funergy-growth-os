import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserOrigins, INSTALLED_APP_ORIGIN, PUBLISHED_WEB_ORIGIN } from '../supabase/functions/_shared/browser-origins.mjs';

test('the published site stays first and the installed app origin is added once', () => {
  const origins = browserOrigins('');
  assert.equal(origins[0], PUBLISHED_WEB_ORIGIN);
  assert.equal(origins[1], INSTALLED_APP_ORIGIN);
  assert.deepEqual(browserOrigins('https://funergy-plus.com, capacitor://localhost, https://extra.example'), [
    'https://funergy-plus.com', 'capacitor://localhost', 'https://extra.example']);
  assert.deepEqual(browserOrigins('', ['https://www.funergy-plus.com', 'https://motoi107.github.io']), [
    'https://funergy-plus.com', 'capacitor://localhost', 'https://www.funergy-plus.com', 'https://motoi107.github.io']);
});

test('each shared function inlines the same origins and does not import another file', () => {
  const literal = "['https://funergy-plus.com', 'capacitor://localhost'";
  const ops = "['https://funergy-plus.com','capacitor://localhost','https://www.funergy-plus.com','https://motoi107.github.io']";
  for (const name of ['device-login', 'secure-state', 'work-requests', 'invoice-intake', 'mid-review', 'bonus-close', 'payroll-expense', 'google-reviews']) {
    const text = readFileSync(new URL(`../supabase/functions/${name}/handler.mjs`, import.meta.url), 'utf8');
    assert.equal(text.includes(literal), true, name);
    assert.equal(text.includes('browser-origins.mjs'), false, name);
  }
  const bot = readFileSync(new URL('../supabase/functions/ops-bot/handler.mjs', import.meta.url), 'utf8');
  assert.equal(bot.includes(ops), true);
  assert.equal(bot.includes('browser-origins.mjs'), false);
});
