import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWalletProviderEvents} from '../web/wallet-provider-lifecycle.js';

function providerWithListeners(){const listeners=new Map();return {on:(event,listener)=>listeners.set(event,listener),removeListener:(event,listener)=>{if(listeners.get(event)===listener)listeners.delete(event)},emit:(event,value)=>listeners.get(event)?.(value),listeners};}

test('Quant detaches a disconnected provider so stale events cannot mutate product state',()=>{
  const provider=providerWithListeners(),events=[];
  const detach=bindWalletProviderEvents(provider,{accountsChanged:value=>events.push(['accountsChanged',value]),chainChanged:value=>events.push(['chainChanged',value]),disconnect:()=>events.push(['disconnect'])});
  provider.emit('accountsChanged',['0x1111111111111111111111111111111111111111']);assert.equal(events.length,1);
  detach();detach();assert.equal(provider.listeners.size,0);
  provider.emit('accountsChanged',[]);provider.emit('chainChanged','0x1');provider.emit('disconnect');
  assert.deepEqual(events,[['accountsChanged',['0x1111111111111111111111111111111111111111']]]);
});

test('Quant uses off when a provider lacks removeListener',()=>{
  const listeners=new Map(),calls=[],provider={on:(event,listener)=>listeners.set(event,listener),off:(event,listener)=>{calls.push(event);if(listeners.get(event)===listener)listeners.delete(event)}};
  bindWalletProviderEvents(provider,{accountsChanged:()=>{},chainChanged:()=>{},disconnect:()=>{}})();
  assert.deepEqual(calls,['accountsChanged','chainChanged','disconnect']);assert.equal(listeners.size,0);
});
