import test from"node:test";
import assert from"node:assert/strict";
import{locales}from"./i18n";
import{guestCopyComplete,guestText}from"./guestCopy";

test("Guest labels are complete across the twelve advertised Card locales",()=>{
  for(const locale of locales)assert.equal(guestCopyComplete(locale),true,locale);
});

test("Guest safety and wallet labels do not fall back to English for Chinese or Arabic",()=>{
  for(const locale of ["zh-CN","ar"] as const){
    for(const value of ["Overview","Connect YNX Wallet","TESTNET SANDBOX","No real funds, cards, merchants, settlement, PAN, CVV, or personal data."])assert.notEqual(guestText(locale,value),value,locale+": "+value);
  }
});
