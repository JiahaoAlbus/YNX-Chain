import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config=JSON.parse(await readFile(new URL("../app.json",import.meta.url),"utf8")).expo;
const source=await readFile(new URL("../App.tsx",import.meta.url),"utf8");
assert.equal(config.name,"YNX Wallet");
assert.equal(config.scheme,"ynxwallet");
assert.equal(config.android.package,"com.ynxweb4.wallet");
assert.equal(config.ios.bundleIdentifier,"com.ynxweb4.wallet");
assert.equal(config.extra.nativeChainId,"ynx_6423-1");
assert.equal(config.extra.evmChainId,6423);
assert.equal(config.extra.nativeAsset,"YNXT");
assert.equal(config.extra.internalAcceptanceShell,false);
assert.equal(config.android.intentFilters[0].data[0].host,"authorize");
for(const forbidden of ["Social Feed","Shop tab","Pay tab","Exchange tab"])assert.equal(source.includes(forbidden),false);
for(const required of ["Sign in with YNX Wallet","Requesting App","App identity","Permissions","Purpose","Valid until","Approve","Reject","AI security explanation"])assert.equal(source.includes(required),true,`missing ${required}`);
assert.ok((source.match(/accessibilityLabel=/g)??[]).length>=14,"Wallet controls need explicit accessibility labels");
console.log("wallet product-check passed: independent IDs, exact network/asset identity, bounded authorization UI, route isolation, and accessibility labels");
