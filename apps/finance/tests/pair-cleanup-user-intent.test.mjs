import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/wallet-auth-entry.js',import.meta.url),'utf8');
const listener=source.match(/pair\.on\('cancelUnconfirmed',event=>\{([^\n]+)\}\);/);
assert.ok(listener);
test('Finance actual cleanup listener cannot replace an automatic failure or an unrelated attempt',()=>{
  let state={status:'failed',errorCode:'YNX_PAIR_RELAY_TIMEOUT'};
  const handler=vm.runInNewContext('(event)=>{'+listener[1]+'}',{publishPair:next=>state=next});
  handler({current:true,userCancelled:false});assert.equal(state.errorCode,'YNX_PAIR_RELAY_TIMEOUT');
  handler({current:false,userCancelled:true});assert.equal(state.errorCode,'YNX_PAIR_RELAY_TIMEOUT');
  handler({current:true});assert.equal(state.errorCode,'YNX_PAIR_RELAY_TIMEOUT');
  handler({current:true,userCancelled:true});assert.equal(state.status,'cancel-unconfirmed');assert.equal(state.errorCode,'PAIR_CANCEL_UNCONFIRMED');
});
