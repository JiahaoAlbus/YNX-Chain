import assert from "node:assert/strict";
import test from "node:test";
import {validateWalletPublicRegistry} from "../src/public-deployment-policy.js";

const expected="4e354148177376226153a0a6c8ead3df8d891d3e";
const registry={schemaVersion:1,products:[{key:"wallet",commit:expected,publicWeb:"https://www.ynxweb4.com/dapp/wallet",state:"public-wallet-web"}]};

test("public deployment requires an exact full source commit and frozen route",()=>{
  assert.equal(validateWalletPublicRegistry(registry,expected).deployedPublic,true);
});

test("old, abbreviated, missing, duplicate and wrong-route records fail closed",()=>{
  for(const candidate of [
    {...registry,products:[{...registry.products[0],commit:"bb751ce3"}]},
    {...registry,products:[{...registry.products[0],commit:expected.slice(0,8)}]},
    {schemaVersion:1,products:[]},
    {...registry,products:[...registry.products,...registry.products]},
    {...registry,products:[{...registry.products[0],publicWeb:"https://example.com/wallet"}]},
  ])assert.throws(()=>validateWalletPublicRegistry(candidate,expected));
});
