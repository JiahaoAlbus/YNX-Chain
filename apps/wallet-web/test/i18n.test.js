import assert from "node:assert/strict";
import test from "node:test";
import {LOCALES, catalog, isRTL} from "../src/i18n.js";

test("all twelve requested locales cover every English runtime key", () => {
  assert.deepEqual(LOCALES.map(([locale])=>locale),["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"]);
  const keys = Object.keys(catalog("en"));
  for (const [locale] of LOCALES) {
    const copy = catalog(locale);
    assert.deepEqual(Object.keys(copy),keys);
    for (const key of keys) assert.equal(typeof copy[key],"string");
  }
  assert.equal(isRTL("ar"),true); assert.equal(isRTL("en"),false);
});
