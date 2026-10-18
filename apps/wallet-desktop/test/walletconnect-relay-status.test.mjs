import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {WalletConnectTransport} from '../src/walletconnect-transport.mjs';

// Controlled public transport only: no real relay, pairing, keys or session.
async function fixture(){
 const relayer=new EventEmitter();relayer.connected=false;
 const notices=[];const kit={core:{relayer},on(){},getActiveSessions:()=>({}),getPendingSessionProposals:()=>[],getPendingSessionRequests:()=>[]};
 const transport=new WalletConnectTransport({projectId:'public-test-id',walletKitFactory:async()=>kit});
 const callbacks={onPairState:state=>notices.push(state)};await transport.start(callbacks);
 return {transport,relayer,notices,callbacks};
}
test('late relay connect and disconnect publish actual status without another pair or UI refresh',async()=>{
 const f=await fixture();f.relayer.connected=true;f.relayer.emit('relayer_connect');
 assert.equal(f.notices.at(-1)?.relayConnected,true);assert.equal(f.notices.at(-1)?.activeSessionCount,0);
 f.relayer.connected=false;f.relayer.emit('relayer_disconnect');
 assert.equal(f.notices.at(-1)?.relayConnected,false);assert.equal(f.notices.at(-1)?.code,'WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED');
 assert.equal(f.transport.status().pairing,false);
});
test('repeated start does not add relay listeners or infer connection from an error event',async()=>{
 const f=await fixture();await f.transport.start(f.callbacks);
 assert.equal(f.relayer.listenerCount('relayer_connect'),1);
 for(const event of ['relayer_error','relayer_connection_stalled','relayer_transport_closed']){
  f.relayer.emit(event,new Error('PUBLIC_TRANSPORT_ERROR'));
  assert.equal(f.notices.at(-1)?.relayConnected,false);assert.equal(f.notices.at(-1)?.started,true);
 }
});
