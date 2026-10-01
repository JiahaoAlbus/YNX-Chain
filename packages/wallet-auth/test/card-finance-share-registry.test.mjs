import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {parseProductSessionRegistry,productPlatformBinding} from "../src/product-session-registry.js";

const registry=JSON.parse(readFileSync(new URL("../product-session-registry.json",import.meta.url),"utf8"));
const scope="card:finance:share";

test("Card Finance sharing is a distinct, explicitly requestable Card Product Session scope",()=>{
  const parsed=parseProductSessionRegistry(registry);
  const card=parsed.products.find(product=>product.productId==="card");
  assert.ok(card);
  assert.equal(card.scopes.filter(value=>value===scope).length,1);
  assert.deepEqual(card.scopes,[...card.scopes].sort());
  for(const platform of ["web","ios","android"]){
    const binding=productPlatformBinding(parsed,"card",platform);
    assert.equal(binding.clientId,"ynx-card-v1");
    assert.equal(binding.scopes.includes(scope),true);
    assert.equal(binding.callback,platform==="web"?"https://card.ynxweb4.com/wallet-auth/callback":"ynxcard://wallet-auth/callback");
  }
  assert.equal(parsed.products.find(product=>product.productId==="finance")?.scopes.includes(scope),false);
  assert.equal(card.scopes.includes("finance.profile.write"),false);
});

test("a Card Finance share request cannot be silently granted by another product or wildcard registry",()=>{
  const changed=structuredClone(registry);
  changed.products.find(product=>product.productId==="card").scopes.push("card:*");
  assert.throws(()=>parseProductSessionRegistry(changed),error=>error.code==="INVALID_ROUTER_REGISTRY");
});
