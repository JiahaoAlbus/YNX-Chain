import assert from "node:assert/strict";
import test from "node:test";
import {p256} from "@noble/curves/nist.js";
import registry from "../vendor/product-session-registry-b754ffc42.json" with {type:"json"};
import {createProductSessionRequest,encodeProductSessionWalletURL,parseProductSessionReturnURL} from "@ynx-chain/wallet-auth-card-provider-v2";
import {PRIVATE_REPLAY_KEY,consumePrivateReplay,parsePrivateRequest,privateReplayKey,rejectPrivateReturn,signPrivateReturn} from "../src/extension-product-session-v2.js";

const at=new Date("2026-09-25T04:00:00.000Z"),origin="https://card.ynxweb4.com",secret="1".padStart(64,"0");
const deviceKey=Buffer.from(p256.getPublicKey(Buffer.alloc(32,0x42),true)).toString("base64url");
const input={productId:"card",platform:"web",deviceId:`web_${"a".repeat(43)}`,deviceKey,scopes:["account:read","card:application:write","card:controls:write","card:finance:share"],purpose:"Approve Card TEST access and separately selected Finance sharing.",nonce:"b".repeat(43),state:"c".repeat(43)};
const request=createProductSessionRequest(registry,input,at),url=encodeProductSessionWalletURL(registry,request,at);

test("official Card v2 request stays bound to exact browser origin and signed return",()=>{
  assert.deepEqual(parsePrivateRequest([url],origin,at),request);
  assert.throws(()=>parsePrivateRequest([url],"https://finance.ynxweb4.com",at),{code:"PRIVATE_ORIGIN_MISMATCH"});
  assert.throws(()=>parsePrivateRequest([url,"extra"],origin,at),{code:"PRIVATE_REQUEST_INVALID"});
  const signed=signPrivateReturn(request,secret,new Date(at.getTime()+1000));
  assert.equal(signed.version,2);
  assert.equal(parseProductSessionReturnURL(registry,request,signed.returnUrl,new Date(at.getTime()+1000)).status,"ready");
  assert.equal(parseProductSessionReturnURL(registry,request,rejectPrivateReturn(request,new Date(at.getTime()+1000)).returnUrl,new Date(at.getTime()+1000)).status,"user-rejected");
});

test("private replay ledger rejects same pending request across worker instances and permits a fresh SDK request",async()=>{
  const state={};const storage={async get(key){return {[key]:state[key]}},async set(value){Object.assign(state,value)}};
  const key=privateReplayKey(request,at),expiry=Date.parse(request.expiresAt);
  await consumePrivateReplay(storage,key,expiry,at.getTime());
  await assert.rejects(()=>consumePrivateReplay(storage,key,expiry,at.getTime()+1000),{code:"PRIVATE_REQUEST_REPLAYED"});
  assert.equal(state[PRIVATE_REPLAY_KEY].length,1);
  const fresh=createProductSessionRequest(registry,{...input,nonce:"d".repeat(43),state:"e".repeat(43)},at);
  await consumePrivateReplay(storage,privateReplayKey(fresh,at),Date.parse(fresh.expiresAt),at.getTime()+1000);
  assert.equal(state[PRIVATE_REPLAY_KEY].length,2);
});
