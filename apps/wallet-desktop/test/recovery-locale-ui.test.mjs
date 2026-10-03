import assert from "node:assert/strict";
import test from "node:test";
import {renderRecoveryReview} from "../src/password-vault-ui.mjs";
import {initWalletLocale,WALLET_LOCALES,WALLET_COPY} from "../src/wallet-locale.mjs";
function mounted(){
  class Element{
    constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.isConnected=true}
    set textContent(value){this.children=[];this.text=String(value)}
    get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(""):this.text??""}
    replaceChildren(...children){for(const child of this.children)child.isConnected=false;this.children=children}
    append(...children){this.children.push(...children)}
  }
  const doc={documentElement:{},querySelector:()=>null,querySelectorAll:()=>[],createElement:tag=>new Element(doc,tag),createTextNode:text=>({textContent:text})};
  return{doc,node:doc.createElement("p"),locale:initWalletLocale({document:doc})};
}
test("all twelve recovery reviews preserve the account and required-account count while retaining every safety disclosure",()=>{
  const account="ynx1OriginalCASE<not-html>";
  for(const resetPassword of [true,false]){
    const h=mounted();renderRecoveryReview(h.node,{account,resetPassword,count:3});
    for(const locale of WALLET_LOCALES){
      h.locale.select(locale);
      const expected=[WALLET_COPY[locale]["Restore {account}."].replace("{account}",account),
        WALLET_COPY[locale][resetPassword?"A new local password will be set. {count} other account(s) will remain visible and need their own recovery. The old encrypted Wallet is retained.":"The current password and other protected accounts will be retained."].replace("{count}","3"),
        WALLET_COPY[locale]["Existing app permissions will be revoked. Pending transactions remain recorded."]].join(" ")+" ";
      assert.equal(h.node.textContent,expected);
      const value=h.node.children[0].children.find(child=>child.tagName==="bdi");assert.equal(value.textContent,account);assert.equal(value.dir,"ltr");
    }
  }
});
test("replacing a recovery review removes the prior account and count rather than reviving it on a language change",()=>{
  const h=mounted();renderRecoveryReview(h.node,{account:"old-account",resetPassword:true,count:42});
  renderRecoveryReview(h.node,{account:"new-account",resetPassword:false,count:0});h.locale.select("ar");
  assert.ok(h.node.textContent.includes("new-account"));assert.ok(!h.node.textContent.includes("old-account"));assert.ok(!h.node.textContent.includes("42"));
});
