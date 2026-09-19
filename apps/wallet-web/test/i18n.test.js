import assert from "node:assert/strict";
import test from "node:test";
import {LOCALES, catalog, isRTL, untranslatedKeys} from "../src/i18n.js";

test("all twelve requested locales cover every English runtime key", () => {
  assert.deepEqual(LOCALES.map(([locale])=>locale),["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"]);
  const keys = Object.keys(catalog("en"));
  for (const [locale] of LOCALES) {
    const copy = catalog(locale);
    assert.deepEqual(Object.keys(copy),keys);
    for (const key of keys) assert.equal(typeof copy[key],"string");
    assert.deepEqual(untranslatedKeys(locale),[],`${locale} must not rely on English fallback`);
  }
  assert.equal(isRTL("ar"),true); assert.equal(isRTL("en"),false);
  assert.equal(catalog("ar").walletConnection,"اتصال المحفظة");
  assert.equal(catalog("ar").walletActions,"إجراءات المحفظة");
  assert.equal(catalog("en").providerNotInjected,"No wallet provider was detected. Enable an installed wallet and retry.");
  assert.equal(catalog("en").walletLocked,"The installed wallet is locked. Unlock it, then retry.");
  assert.equal(catalog("en").siteAccessDenied,"Wallet site access is denied for this HTTPS DApp. Allow access, then retry.");
  for(const key of ["providerNotInjected","walletLocked","siteAccessDenied"]){assert.equal(/[\u3400-\u9fff]/u.test(catalog("en")[key]),false);assert.notEqual(catalog("zh-CN")[key],catalog("en")[key])}
});
