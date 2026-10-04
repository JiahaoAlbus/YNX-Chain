import test from 'node:test';
import assert from 'node:assert/strict';
import {createVenueConfigReader,validateVenueConfig} from '../web/venue-config.js';
const native=()=>({asset:'YNXT',network:'YNX Testnet',chainId:'ynx_6423-1',evmChainId:6423,depositEnabled:true,withdrawalEnabled:false,withdrawalReviewEnabled:true,withdrawalBroadcastEnabled:false,crossChain:false,confirmations:12,withdrawalFeeMicro:250000});
const config=()=>({chainId:'ynx_6423-1',evmChainId:6423,nativeAsset:'YNXT',custodyAddress:'ynx1fixtureonlyaddress',networks:[native()]});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('actual TEST config semantics retain fee micros and keep broadcast/write/address authority false',()=>{
  const value=validateVenueConfig(config());assert.equal(value.networks[0].withdrawalFeeMicro,250000);assert.equal(value.writeAuthorized,false);assert.equal(value.nativeAddressVerified,false);
  const missing=config();delete missing.networks[0].withdrawalFeeMicro;assert.equal(validateVenueConfig(missing).networks[0].withdrawalFeeMicro,undefined);
  for(const patch of [{chainId:'mainnet'},{evmChainId:1},{custodyAddress:''},{networks:[native(),native()]},{networks:[{...native(),withdrawalBroadcastEnabled:true}]},{networks:[{...native(),withdrawalFeeMicro:1.5}]},{networks:[{...native(),confirmations:0}]}])assert.throws(()=>validateVenueConfig({...config(),...patch}));
});
test('only same-origin credential-free GET, explicit refresh, timeout and offline never send or restore stale fees',async()=>{
  const calls=[],states=[];let resolve;
  const reader=createVenueConfigReader({fetchImpl:(...args)=>{calls.push(args);return new Promise(r=>resolve=r)},onState:v=>states.push(v.phase),timeoutMs:10,maxAgeMs:15});
  const first=reader.refresh();await first;assert.equal(reader.state().phase,'unavailable');resolve(response(config()));await new Promise(r=>setTimeout(r,1));assert.equal(reader.state().config,null);
  const second=reader.refresh();reader.offline();resolve(response(config()));await second;assert.equal(reader.state().phase,'offline');
  const third=reader.refresh();resolve(response(config()));await third;assert.equal(reader.state().phase,'live');await new Promise(r=>setTimeout(r,25));assert.equal(reader.state().phase,'stale');assert.equal(reader.state().config,null);
  for(const [path,options] of calls){assert.equal(path,'/api/v1/config');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error')}
  reader.stop();await reader.refresh();assert.equal(calls.length,3);assert.equal(reader.state().phase,'closed');assert.ok(states.includes('live'));
});
test('HTML, duplicate JSON fields, UTF8/frame/size errors and dishonest route claims fail closed',async()=>{
  const duplicate=JSON.stringify(config()).replace('"evmChainId":6423','"evmChainId":1,"evmChainId":6423');
  for(const reply of [new Response('<html/>',{headers:{'content-type':'text/html'}}),new Response(duplicate,{headers:{'content-type':'application/json'}}),new Response(JSON.stringify(config()),{headers:{'content-type':'application/json','content-length':'1'}}),new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}}),response({...config(),networks:[{...native(),asset:'YUSD_TEST'}]})]){
    const reader=createVenueConfigReader({fetchImpl:async()=>reply});await reader.refresh();assert.equal(reader.state().phase,'unavailable');assert.equal(reader.state().config,null);reader.stop();
  }
});
test('new explicit read fences a delayed older read without private proof or repeat writes',async()=>{
  const pending=[];const reader=createVenueConfigReader({fetchImpl:()=>new Promise(r=>pending.push(r))});
  const old=reader.refresh(),newer=reader.refresh();const changed=config();changed.networks[0].withdrawalFeeMicro=500000;
  pending[1](response(changed));await newer;pending[0](response(config()));await old;assert.equal(reader.state().config.networks[0].withdrawalFeeMicro,500000);reader.stop();
});
