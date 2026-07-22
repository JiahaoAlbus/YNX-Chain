import assert from "node:assert/strict";
import crypto from "node:crypto";

const api=process.argv[2];
if(!api)throw new Error("usage: node canonical-smoke.mjs <api-base>");
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value!==null&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`:JSON.stringify(value);
const call=async(path,init={})=>{const response=await fetch(api+path,{...init,headers:{"Content-Type":"application/json",...(init.headers||{})}});const type=response.headers.get("content-type")||"";const body=type.includes("json")?await response.json():await response.text();if(!response.ok){const error=new Error(body?.error||`HTTP ${response.status}`);error.status=response.status;error.body=body;throw error}return{body,response}};

async function authenticate(product){
  const docs=product==="docs",now=new Date(),client=docs?"ynx-docs-mobile-v1":"ynx-cloud-mobile-v1",bundle=docs?"com.ynxweb4.docs":"com.ynxweb4.cloud",callback=docs?"ynxdocs://wallet-auth/callback":"ynxcloud://wallet-auth/callback",scopes=docs?["ai.use","audit.read","comments.write","documents.read","documents.write","sharing.manage"]:["ai.use","audit.read","files.read","files.write","permissions.manage"];
  const request={version:"1",nonce:crypto.randomBytes(32).toString("base64url"),chainId:"ynx_6423-1",requestingProduct:product,productClientId:client,bundleId:bundle,productDeviceAlgorithm:"p256-sha256",productDeviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",callback,scopes,purpose:"Use explicitly authorized YNX content on this device.",issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now.getTime()+240000).toISOString()};
  if(docs)request.purpose="Edit only explicitly authorized YNX documents on this device.";
  const approval={version:"1",requestDigest:crypto.createHash("sha256").update(canonical(request)).digest("hex"),nonce:request.nonce,chainId:request.chainId,requestingProduct:product,productClientId:client,bundleId:bundle,productDeviceAlgorithm:request.productDeviceAlgorithm,productDeviceKey:request.productDeviceKey,callback,account:"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7h6v",accountPublicKey:"02"+"0".repeat(64),grantedScopes:scopes,purpose:request.purpose,issuedAt:now.toISOString(),expiresAt:request.expiresAt,walletSignature:"0".repeat(128)};
  const {body:challenge}=await call("/session/challenge",{method:"POST",body:JSON.stringify({authorizationRequest:request,walletApproval:approval})});
  const {body:session}=await call("/session",{method:"POST",body:JSON.stringify({authorizationRequest:request,walletApproval:approval,gatewayCompletion:{challenge,deviceSignature:"A".repeat(96)}})});
  return session.token;
}

const cloudToken=await authenticate("cloud"),cloudHeaders={Authorization:`Bearer ${cloudToken}`};
const {body:folder}=await call("/objects",{method:"POST",headers:cloudHeaders,body:JSON.stringify({kind:"folder",name:"Smoke folder",content:"",encryption:{clientSide:false}})});
const content=Buffer.from("canonical cloud smoke");
const createFile=()=>call("/objects",{method:"POST",headers:cloudHeaders,body:JSON.stringify({parentId:folder.id,kind:"file",name:"same-name.txt",mime:"text/plain",content:content.toString("base64"),encryption:{clientSide:false}})});
const {body:file}=await createFile(),{body:collision}=await createFile();assert.notEqual(file.id,collision.id,"same-name sync must create a collision-safe separate object");
const downloaded=await call(`/objects/${file.id}/content`,{headers:cloudHeaders});assert.equal(downloaded.response.headers.get("x-content-sha256"),crypto.createHash("sha256").update(content).digest("hex"));
const {body:share}=await call(`/objects/${file.id}/links`,{method:"POST",headers:cloudHeaders,body:JSON.stringify({role:"viewer",expiresAt:new Date(Date.now()+3600000).toISOString()})});
await call(`/shares/${share.token}`);await call(`/objects/${file.id}/links/${share.link.id}`,{method:"DELETE",headers:cloudHeaders});await assert.rejects(()=>call(`/shares/${share.token}`),error=>error.status===403);
await call(`/objects/${file.id}/trash`,{method:"POST",headers:cloudHeaders});await call(`/objects/${file.id}`,{method:"DELETE",headers:cloudHeaders,body:JSON.stringify({confirm:"DELETE"})});
await call("/quota",{headers:cloudHeaders});const {body:cloudUsage}=await call("/usage",{headers:cloudHeaders});assert.equal(cloudUsage.product,"cloud");assert.ok(cloudUsage.counters.ingressBytes>=content.length*2);assert.ok(cloudUsage.counters.egressBytes>=content.length);assert.equal(cloudUsage.pricingStatus,"not-configured-no-charge");assert.equal(cloudUsage.userChargeMinor,0);await call("/audit",{headers:cloudHeaders});

const docsToken=await authenticate("docs"),docsHeaders={Authorization:`Bearer ${docsToken}`};
const {body:doc}=await call("/objects",{method:"POST",headers:docsHeaders,body:JSON.stringify({kind:"doc",name:"Smoke doc",mime:"text/plain",content:Buffer.from("v1").toString("base64"),encryption:{clientSide:false}})});
const {body:v2}=await call(`/objects/${doc.id}/document`,{method:"PUT",headers:docsHeaders,body:JSON.stringify({baseVersion:1,content:Buffer.from("v2").toString("base64")})});assert.equal(v2.version,2);
await assert.rejects(()=>call(`/objects/${doc.id}/document`,{method:"PUT",headers:docsHeaders,body:JSON.stringify({baseVersion:1,content:Buffer.from("stale").toString("base64")})}),error=>error.status===409);
await call(`/objects/${doc.id}/comments`,{method:"POST",headers:docsHeaders,body:JSON.stringify({version:2,body:"Version-bound review",mentions:[]})});
await call(`/objects/${doc.id}/presence`,{method:"POST",headers:docsHeaders,body:JSON.stringify({label:"Editing"})});
const {body:docsUsage}=await call("/usage",{headers:docsHeaders});assert.equal(docsUsage.product,"docs");assert.equal(docsUsage.storageBytes,4);assert.equal(docsUsage.counters.ingressBytes,4);assert.equal(docsUsage.userChargeMinor,0);
console.log("YNX Cloud & Docs canonical API smoke passed");
