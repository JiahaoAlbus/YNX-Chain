import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicDeveloperEntry, publicLanguage } from '../frontend/src/public-site/entry.ts';
const location = path => new URL(path, 'https://developer.ynxweb4.com');
test('public introduction accepts only its own paths, language and section anchors', () => {
  for (const path of ['/', '/index.html?lang=en', '/about?lang=zh', '/#features', '/#platforms', '/#help', '/#main', '/#top']) assert.equal(isPublicDeveloperEntry(location(path), undefined), true, path);
});
test('historical app paths, callback inputs and unknown deep links retain existing application routing', () => {
  for (const path of ['/projects', '/guest-workspace', '/native-tools?sessionId=opaque', '/sso/core-open?sessionId=opaque', '/sso/callback?code=opaque', '/wallet-auth/callback', '/runtime/health', '/downloads/file.dmg', '/?code=opaque', '/?lang=en&projectId=opaque', '/#saved-project', '/about?sessionId=opaque']) assert.equal(isPublicDeveloperEntry(location(path), undefined), false, path);
});
test('Native presentation stays in the app and language has a bounded public default', () => {
  for (const marker of [{initialProject:null}, {postMessage(){}}, true]) assert.equal(isPublicDeveloperEntry(location('/'), marker), false);
  assert.equal(publicLanguage('?lang=en'),'en'); assert.equal(publicLanguage('?lang=zh'),'zh'); assert.equal(publicLanguage('?lang=unknown'),'zh');
});
