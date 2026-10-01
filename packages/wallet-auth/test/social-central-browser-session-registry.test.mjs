import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCentralBrowserSessionRegistry,centralBrowserClient} from '../src/central-browser-session-registry.js';

test('Social registers one exact origin and identity-only scope without private permission',async()=>{
  const registry=createCentralBrowserSessionRegistry(JSON.parse(await readFile(new URL('../product-session-registry.json',import.meta.url))));
  const social=registry.find(client=>client.productId==='social');
  assert.deepEqual(social,{productId:'social',clientId:'ynx-social-v1-sso-v1',origin:'https://social.ynxweb4.com',redirectUri:'https://social.ynxweb4.com/sso/callback',audience:'ynx:social:identity',scopes:['identity:read']});
  const tuple={clientId:social.clientId,origin:social.origin,redirectUri:social.redirectUri};
  assert.equal(centralBrowserClient(registry,tuple),social);
  for(const changed of [{...tuple,origin:'https://social.ynxweb4.com.evil.example'},{...tuple,redirectUri:tuple.redirectUri+'?next=evil'}]){
    assert.throws(()=>centralBrowserClient(registry,changed),error=>error.code==='SSO_CLIENT_NOT_REGISTERED');
  }
  assert.deepEqual(registry.filter(client=>client.productId!=='social').map(client=>client.productId),['finance','exchange','quant']);
});
