import assert from "node:assert/strict";
import test from "node:test";
import {locales} from "./i18n";
import {hostedWalletText} from "./hostedWalletCopy";

const {mountGuest}=require("../test/guest-experience-fixture.cjs");
for(const locale of locales)test(`${locale}: actual Card Guest chooser and errors use localized Hosted Wallet copy`,async()=>{
  const app=await mountGuest({platform:"web",locale,props:{standardWalletState:{status:"disconnected",chooserOpen:true},walletError:hostedWalletText(locale,"rejected")}});
  try{assert.ok(app.text().includes(hostedWalletText(locale,"choice")));assert.ok(app.text().includes(hostedWalletText(locale,"rejected")));}
  finally{await app.unmount();}
});
