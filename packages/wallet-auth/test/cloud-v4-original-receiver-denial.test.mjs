import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProductSessionGatewayNodeHost,readOriginalDeveloperHTTPCredential} from '../src/product-session-gateway-node-host.js';

test('V4 receiver refuses an unprovided original holder without consuming a nonce',async t=>{
  const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url)));
  const dir=mkdtempSync(join(tmpdir(),'ynx-cloud-v4-public-denial-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(dir,'state.json'),now:()=>new Date(),tokenFactory:()=> 'x'.repeat(43)});
  const original=JSON.stringify(host.snapshot());
  const input={requestId:'req_PUBLIC_cloud_v4_0001',method:'GET',path:'/api/v1/objects',body:'',proofHeader:'PUBLIC_ONLY',expected:{}};
  for(const method of ['authenticateOriginalDeveloperHTTPRequestV4','revalidateOriginalDeveloperHTTPRequestV4'])
    await assert.rejects(host[method](input),{code:'PRODUCT_SESSION_DEVICE_CURRENT_NOT_SUPPLIED'});
  assert.equal(JSON.stringify(host.snapshot()),original);
  await assert.rejects(readOriginalDeveloperHTTPCredential({}),{code:'ORIGINAL_HTTP_CREDENTIAL_REQUIRED'});
});
