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

test("Android artifacts require their own direct package MIME type and full immutable facts",async()=>{
  const apkSpec={name:"wallet.apk",url:"https://www.ynxweb4.com/downloads/wallet.apk",bytes:body.length,sha256,expectedContentType:"application/vnd.android.package-archive"};
  const exact=await inspectOfficialArtifact(apkSpec,async()=>new Response(body,{status:200,headers:{"content-type":"application/vnd.android.package-archive; charset=binary","content-disposition":"attachment; filename=wallet.apk","content-length":String(body.length)}}));
  assert.equal(exact.hosted,true);assert.equal(exact.expectedContentType,"application/vnd.android.package-archive");
  const fallback=await inspectOfficialArtifact(apkSpec,async()=>new Response("website shell",{status:200,headers:{"content-type":"text/html; charset=utf-8","content-disposition":"inline","content-length":"13"}}));
  assert.equal(fallback.hosted,false);assert.equal(fallback.errorCode,"ARTIFACT_CONTENT_TYPE");
  const incomplete=await inspectOfficialArtifact({...apkSpec,bytes:null},async()=>{throw new Error("must not fetch")});
  assert.equal(incomplete.hosted,false);assert.equal(incomplete.errorCode,"INVALID_ARTIFACT_EXPECTATION");
});
