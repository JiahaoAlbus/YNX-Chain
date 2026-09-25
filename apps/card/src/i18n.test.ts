import test from "node:test";
import assert from "node:assert/strict";
import {catalogs,date,detectLocale,isRTL,locales,money} from "./i18n";

test("all twelve Card locales are complete and nonblank",()=>{assert.equal(locales.length,12);const keys=Object.keys(catalogs.en).sort();for(const locale of locales){assert.deepEqual(Object.keys(catalogs[locale]).sort(),keys);for(const[key,value]of Object.entries(catalogs[locale]))assert.ok(value.trim(),`${locale}.${key}`)}});
test("Arabic RTL and locale formatting are deterministic",()=>{assert.equal(isRTL("ar"),true);assert.equal(isRTL("en"),false);assert.equal(detectLocale("ar-SA"),"ar");assert.equal(detectLocale("zh-TW"),"zh-TW");assert.match(money("de",12345,"EUR"),/123,45/);assert.ok(date("en","2026-07-18T06:00:00.000Z").length>5)});
test("safety and authority language remains explicit",()=>{for(const locale of locales){const text=[catalogs[locale].sandbox,catalogs[locale].security,catalogs[locale].reviewOnly,catalogs[locale].unavailableTruth].join(" ");assert.ok(text.length>80,locale)}assert.match(catalogs.en.reviewOnly,/cannot change.*move funds/);assert.match(catalogs.en.unavailableTruth,/No issuer.*No spendable card/)});
