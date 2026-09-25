import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Card makes an ambiguous read-only Wallet restore chooser-driven without requesting accounts",()=>{
  const app=readFileSync(new URL("../App.tsx",import.meta.url),"utf8");
  const start=app.indexOf("const restore=async()=>"),end=app.indexOf("const resume=",start),restore=app.slice(start,end);
  assert.ok(start>=0&&end>start,"Card restore effect must remain present");
  assert.match(restore,/restoreEip1193Wallet\(provider,kind,new Date\(\)\)/);
  assert.match(restore,/if\(restored\.length>1\)\{setStandardWalletState\(current=>reduceStandardWalletConnectState\(current,\{type:"OPEN_CHOOSER"\}\)\);setWalletError\("More than one approved Wallet was restored\. Choose YNX Wallet or MetaMask to continue\."\);return;\}/);
  assert.doesNotMatch(restore,/eth_requestAccounts|wallet_requestPermissions/);
});
