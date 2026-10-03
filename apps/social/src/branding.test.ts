import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const originalSha = 'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d';

test('Native and Web retain the exact admitted original YNX PNG, not letter substitutes', () => {
  for (const relative of ['../assets/ynx-original-logo.png', '../web/assets/ynx-logo.png']) {
    const bytes = readFileSync(new URL(relative, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), originalSha);
    assert.equal(bytes.readUInt32BE(16), 798);
    assert.equal(bytes.readUInt32BE(20), 420);
  }
});

test('Formal Native entry owns one product chrome and preserves branding across signed-out and restored states', () => {
  const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const brand = readFileSync(new URL('./BrandRoot.tsx', import.meta.url), 'utf8');
  assert.match(entry, /registerRootComponent\(App\)/);
  assert.doesNotMatch(entry, /MediaViewer|fixture|qa\.aZcKcz|withSocialBrand\(App\)/);
  assert.match(brand, /resizeMode="contain"/);
  assert.match(brand, /width: 24 \* 798 \/ 420, height: 24, flexShrink: 0/);
  assert.doesNotMatch(brand, /numberOfLines|allowFontScaling=\{false\}|maxFontSizeMultiplier/);
  assert.match(brand, /<View style=\{styles\.content\}><App \/><\/View>/);
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.equal((app.match(/source=\{require\("\.\/assets\/ynx-original-logo\.png"\)\}/g) ?? []).length, 2);
  assert.match(app, /<GuestWorkspace/);
  const guest = readFileSync(new URL('./GuestWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(guest, /width: 24 \* 798 \/ 420, height: 24/);
  assert.match(guest, /resizeMode="contain"/);
  assert.doesNotMatch(app + guest, /SYNTHETIC MEDIA VIEWER|Fail next cleanup|Fail next read/);
  assert.doesNotMatch(app, /<View style=\{styles\.(?:mark|brandMark)\}>\s*<UsersRound/);
});

test('Web brand has contain geometry and small-screen navigation cannot cover the header', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.match(html, /class="brand-logo"[^>]*width="76" height="40"/);
  assert.match(css, /object-fit:contain; flex-shrink:0; border-radius:0/);
  assert.match(css, /width:calc\(24px \* 798 \/ 420\); height:24px/);
  assert.match(css, /body > \.topbar > nav \{ position:static; inset:auto; transform:none; order:3/);
  assert.match(css, /#connect-wallet \{[^}]*min-height:44px/);
});
