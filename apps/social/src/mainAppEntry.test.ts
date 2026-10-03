import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('formal product routes preserve business consumers and exclude isolated fixture wiring', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  for (const route of ['Contacts', 'Messages', 'Moments', 'Alerts', 'Profile']) assert.match(app, new RegExp('<' + route + '\\b'));
  assert.match(app, /<MessageThread key=\{selected\.id\}/);
  assert.match(app, /if \(selected && !desktop\) return thread/);
  assert.match(app, /<KeyboardAvoidingView/);
  assert.match(app, /conversation\.e2ee === 'verified'/);
  assert.match(app, /Object\.keys\(item\.record\.readAt/);
  assert.match(app, /Object\.keys\(item\.record\.deliveredAt/);
  assert.doesNotMatch(app, /SYNTHETIC MEDIA VIEWER|Fail next (?:read|cleanup)|ui-fixture:example/);
});
test('web navigation is not an authorization grant and is included in the product builder', () => {
  const script = readFileSync(new URL('../web/product-shell.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/product-shell.css', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../web/build.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /eth_requestAccounts|personal_sign|sendTransaction|\.hidden\s*=\s*false|removeAttribute\(['"]hidden/);
  assert.match(css, /\[hidden\]\{display:none!important;\}/);
  assert.match(script, /viewport\.append\(chat\)/);
  assert.match(css, /social-page=settings\] #private-auth-panel\{display:block/);
  assert.match(build, /'product-shell\.css','product-shell\.js'/);
  assert.match(build, /SOCIAL_REGISTERED_SCOPE_CARRIER_MISMATCH/);
});
