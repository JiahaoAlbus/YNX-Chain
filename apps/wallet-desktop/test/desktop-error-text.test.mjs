import assert from "node:assert/strict";
import test from "node:test";
import { desktopErrorText, ERROR_MESSAGES } from "../src/desktop-error-text.mjs";
import { createDesktopI18n, LOCALES, MESSAGES } from "../src/desktop-i18n.mjs";

const i18n=createDesktopI18n({systemLocale:"en-US"});
const display=code=>desktopErrorText({ok:false,error:{code}},key=>i18n.t(key));

test("stable prepare failures explain the corrective action without inventing a network outage",()=>{
  assert.match(display("INVALID_TRANSFER"),/valid recipient.*positive YNXT amount/);
  assert.match(display("INSUFFICIENT_FUNDS"),/network fee.*Reduce the amount/);
  assert.match(display("RPC_AMOUNT_UNSUPPORTED"),/whole YNXT amounts only/);
  for(const code of ["INVALID_TRANSFER","INSUFFICIENT_FUNDS","RPC_AMOUNT_UNSUPPORTED"]){
    assert.ok(display(code).includes(`(${code})`));
    assert.doesNotMatch(display(code),/network is unavailable|wallet is unavailable/i);
  }
  assert.match(display("RPC_UNAVAILABLE"),/network is unavailable/);
  assert.match(display("UNKNOWN_PREPARE_ERROR"),/Check the error code and Wallet status/);
  assert.doesNotMatch(display("UNKNOWN_PREPARE_ERROR"),/network is unavailable|wallet is unavailable|locked/i);
});

test("error guidance covers all advertised locales and leaves secret messages out",()=>{
  for(const [english,translations] of Object.entries(ERROR_MESSAGES))for(const [locale] of LOCALES){
    assert.equal(MESSAGES[english]?.[locale],translations[locale]);
    i18n.setLocale(locale);
    assert.ok(desktopErrorText({error:{code:"INVALID_TRANSFER",message:"private fixture secret"}},key=>i18n.t(key)));
    assert.doesNotMatch(desktopErrorText({error:{code:"INVALID_TRANSFER",message:"private fixture secret"}},key=>i18n.t(key)),/private fixture secret/);
  }
  i18n.setLocale("en");
  const hash=`0x${"ab".repeat(32)}`;
  assert.match(desktopErrorText({error:{code:"UNEXPECTED",storageStage:"read-verify",transactionHash:hash,outcomeUnknown:true}},key=>i18n.t(key)),new RegExp(hash));
  assert.doesNotMatch(desktopErrorText({error:{code:"UNEXPECTED",storageStage:"../../secret",transactionHash:"not-a-hash"}},key=>i18n.t(key)),/\.\.\/|not-a-hash/);
});
