import assert from "node:assert/strict";
import test from "node:test";
import { locales, messages, semanticMarkers, translate } from "./i18n";

test("all 12 locales contain every nonblank key",()=>{
  const expected=Object.keys(messages.en).sort();
  assert.equal(locales.length,12);
  for(const locale of locales){assert.deepEqual(Object.keys(messages[locale]).sort(),expected);for(const key of expected)assert.ok(translate(locale,key as keyof typeof messages.en).trim(),`${locale}.${key}`)}
});

test("payment, refund and committed-state translations preserve strict semantics",()=>{
  for(const locale of locales){
    for(const marker of semanticMarkers[locale].sign)assert.ok(messages[locale].signingNotice.includes(marker),`${locale} signing semantic: ${marker}`);
    for(const marker of semanticMarkers[locale].refund)assert.ok(messages[locale].refundNotice.includes(marker),`${locale} refund semantic: ${marker}`);
    for(const marker of semanticMarkers[locale].committed)assert.ok(messages[locale].pendingBody.includes(marker),`${locale} committed semantic: ${marker}`);
  }
});
