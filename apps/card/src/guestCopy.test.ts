import test from"node:test";
import assert from"node:assert/strict";
import{locales}from"./i18n";
import{guestCopies,guestCopyComplete,guestCopySourceInventory,guestTemplate,guestText}from"./guestCopy";

test("every audited Guest copy key has an explicit value in all twelve locales",()=>{
  for(const locale of locales){
    assert.equal(guestCopyComplete(locale),true,locale);
    for(const key of guestCopySourceInventory)assert.ok(guestCopies[locale][key].trim(),`${locale}: ${key}`);
  }
});

test("Guest labels do not borrow authenticated Card catalog semantics",()=>{
  for(const locale of locales){
    assert.equal(guestText(locale,"Download YNX Wallet"),guestCopies[locale]["Download YNX Wallet"]);
    assert.equal(guestText(locale,"These controls change only the local demo state. They cannot affect a real card."),guestCopies[locale]["These controls change only the local demo state. They cannot affect a real card."]);
  }
});

test("dynamic Guest notices preserve their placeholders in all locales",()=>{
  for(const locale of locales){
    assert.match(guestTemplate(locale,"walletConnected",{address:"0x1234"}),/0x1234/);
    assert.match(guestTemplate(locale,"demoRecorded",{label:"Demo"}),/Demo/);
  }
});
