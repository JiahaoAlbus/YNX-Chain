import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizationRequest } from "@ynx-chain/wallet-auth";
import { GatewaySecurityReviewProvider, SecurityReviewController, type SecurityReviewProvider } from "./securityReview";

const request={version:"1",nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",chainId:"ynx_6423-1",requestingProduct:"social",productClientId:"ynx-social-v1",bundleId:"com.ynxweb4.social",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",callback:"ynxsocial://wallet-auth/callback",scopes:["account:read","profile:link"],purpose:"Link the selected account",issuedAt:"2026-07-15T11:59:00.000Z",expiresAt:"2026-07-15T12:04:00.000Z"} as AuthorizationRequest;
const now=()=>new Date("2026-07-15T12:00:00.000Z");

test("provider-backed security review covers preview, status, estimate, consent, stream, review, apply and audit",async()=>{
  const provider:SecurityReviewProvider={
    status:async()=>({available:true,provider:"review-provider",model:"risk-model",detail:"ready"}),
    stream:async({context,prompt,onToken})=>{assert.deepEqual(Object.keys(context).sort(),["bundleId","chainId","expiresAt","outputLanguage","productClientId","purpose","requestingProduct","scopes"]);assert.match(prompt,/English/);onToken("Least privilege. ");onToken("No secret is shared.");},
  };
  const controller=new SecurityReviewController(request,now);
  assert.equal(controller.preview().phase,"preview");
  assert.equal((await controller.checkProvider(provider)).phase,"permission");
  assert.equal(controller.snapshot().estimate.maximumMonetaryCostYNXT,0);
  controller.allow();
  assert.equal((await controller.run(provider)).phase,"review");
  assert.equal(controller.snapshot().output,"Least privilege. No secret is shared.");
  assert.equal(controller.apply().phase,"applied");
  assert.deepEqual(controller.snapshot().audits.map((item)=>item.action),["permission-granted","provider-result","result-applied"]);
});

test("unavailable provider is honest and retry requires fresh consent",async()=>{
  const provider:SecurityReviewProvider={status:async()=>({available:false,provider:null,model:null,detail:"provider unavailable"}),stream:async()=>{throw new Error("must not stream");}};
  const controller=new SecurityReviewController(request,now);
  assert.equal((await controller.checkProvider(provider)).phase,"unavailable");
  assert.throws(()=>controller.allow(),/available/);
  assert.equal(controller.retry().phase,"preview");
  assert.equal(controller.snapshot().allowed,false);
});

test("provider failure exposes audited retry without automatic approval",async()=>{
  const provider:SecurityReviewProvider={status:async()=>({available:true,provider:"p",model:"m",detail:"ready"}),stream:async()=>{throw new Error("quota unavailable");}};
  const controller=new SecurityReviewController(request,now);
  await controller.checkProvider(provider);controller.allow();
  assert.equal((await controller.run(provider)).phase,"failed");
  assert.match(controller.snapshot().error??"",/quota/);
  assert.equal(controller.retry().phase,"preview");
});

test("a user can cancel a live stream and retry only after fresh permission",async()=>{
  const provider:SecurityReviewProvider={
    status:async()=>({available:true,provider:"p",model:"m",detail:"ready"}),
    stream:async({signal,onToken})=>new Promise<void>((_resolve,reject)=>{onToken("Partial advisory");signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});}),
  };
  const controller=new SecurityReviewController(request,now);
  await controller.checkProvider(provider);controller.allow();
  const running=controller.run(provider);
  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(controller.snapshot().phase,"streaming");
  controller.cancel();
  assert.equal((await running).phase,"cancelled");
  assert.equal(controller.snapshot().audits.at(-1)?.action,"stream-cancelled");
  assert.equal(controller.retry().allowed,false);
});

test("Gateway review sends selected metadata in a POST body instead of a URL query",async()=>{
  const original=globalThis.fetch;
  let captured:{url:string;init:RequestInit}|undefined;
  globalThis.fetch=(async(url:URL|string|Request,init?:RequestInit)=>{captured={url:String(url),init:init??{}};return new Response('event: token\ndata: {"token":"bounded"}\n\n',{status:200,headers:{"Content-Type":"text/event-stream"}})}) as typeof fetch;
  try{
    const provider=new GatewaySecurityReviewProvider("https://gateway.example/","session-token");
    const tokens:string[]=[];
    await provider.stream({prompt:"explain",context:{scope:"account:read"},signal:new AbortController().signal,onToken:(token)=>tokens.push(token)});
    assert.equal(captured?.url,"https://gateway.example/ai/stream");
    assert.equal(captured?.init.method,"POST");
    assert.equal((captured?.init.headers as Record<string,string>)["Content-Type"],"application/json");
    assert.deepEqual(JSON.parse(String(captured?.init.body)),{session:"wallet-security-review",prompt:"explain",context:{scope:"account:read"}});
    assert.deepEqual(tokens,["bounded"]);
  }finally{globalThis.fetch=original}
});
