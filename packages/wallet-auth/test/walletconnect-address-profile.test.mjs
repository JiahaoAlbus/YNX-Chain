import test from 'node:test';
import assert from 'node:assert/strict';
import * as implementation from '../src/walletconnect-dapp-connection.js';
const origin='https://wallet.ynxweb4.com',topic='a'.repeat(64),account='0x'+'1'.repeat(40);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const session=(methods=[])=>({topic,expiry:Math.floor(Date.now()/1000)+300,peer:{metadata:{url:origin}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],chains:['eip155:6423'],methods,events:['accountsChanged','chainChanged']}}});
function fixture(existing=[]){
 const calls=[],events=new Map();let approve;
 const client={on:(event,fn)=>events.set(event,fn),session:{getAll:()=>existing},core:{pairing:{disconnect:async input=>calls.push(['cancel',input])}},connect:async input=>{calls.push(['connect',input]);return {uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:()=>new Promise(resolve=>approve=resolve)};},request:async()=>{calls.push(['request']);throw Error('ADDRESS_PROFILE_MUST_NOT_SEND_RPC');},disconnect:async input=>calls.push(['disconnect',input])};
 const options={clientFactory:async options=>{calls.push(['init',options]);return client;},deadlineMs:100};
 return {client,calls,events,options,approve:value=>approve(value)};
}
test('official address profile admits exact empty-method configuration with no identity permissions',()=>{
 assert.doesNotThrow(()=>new implementation.WalletConnectDAppConnection({origin,methods:[]}));
 for(const badOrigin of ['http://wallet.ynxweb4.com','https://wallet.ynxweb4.com/','https://wallet.ynxweb4.com.evil.example','https://social.ynxweb4.com'])assert.throws(()=>new implementation.WalletConnectDAppConnection({origin:badOrigin,methods:[]}),/CONFIGURATION_INVALID/);
 for(const method of ['personal_sign','eth_sendTransaction','eth_accounts','ynx_requestProductSessionV2','ynx_requestCentralBrowserSignIn'])assert.throws(()=>new implementation.WalletConnectDAppConnection({origin,methods:[method]}),/CONFIGURATION_INVALID/);
});
test('public factory uses original single-flight transport and empty proposal; all reads stay local',async()=>{
 const publicAPI=await import('@ynx-chain/wallet-auth/walletconnect-dapp-connection');
 assert.equal(publicAPI.createWalletAddressConnection,implementation.createWalletAddressConnection);
 const f=fixture(),connection=publicAPI.createWalletAddressConnection(f.options);let uri;
 await assert.rejects(connection.provider().request({method:'eth_accounts'}),/SESSION_EXPIRED/);
 const first=connection.connect({onURI:value=>uri=value});assert.equal(first,connection.connect());await tick();
 assert.match(uri,/^wc:/);assert.equal(f.calls.filter(([name])=>name==='init').length,1);
 assert.equal(f.calls[0][1].metadata.url,origin);
 assert.deepEqual(f.calls.find(([name])=>name==='connect')[1].requiredNamespaces.eip155,{chains:['eip155:6423'],methods:[],events:['accountsChanged','chainChanged']});
 f.approve(session());const provider=await first;
 for(const method of ['eth_accounts','eth_requestAccounts'])assert.deepEqual(await provider.request({method}),[account]);
 assert.equal(await provider.request({method:'eth_chainId'}),'0x1917');
 for(const method of ['personal_sign','eth_sendTransaction','ynx_requestProductSessionV2','ynx_requestCentralBrowserSignIn','wallet_switchEthereumChain'])await assert.rejects(provider.request({method}),/METHOD_NOT_APPROVED/);
 assert.equal(f.calls.filter(([name])=>name==='request').length,0);
 await connection.disconnect();await assert.rejects(provider.request({method:'eth_accounts'}),/SESSION_EXPIRED/);
});
test('address factory cannot override the official origin or permission profile',()=>{
 for(const extra of [{origin:'https://social.ynxweb4.com'},{methods:['personal_sign']},{methods:[]},{projectId:'other'}])assert.throws(()=>implementation.createWalletAddressConnection(extra),/CONFIGURATION_INVALID/);
});
test('address restore never adopts widened methods, wrong chain/peer, expired or ambiguous session',async()=>{
 for(const methods of [['eth_accounts'],['personal_sign'],['ynx_requestProductSessionV2']]){const f=fixture([session(methods)]);assert.equal(await implementation.createWalletAddressConnection(f.options).restore(),null);assert.equal(f.calls.length,1);}
 for(const alter of [s=>s.expiry=1,s=>s.peer.metadata.url='https://attacker.example',s=>s.namespaces.eip155.accounts=[`eip155:1:${account}`]]){const s=session();alter(s);const f=fixture([s]);assert.equal(await implementation.createWalletAddressConnection(f.options).restore(),null);}
 const f=fixture([session()]),connection=implementation.createWalletAddressConnection(f.options),provider=await connection.restore();assert.deepEqual(await provider.request({method:'eth_accounts'}),[account]);assert.equal(f.calls.length,1);
 const multiple=fixture([session(),{...session(),topic:'b'.repeat(64)}]);await assert.rejects(implementation.createWalletAddressConnection(multiple.options).restore(),/SELECTION_REQUIRED/);
});
test('widened approval is retired through original client and cleanup failure stays unconfirmed',async()=>{
 const f=fixture(),connection=implementation.createWalletAddressConnection(f.options),notices=[];connection.on('cancelUnconfirmed',value=>notices.push(value));f.client.disconnect=async()=>{throw Error('offline');};
 const pending=connection.connect();await tick();f.approve(session(['ynx_requestProductSessionV2']));await assert.rejects(pending,/NAMESPACE_INVALID/);assert.equal(notices.length,1);assert.equal(notices[0].reason,'transport-unavailable');await assert.rejects(connection.provider().request({method:'eth_accounts'}),/SESSION_EXPIRED/);
});
test('address cancel fences late approval and never retries or grants an account',async()=>{
 const f=fixture(),connection=implementation.createWalletAddressConnection(f.options),connected=[];connection.on('connect',e=>connected.push(e));
 const pending=connection.connect(),rejected=assert.rejects(pending,/CANCELLED/);await tick();await connection.cancel();await rejected;f.approve(session());await tick();assert.equal(connected.length,0);assert.equal(f.calls.filter(([name])=>name==='connect').length,1);assert.equal(f.calls.filter(([name])=>name==='disconnect').length,1);await assert.rejects(connection.provider().request({method:'eth_accounts'}),/SESSION_EXPIRED/);
});
test('address session events revoke local reads and forbid privilege expansion on update',async()=>{
 for(const mode of ['account','chain','update','delete']){
 const f=fixture([session()]),connection=implementation.createWalletAddressConnection(f.options),provider=await connection.restore();
 if(mode==='account')f.events.get('session_event')({topic,params:{event:{name:'accountsChanged',data:[]}}});
 if(mode==='chain')f.events.get('session_event')({topic,params:{event:{name:'chainChanged',data:1}}});
 if(mode==='update')f.events.get('session_update')({topic,params:{namespaces:session(['personal_sign']).namespaces}});
 if(mode==='delete')f.events.get('session_delete')({topic});
 await assert.rejects(provider.request({method:'eth_accounts'}),/SESSION_EXPIRED/);assert.equal(f.calls.filter(([name])=>name==='request').length,0);
 }
});
