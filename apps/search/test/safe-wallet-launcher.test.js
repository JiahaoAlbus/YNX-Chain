import assert from "node:assert/strict";
import test from "node:test";
import {launchSearchWalletAuthorization,parseSearchAuthorizationDeepLink} from "../src/public/safe-wallet-launcher.js";

function request(now=new Date("2026-08-21T05:00:00.000Z")){return{version:"1",nonce:"A".repeat(32),chainId:"ynx_6423-1",requestingProduct:"search",productClientId:"ynx-search-web",bundleId:"com.ynxweb4.search.web",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"A".repeat(43),callback:"https://search-staging.43.153.202.237.sslip.io/auth/callback",scopes:["account:read","search:cases"],purpose:"Sign in to YNX Search",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+240000).toISOString()}}
function link(value){return`ynxwallet://authorize?request=${Buffer.from(JSON.stringify(value)).toString("base64url")}`}
function dom(){const events=new Map(),frame={style:{},setAttribute(){},remove(){this.removed=true}},document={visibilityState:"visible",body:{appendChild(value){assert.equal(value,frame)}},createElement(name){assert.equal(name,"iframe");return frame},addEventListener(name,fn){events.set(`d:${name}`,fn)},removeEventListener(name){events.delete(`d:${name}`)}},window={addEventListener(name,fn){events.set(`w:${name}`,fn)},removeEventListener(name){events.delete(`w:${name}`)}};return{document,window,frame}}

test("Search validates its exact product request before launch",()=>{
  const now=new Date("2026-08-21T05:00:01.000Z"),parsed=parseSearchAuthorizationDeepLink(link(request()),{now});
  assert.equal(parsed.productClientId,"ynx-search-web");
  assert.throws(()=>parseSearchAuthorizationDeepLink("ynxwallet://authorize",{now}),/missing or ambiguous/);
  assert.throws(()=>parseSearchAuthorizationDeepLink(link({...request(),bundleId:"com.evil.search"}),{now}),/product binding/);
});

test("Search controlled launcher never navigates the top-level page",async()=>{
  const topLevel={href:"https://search.ynxweb4.com/"},environment=dom();
  const result=await launchSearchWalletAuthorization(link(request()),{...environment,now:new Date("2026-08-21T05:00:01.000Z"),timeoutMs:1,location:topLevel});
  assert.equal(result.status,"timeout");
  assert.equal(topLevel.href,"https://search.ynxweb4.com/");
  assert.equal(environment.frame.removed,true);
  assert.ok(result.fallbackActions.some(action=>action.id==="official-ynx-wallet-download"));
  assert.ok(result.fallbackActions.some(action=>action.id==="standard-metamask"));
});
