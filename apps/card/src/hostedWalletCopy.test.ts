import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {locales} from "./i18n";
import {hostedWalletMessages,hostedWalletNotice,hostedWalletText} from "./hostedWalletCopy";

test("all twelve Card locales render distinct Hosted Wallet choice and async errors without English fallback",()=>{
  assert.equal(locales.length,12);
  const keys=Object.keys(hostedWalletMessages.en).sort();
  for(const locale of locales){
    assert.deepEqual(Object.keys(hostedWalletMessages[locale]).sort(),keys);
    for(const key of keys){
      const value=hostedWalletText(locale,key as keyof typeof hostedWalletMessages.en);
      assert.ok(value.trim());assert.doesNotMatch(value,/[\u202A-\u202E\u2066-\u2069]/);
      if(locale!=="en")assert.notEqual(value,hostedWalletText("en",key as keyof typeof hostedWalletMessages.en));
    }
  }
  assert.equal(hostedWalletNotice("USER_REJECTED"),"rejected");
  assert.equal(hostedWalletNotice("HOSTED_POPUP_CLOSED"),"popupClosed");
  assert.equal(hostedWalletNotice("WRONG_NETWORK"),"wrongNetwork");
});
test("actual Card Guest UI uses current-locale Hosted copy and keeps private session separate",()=>{
  const guest=readFileSync(new URL("./GuestExperience.tsx",import.meta.url),"utf8");
  const app=readFileSync(new URL("../App.tsx",import.meta.url),"utf8");
  assert.match(guest,/hostedWalletText\(locale,"choice"\)/);
  assert.match(guest,/hostedWalletText\(locale,"connected"\)/);
  assert.match(app,/walletError=\{hostedNotice\?hostedWalletText\(locale,hostedNotice\):walletError\}/);
  assert.match(app,/setPrivateSession\(null\)/);
  assert.doesNotMatch(app.slice(app.indexOf("const beginYNXWalletAuthorization"),app.indexOf("const signIn")),/ynxwallet:\/\/|Linking\.openURL/);
});
