import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const android = new URL('android/app/src/main/res/', root);
const dirs = (await readdir(android)).filter(name => name === 'values' || name.startsWith('values-')).sort();
assert.equal(dirs.length, 12, 'Android must ship exactly 12 audited locale catalogs');

const privacyKeys = [
  'privacy_data_title',
  'privacy_data_description',
  'privacy_export_button',
  'privacy_export_ready',
  'privacy_export_unavailable',
  'privacy_share_label',
  'privacy_delete_button',
  'privacy_delete_warning',
  'privacy_delete_action',
  'privacy_exact_required',
  'privacy_deleted',
  'privacy_delete_failed',
];
const required = [
  'app_name',
  'wallet_sign_in',
  'wallet_security',
  'privacy_boundary',
  'payment_boundary',
  'offline',
  'unavailable',
  'security_error',
  'queued_offline',
  'signing_text',
  'accessibility_status',
  ...privacyKeys,
];
const parse = xml => Object.fromEntries(
  [...xml.matchAll(/<string name="([^"]+)">([^<]+)<\/string>/g)].map(match => [match[1], match[2]]),
);
const readLocale = async dir => {
  const values = {};
  const files = (await readdir(new URL(`${dir}/`, android))).filter(name => name.endsWith('.xml')).sort();
  for (const file of files) {
    const xml = await readFile(new URL(`${dir}/${file}`, android), 'utf8');
    assert.ok(!/<string name="[^"]+"\s*><\/string>/.test(xml), `${dir}/${file} contains blank localized text`);
    Object.assign(values, parse(xml));
  }
  return values;
};

const english = await readLocale('values');
const localeValues = new Map();
for (const dir of dirs) {
  const localized = await readLocale(dir);
  localeValues.set(dir, localized);
  for (const key of required) assert.ok(localized[key]?.trim(), `${dir}:${key}`);
  if (dir !== 'values') {
    for (const key of required) {
      if (!['app_name'].includes(key)) assert.notEqual(localized[key], english[key], `${dir}:${key} still equals English fallback`);
    }
  }
}
const arabic = localeValues.get('values-ar');
for (const key of privacyKeys) assert.match(arabic[key], /\p{Script=Arabic}/u, `values-ar:${key} must contain Arabic script`);

const catalog = JSON.parse(await readFile(new URL('ios/YNXShop/Localizable.xcstrings', root), 'utf8'));
const iosLanguages = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'];
for (const key of privacyKeys) {
  const entry = catalog.strings[key];
  assert.ok(entry, `iOS catalog missing ${key}`);
  for (const language of iosLanguages) {
    const value = entry.localizations?.[language]?.stringUnit?.value?.trim();
    assert.ok(value, `${key}:${language}`);
    if (language !== 'en') assert.notEqual(value, entry.localizations.en.stringUnit.value, `${key}:${language} still equals English fallback`);
  }
  assert.match(entry.localizations.ar.stringUnit.value, /\p{Script=Arabic}/u, `${key}:ar must contain Arabic script`);
}
for (const [key, entry] of Object.entries(catalog.strings)) {
  for (const language of iosLanguages) assert.ok(entry.localizations?.[language]?.stringUnit?.value?.trim(), `${key}:${language}`);
}

const auth = await readFile(new URL('ios/YNXShop/WalletAuth.swift', root), 'utf8');
for (const term of ['P256.Signing.PrivateKey', 'YNX_PRODUCT_SESSION_CHALLENGE_V1', 'replay-', 'product-session', 'ynx-shop-v1', 'com.ynxweb4.shop']) assert.ok(auth.includes(term), term);
const androidActivity = await readFile(new URL('android/app/src/main/java/com/ynxweb4/shop/MainActivity.java', root), 'utf8');
for (const term of ['/privacy/export', '/privacy/delete', 'ACTION_CREATE_DOCUMENT', 'DELETE_MY_SHOP_DATA', 'R.string.privacy_data_title', 'R.string.privacy_delete_warning', 'R.string.privacy_delete_failed']) assert.ok(androidActivity.includes(term), `android privacy: ${term}`);
for (const forbidden of ['Shop data export and deletion', 'Delete personal Shop data', 'Exact confirmation phrase required.', 'Personal Shop data deleted. Receipt']) assert.ok(!androidActivity.includes(forbidden), `android hard-coded privacy copy: ${forbidden}`);
const manifest = await readFile(new URL('android/app/src/main/AndroidManifest.xml', root), 'utf8');
const localeController = await readFile(new URL('android/app/src/main/java/com/ynxweb4/shop/LocaleController.java', root), 'utf8');
assert.ok(manifest.includes('android:supportsRtl="true"'), 'Android manifest must support RTL');
assert.ok(localeController.includes('config.setLayoutDirection(locale)'), 'Android locale controller must apply RTL layout direction');

const iosModel = await readFile(new URL('ios/YNXShop/ShopModel.swift', root), 'utf8');
const iosView = await readFile(new URL('ios/YNXShop/ContentView.swift', root), 'utf8');
const iosApp = await readFile(new URL('ios/YNXShop/YNXShopApp.swift', root), 'utf8');
for (const term of ['privacy/export', 'privacy/delete', 'DELETE_MY_SHOP_DATA', 'privacyExportURL', 'privacy_export_ready', 'privacy_delete_failed']) assert.ok(iosModel.includes(term) || iosView.includes(term), `iOS privacy: ${term}`);
for (const term of ['privacy_data_title', 'privacy_data_description', 'privacy_export_button', 'privacy_share_label', 'privacy_delete_warning', 'privacy_delete_button']) assert.ok(iosView.includes(term), `iOS privacy view: ${term}`);
for (const forbidden of ['Shop data export and deletion', 'Prepare JSON export', 'Delete personal Shop data', 'Shop data export ready.', 'Exact deletion confirmation required.']) assert.ok(!iosModel.includes(forbidden) && !iosView.includes(forbidden), `iOS hard-coded privacy copy: ${forbidden}`);
assert.ok(iosApp.includes("model.appLanguage == \"ar\" ? .rightToLeft : .leftToRight"), 'iOS must apply Arabic RTL layout direction');

const plist = await readFile(new URL('ios/YNXShop/Info.plist', root), 'utf8');
assert.ok(plist.includes('<string>ynxshop</string>'));
console.log('Native contract/i18n/privacy static verification passed.');
