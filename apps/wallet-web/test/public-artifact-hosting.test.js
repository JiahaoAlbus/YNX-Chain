import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {inspectOfficialArtifact} from "../src/public-artifact-hosting.js";

const body=new TextEncoder().encode("exact zip fixture");
const sha256=createHash("sha256").update(body).digest("hex");
const spec={name:"wallet.zip",url:"https://www.ynxweb4.com/downloads/wallet.zip",bytes:body.length,sha256};

test("official artifact requires exact direct ZIP headers, bytes and SHA-256",async()=>{
  const result=await inspectOfficialArtifact(spec,async()=>new Response(body,{status:200,headers:{"content-type":"application/zip","content-disposition":"attachment; filename=wallet.zip","content-length":String(body.length)}}));
  assert.equal(result.hosted,true);assert.equal(result.downloadedBytes,body.length);assert.equal(result.downloadedSha256,sha256);
});

test("HTTP 200 SPA fallback and non-official origins fail closed",async()=>{
  const fallback=await inspectOfficialArtifact(spec,async()=>new Response("website shell",{status:200,headers:{"content-type":"text/html; charset=utf-8","content-disposition":"inline","content-length":"13"}}));
  assert.equal(fallback.hosted,false);assert.equal(fallback.errorCode,"ARTIFACT_CONTENT_TYPE");
  const external=await inspectOfficialArtifact({...spec,url:"https://github.com/example/wallet.zip"},async()=>{throw new Error("must not fetch")});
  assert.equal(external.hosted,false);assert.equal(external.errorCode,"NON_OFFICIAL_ORIGIN");
});

test("content-addressed official route may redirect only to an immutable GitHub release asset",async()=>{
  const redirected={...spec,allowImmutableReleaseRedirect:true};let calls=0;
  const result=await inspectOfficialArtifact(redirected,async(_url,options)=>{
    calls+=1;
    if(options.redirect==="manual")return new Response(null,{status:302,headers:{location:"https://release-assets.githubusercontent.com/github-production-release-asset/1/exact","cache-control":"public, max-age=31536000, immutable","content-disposition":"attachment"}});
    const response=new Response(body,{status:200,headers:{"content-type":"application/octet-stream","content-disposition":"attachment; filename=wallet.zip","content-length":String(body.length)}});
    Object.defineProperty(response,"url",{value:"https://release-assets.githubusercontent.com/github-production-release-asset/1/exact"});return response;
  });
  assert.equal(calls,2);assert.equal(result.hosted,true);assert.equal(result.redirected,true);assert.equal(result.releaseAssetHost,"release-assets.githubusercontent.com");
  const rejected=await inspectOfficialArtifact(redirected,async()=>new Response(null,{status:302,headers:{location:"https://example.com/wallet.zip","cache-control":"immutable","content-disposition":"attachment"}}));
  assert.equal(rejected.hosted,false);assert.equal(rejected.errorCode,"ARTIFACT_REDIRECT_TARGET");
});
