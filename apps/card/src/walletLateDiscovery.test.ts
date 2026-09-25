import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Card prewarms shared provider discovery without selecting an account or network",()=>{
  const app=readFileSync(new URL("../App.tsx",import.meta.url),"utf8");
  const start=app.indexOf('if(Platform.OS!=="web")return;\n    const probe='),end=app.indexOf("const persistSimulationLedger",start),prewarm=app.slice(start,end);
  assert.ok(start>=0&&end>start,"Card Web provider prewarm must remain present");
  assert.match(prewarm,/discoverWalletProviders\(globalThis,0\)/);
  assert.match(prewarm,/\[250,750,1500\]/);
  assert.match(prewarm,/ethereum#initialized/);
  assert.doesNotMatch(prewarm,/eth_accounts|eth_requestAccounts|wallet_switchEthereumChain|wallet_addEthereumChain|fetch\(/);
});
