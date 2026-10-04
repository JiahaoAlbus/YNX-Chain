// Only invoked against a controlled real Go httptest server. Public GET only.
import assert from 'node:assert/strict';
import {createVenueConfigReader} from '../web/venue-config.js';
const base=new URL(process.argv[2]),expected=Number(process.argv[3]);
assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');
const calls=[];
const reader=createVenueConfigReader({fetchImpl:(path,options)=>{calls.push({path,method:options.method,credentials:options.credentials});return fetch(new URL(path,base),options)}});
try{
  await reader.refresh();assert.equal(reader.state().phase,'live');
  const value=reader.state().config,network=value.networks.find(n=>n.asset==='YNXT'&&n.network==='YNX Testnet');
  assert.equal(value.writeAuthorized,false);assert.equal(value.nativeAddressVerified,false);assert.equal(network.withdrawalFeeMicro,expected);assert.equal(network.withdrawalBroadcastEnabled,false);
  reader.offline();assert.equal(reader.state().config,null);await reader.refresh();assert.equal(reader.state().phase,'live');
  assert.equal(calls.length,2);for(const call of calls)assert.deepEqual(call,{path:'/api/v1/config',method:'GET',credentials:'omit'});
  console.log('EXCHANGE_REAL_HTTP_CONFIG_RECOVERY_PASS;reads=2;writes=0;writeAuthorized=false');
}finally{reader.stop()}
