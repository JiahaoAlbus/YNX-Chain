import test from "node:test";
import assert from "node:assert/strict";
import { detectLocale, invoiceCount, locales, messages, t } from "../src/i18n.js";

test("all twelve locales have complete nonblank audited strings",()=>{
  assert.equal(locales.length,12);
  const keys=Object.keys(messages.en);
  for(const locale of locales){
    assert.deepEqual(Object.keys(messages[locale]),keys);
    for(const key of keys)assert.ok(t(locale,key).trim(),`${locale}.${key}`);
  }
});

test("payment, refund, dispute and AI strings preserve strict authority boundaries",()=>{
  for(const locale of locales){
    assert.match(t(locale,"paidTruth"),/(YNXT|YNX)/i);
    assert.ok(!/button or timer can mark.*paid/i.test(t(locale,"paidTruth"))||locale!=="en");
    assert.match(t(locale,"refundTruth"),/(Wallet|钱包|錢包|返金|환불|reembolso|remboursement|Erstattung|استرداد|возврат|pengembalian)/i);
    assert.match(t(locale,"aiTruth"),/(AI|IA|KI|ИИ|الذكاء|人工知能|인공|智能)/i);
    assert.match(t(locale,"privacy"),/(Wallet|Gateway)/i);
    assert.ok(!/(credential|凭据|憑據|認証情報|자격 증명|credencial|identifiant|Anmeldedaten|Учётные данные|بيانات الاعتماد|Kredensial)/i.test(t(locale,"privacy")),`${locale} must not imply browser-held server credentials`);
  }
});

test("locale detection, Arabic and plural formatting are deterministic",()=>{
  assert.equal(detectLocale(["zh-TW"]),"zh-Hant");
  assert.equal(detectLocale(["ar-SA"]),"ar");
  assert.equal(detectLocale(["xx"]),"en");
  assert.match(invoiceCount("en",1),/^1 invoice$/);
  assert.match(invoiceCount("en",2),/^2 invoices$/);
});

test("accessibility navigation and Wallet sign-in labels are localized",()=>{
  for(const locale of locales){
    assert.ok(t(locale,"skipContent").trim(),`${locale}.skipContent`);
    assert.match(t(locale,"walletSignIn"),/YNX Wallet/i,`${locale}.walletSignIn`);
  }
});
