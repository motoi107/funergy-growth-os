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
  assert.deepEqual(browserOrigins('', ['https://www.funergy-plus.com', 'https://motoi107.github.io']).slice(0, 4), [
    'https://funergy-plus.com', 'capacitor://localhost', 'https://www.funergy-plus.com', 'https://motoi107.github.io']);
});

test('each shared function asks the same allowlist helper', () => {
  for (const name of ['device-login', 'secure-state', 'work-requests', 'invoice-intake', 'mid-review', 'bonus-close', 'payroll-expense', 'google-reviews', 'ops-bot']) {
    const text = readFileSync(new URL(`../supabase/functions/${name}/handler.mjs`, import.meta.url), 'utf8');
    assert.match(text, /import \{ browserOrigins \} from '\.\.\/_shared\/browser-origins\.mjs';/);
    assert.match(text, /browserOrigins\(/);
    assert.equal(text.includes("['https://funergy-plus.com', ...String(env("), false);
  }
});
