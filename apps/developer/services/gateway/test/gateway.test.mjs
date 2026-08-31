import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGateway } from "../src/gateway.mjs";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";

async function fixture(t){const root=await mkdtemp(join(tmpdir(),"ynx-code-gateway-"));await mkdir(join(root,"assets"));await writeFile(join(root,"index.html"),"<!doctype html><title>YNX Code</title>");await writeFile(join(root,"assets","app-abcdef.js"),"globalThis.YNX=true");const runtime=createWorkspaceRuntime({root:join(root,"runtime"),sessionKey:Buffer.alloc(32,5)}),server=createServer(createGateway({staticRoot:root,runtime,version:"test",sourceCommit:"a".repeat(40),sourceTree:"b".repeat(40)}));await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})});return`http://127.0.0.1:${server.address().port}`}
test("gateway serves the SPA, immutable assets and security headers",async t=>{const url=await fixture(t),spa=await fetch(`${url}/project/example`,{headers:{accept:"text/html"}}),asset=await fetch(`${url}/assets/app-abcdef.js`);assert.equal(spa.status,200);assert.match(await spa.text(),/YNX Code/);assert.match(spa.headers.get("content-security-policy"),/frame-ancestors 'none'/);assert.equal(asset.headers.get("cache-control"),"public, max-age=31536000, immutable");assert.match(await asset.text(),/YNX=true/)});
test("gateway rejects traversal and routes runtime health through the same origin",async t=>{const url=await fixture(t),traversal=await fetch(`${url}/%5c..%5csecret`),health=await fetch(`${url}/runtime/health`),gateway=await fetch(`${url}/healthz`);assert.equal(traversal.status,400);assert.equal((await health.json()).protocolVersion,"ynx-code/v1");const identity=await gateway.json();assert.equal(identity.version,"test");assert.equal(identity.sourceCommit,"a".repeat(40));assert.equal(identity.sourceTree,"b".repeat(40))});
