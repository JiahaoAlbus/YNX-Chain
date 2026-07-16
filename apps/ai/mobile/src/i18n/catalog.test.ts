import assert from "node:assert/strict";
import test from "node:test";
import {catalogForTest,isRTL,resolveLocale,supportedLocales} from "./catalog";

test("all 12 audited locales contain every nonblank key",()=>{
  assert.equal(supportedLocales.length,12);
  const keys=Object.keys(catalogForTest.en);
  for(const locale of supportedLocales){
    assert.deepEqual(Object.keys(catalogForTest[locale]).sort(),keys.sort());
    for(const key of keys) assert.ok(catalogForTest[locale][key as keyof typeof catalogForTest.en].trim(),`${locale}:${key}`);
  }
});
test("locale fallback and Arabic RTL are deterministic",()=>{
  assert.equal(resolveLocale("zh_Hant"),"zh-CN");
  assert.equal(resolveLocale("ar-SA"),"ar");
  assert.equal(resolveLocale("xx"),"en");
  assert.equal(isRTL("ar"),true);
  assert.equal(isRTL("en"),false);
});
