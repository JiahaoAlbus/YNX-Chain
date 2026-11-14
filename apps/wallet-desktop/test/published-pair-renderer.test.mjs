import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {ApprovalReviewQueue} from "../src/approval-review-queue.mjs";
import {SESSION_COPY} from "../src/wallet-locale-sessions.mjs";

test("Relay waiting copy exists for every existing Wallet session locale",()=>{
  assert.equal(Object.keys(SESSION_COPY).length,12);
  for(const copy of Object.values(SESSION_COPY))for(const key of ["WalletConnect not started","The Relay connection is not yet confirmed. Your wallet and accounts remain accessible.","Pairing request submitted. Waiting for a connection proposal; you can cancel this attempt.","WalletConnect status could not be confirmed. Refresh the connection status before trying again."]){
    assert.equal(typeof copy[key],"string");assert.ok(copy[key].length>0);
  }
  assert.match(SESSION_COPY["zh-Hans"]["The Relay connection is not yet confirmed. Your wallet and accounts remain accessible."],/尚未确认/);
});

test("normal connection title and detail distinguish Relay proof from startup failure",async()=>{
  const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
  const start=source.indexOf("function renderWalletConnect(payload)");
  const render=payload=>{
    const context={pairCancel:{},pairButton:{},walletConnectTitle:{},walletConnectDetail:{},copyUI:(node,text)=>{node.textContent=text},payload};
    runInNewContext(source.slice(start,source.indexOf("async function refreshWalletConnectSessions",start))+"\nrenderWalletConnect(payload)",context);
    return context;
  };
  const waiting="The Relay connection is not yet confirmed. Reopen Connections to check its status; existing sessions may still be active.";
  const unavailable="The connection service is unavailable. Your wallet and accounts remain accessible.";
  const cases=[
    [{configured:true,started:true,relayConnected:false,code:"WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED"},"Connecting to WalletConnect…",waiting,true],
    [{configured:true,started:false,relayConnected:false,code:"WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED"},"WalletConnect not started",waiting,true],
    [{configured:true,started:true,relayConnected:true,code:null},"Ready to connect an app","0 connected apps. You review every signature and transaction.",false],
    [{configured:true,started:false,relayConnected:false,code:"WALLETCONNECT_START_FAILED"},"WalletConnect unavailable",unavailable,true],
    [{configured:true,started:true,relayConnected:true,code:"WALLETCONNECT_REVIEW_WRITE_UNCONFIRMED"},"WalletConnect unavailable",unavailable,true],
    [{configured:false,started:false,relayConnected:false,code:"WALLETCONNECT_PROJECT_ID_UNAVAILABLE"},"Cross-device connections are coming","WalletConnect is not enabled in this build. You can still connect directly from supported YNX apps.",true]
  ];
  for(const [state,title,detail,disabled] of cases)for(const wrapped of [false,true]){
    const value={...state,activeSessionCount:0,pairing:false,pair:{phase:"idle"}},h=render(wrapped?{ok:true,value}:value);
    assert.equal(h.walletConnectTitle.textContent,title);assert.equal(h.walletConnectDetail.textContent,detail);
    assert.equal(h.pairButton.disabled,disabled);assert.equal(h.pairCancel.hidden,true);
  }
});

test("normal connection renderer keeps cancellation available while pairing and shows terminal fresh-QR guidance",async()=>{
  const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
  const start=source.indexOf("function renderWalletConnect(payload)");
  for(const phase of ["pairing","submitted","proposal-received","canceled","timed-out","failed"]){
    const pairCancel={},pairButton={},walletConnectTitle={},walletConnectDetail={};
    runInNewContext(source.slice(start,source.indexOf("async function refreshWalletConnectSessions",start))+"\nrenderWalletConnect(status)",{
      pairCancel,pairButton,walletConnectTitle,walletConnectDetail,
      copyUI:(node,text)=>{node.textContent=text},status:{configured:true,started:true,relayConnected:true,activeSessionCount:0,pairing:phase==="pairing",pair:{phase}},
    });
    assert.equal(pairCancel.hidden,!["pairing","submitted"].includes(phase));assert.equal(pairButton.disabled,["pairing","submitted"].includes(phase));
    if(phase==="submitted")assert.match(walletConnectDetail.textContent,/Waiting for a connection proposal/);
    if(["canceled","timed-out","failed"].includes(phase))assert.match(walletConnectDetail.textContent,/fresh QR/);
    if(phase==="proposal-received")assert.match(walletConnectDetail.textContent,/Review before approving/);
  }
});

test("blur preserves an unexpired public review without resuming or reusing an in-flight key decision",()=>{
  let now=1000;const queue=new ApprovalReviewQueue({now:()=>now});
  queue.enqueue("provider",{id:"original",expiresAt:new Date(2000).toISOString()});
  const original=queue.current;queue.suspend();assert.equal(queue.current,original);
  assert.equal(queue.begin(original.key),original);queue.suspend();assert.equal(queue.begin(original.key),null);
  queue.finish(original.key);assert.equal(queue.current,null);
  queue.enqueue("provider",{id:"expires",expiresAt:new Date(2000).toISOString()});now=2000;queue.suspend();assert.equal(queue.current,null);
});
test('actual transport submitted state stays cancelable without claiming a proposal',async()=>{
  const {WalletConnectTransport}=await import('../src/walletconnect-transport.mjs');
  const now=2000000000000,topic='c'.repeat(64),uri=`wc:${topic}@2?relay-protocol=irn&symKey=${'d'.repeat(64)}&expiryTimestamp=${now/1000+300}`;
  const handlers=new Map(),active={},calls=[];
  const kit={core:{relayer:{connected:true},pairing:{getPairings:()=>[],disconnect:async()=>calls.push('disconnect-pair')}},on:(name,fn)=>handlers.set(name,fn),pair:async()=>({topic}),getActiveSessions:()=>active,getPendingSessionProposals:()=>[],getPendingSessionRequests:()=>[]};
  const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),start=source.indexOf('function renderWalletConnect(payload)'),end=source.indexOf('async function refreshWalletConnectSessions',start);
  const ui={pairCancel:{},pairButton:{},walletConnectTitle:{},walletConnectDetail:{},copyUI:(node,text)=>{node.textContent=text}};
  const render=status=>runInNewContext(source.slice(start,end)+'\nrenderWalletConnect(status)',{...ui,status});
  const transport=new WalletConnectTransport({projectId:'synthetic',metadata:{name:'Synthetic',url:'https://example.org'},walletKitFactory:async()=>kit,clock:()=>now});
  await transport.start({onPairState:render});await transport.pair(uri);const status=transport.status();
  assert.equal(status.pairing,false);assert.equal(status.pair.phase,'submitted');assert.equal(ui.pairCancel.hidden,false);assert.equal(ui.pairButton.disabled,true);assert.doesNotMatch(ui.walletConnectDetail.textContent,/proposal received/i);
  active['already-approved']={topic:'already-approved',pairingTopic:topic};transport.cancelPair();await new Promise(resolve=>setImmediate(resolve));assert.equal(active['already-approved'].topic,'already-approved');assert.deepEqual(calls,[]);
});
test('actual Main IPC and renderer keep submitted distinct from proposal and cancel the same pending attempt',async()=>{
 const {WalletConnectTransport}=await import('../src/walletconnect-transport.mjs');
 const now=2000000000000,topic='e'.repeat(64),uri=`wc:${topic}@2?relay-protocol=irn&symKey=${'f'.repeat(64)}&expiryTimestamp=${now/1000+300}`;
 const kitHandlers=new Map(),relayHandlers=[],active={},calls=[],kit={core:{relayer:{connected:false,on:(_name,fn)=>relayHandlers.push(fn)},pairing:{getPairings:()=>[],disconnect:async()=>calls.push('disconnect-pair')}},on:(name,fn)=>kitHandlers.set(name,fn),pair:async()=>{calls.push('pair');return {topic}},getActiveSessions:()=>active,getPendingSessionProposals:()=>[],getPendingSessionRequests:()=>[]};
 const transport=new WalletConnectTransport({projectId:'synthetic',metadata:{name:'Synthetic',url:'https://example.org'},walletKitFactory:async()=>kit,clock:()=>now});
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),first=main.indexOf('async function safeIPC('),last=main.indexOf('function safeErrorClass(',first),routes=new Map();
 const registration=main.split('\n').filter(line=>/^handleWalletIPC\("wallet:walletconnect-(pair|cancel-pair|status)"/.test(line));assert.equal(registration.length,3);
 runInNewContext(main.slice(first,last)+'\n'+registration.join('\n'),{walletConnect:transport,handleWalletIPC:(name,fn)=>routes.set(name,fn)});
 const invoke=(name,...args)=>routes.get('wallet:walletconnect-'+name)({},...args);
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8');const node=()=>({disabled:false,hidden:false,textContent:'',listeners:{},addEventListener(event,handler){this.listeners[event]=handler}});
 const pairButton=node(),pairCancel=node(),walletConnectDetail=node(),walletConnectTitle=node();const context={pairButton,pairCancel,walletConnectDetail,walletConnectTitle,walletConnectURI:{value:uri},walletConnectInputRevision:0,walletConnectStatusRevision:0,walletConnectViewCurrent:()=>()=>true,copyUI:(node,text)=>node.textContent=text,errorText:()=> 'error',window:{ynxWallet:{walletConnectPair:uri=>invoke('pair',uri),walletConnectCancelPair:()=>invoke('cancel-pair'),walletConnectStatus:()=>invoke('status')}}};
 const renderStart=source.indexOf('function renderWalletConnect(payload)'),renderEnd=source.indexOf('function invalidateWalletConnectSessions()',renderStart),pairStart=source.indexOf('pairButton.addEventListener("click"'),pairEnd=source.indexOf('function invalidateWalletConnectInput()',pairStart),cancelStart=source.indexOf('pairCancel.addEventListener("click"'),cancelEnd=source.indexOf('function renderWalletConnect(payload)',cancelStart);
 runInNewContext(source.slice(renderStart,renderEnd)+'\n'+source.slice(pairStart,pairEnd)+'\n'+source.slice(cancelStart,cancelEnd),context);
 await transport.start({onPairState:status=>{context.walletConnectStatusRevision++;context.renderWalletConnect(status)}});context.renderWalletConnect(transport.status());
 assert.equal(pairButton.disabled,true);kit.core.relayer.connected=true;for(const notify of relayHandlers)notify();assert.equal(pairButton.disabled,false);assert.deepEqual(calls,[]);
 await pairButton.listeners.click();assert.equal(transport.status().pair.phase,'submitted');assert.equal(pairCancel.hidden,false);assert.equal(pairButton.disabled,true);assert.match(walletConnectDetail.textContent,/Waiting for a connection proposal/);assert.doesNotMatch(walletConnectDetail.textContent,/proposal received/i);
 active['approved']={topic:'approved',pairingTopic:topic};await pairCancel.listeners.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(transport.status().pair.phase,'canceled');assert.equal(active.approved.topic,'approved');assert.deepEqual(calls,['pair']);
});

test('late real transport proposal replaces submitted copy without approval or another pair',async()=>{
 const {WalletConnectTransport}=await import('../src/walletconnect-transport.mjs');const now=2000000000000,topic='c'.repeat(64),uri=`wc:${topic}@2?relay-protocol=irn&symKey=${'d'.repeat(64)}&expiryTimestamp=${now/1000+300}`;
 const handlers=new Map(),calls=[],kit={core:{relayer:{connected:true},pairing:{getPairings:()=>[],disconnect:async()=>{}}},on:(name,fn)=>handlers.set(name,fn),pair:async()=>{calls.push('pair')},getActiveSessions:()=>({}),getPendingSessionProposals:()=>[],getPendingSessionRequests:()=>[],rejectSession:async()=>calls.push('reject'),approveSession:async()=>calls.push('approve')};
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),start=source.indexOf('function renderWalletConnect(payload)'),end=source.indexOf('async function refreshWalletConnectSessions',start),ui={pairCancel:{},pairButton:{},walletConnectTitle:{},walletConnectDetail:{},copyUI:(node,text)=>{node.textContent=text}},render=status=>runInNewContext(source.slice(start,end)+'\nrenderWalletConnect(status)',{...ui,status});
 const visible=[],transport=new WalletConnectTransport({projectId:'synthetic',metadata:{name:'Synthetic',url:'https://wallet.example'},walletKitFactory:async()=>kit,clock:()=>now});await transport.start({onPairState:render,onSessionProposal:p=>visible.push(p.id)});await transport.pair(uri);assert.match(ui.walletConnectDetail.textContent,/Waiting for a connection proposal/);
 await handlers.get('session_proposal')({id:101,params:{id:101,pairingTopic:topic,expiryTimestamp:now/1000+600,proposer:{metadata:{name:'Synthetic DApp',url:'https://dapp.example'}},requiredNamespaces:{},optionalNamespaces:{eip155:{chains:['eip155:6423'],methods:['personal_sign'],events:[]}}}});
 assert.deepEqual(visible,[101]);assert.equal(transport.status().pair.phase,'proposal-received');assert.match(ui.walletConnectDetail.textContent,/proposal received/i);assert.deepEqual(calls,['pair']);
});
test('a failed Main status read never claims WalletConnect is disabled in this build',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),start=source.indexOf('function renderWalletConnect(payload)'),end=source.indexOf('async function refreshWalletConnectSessions',start);
 const ui={pairCancel:{hidden:false},pairButton:{disabled:false},walletConnectTitle:{textContent:'old'},walletConnectDetail:{textContent:''},copyUI:(node,text)=>{node.textContent=text},payload:{ok:false,error:{code:'READ_FAILED'}}};
 runInNewContext(source.slice(start,end)+'\nrenderWalletConnect(payload)',ui);
 assert.equal(ui.pairButton.disabled,true);assert.equal(ui.pairCancel.hidden,false);assert.match(ui.walletConnectDetail.textContent,/status could not be confirmed/i);assert.doesNotMatch(ui.walletConnectDetail.textContent,/not enabled/i);
});
test('actual relay loss and restored Connections status preserve an existing session without pairing',async()=>{
 const {WalletConnectTransport}=await import('../src/walletconnect-transport.mjs');const relayerHandlers=[],active={},calls=[];
 const kit={core:{relayer:{connected:true,on:(_event,fn)=>relayerHandlers.push(fn)},pairing:{getPairings:()=>[],disconnect:async()=>calls.push('disconnect-pair')}},on(){},pair:async()=>calls.push('pair'),disconnectSession:async()=>calls.push('disconnect-session'),getActiveSessions:()=>active,getPendingSessionProposals:()=>[],getPendingSessionRequests:()=>[]};
 const transport=new WalletConnectTransport({projectId:'synthetic',metadata:{name:'Synthetic',url:'https://wallet.example'},walletKitFactory:async()=>kit});
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),first=main.indexOf('async function safeIPC('),last=main.indexOf('function safeErrorClass(',first),routes=new Map(),registration=main.split('\n').find(line=>line.startsWith('handleWalletIPC("wallet:walletconnect-status"'));
 runInNewContext(main.slice(first,last)+'\n'+registration,{walletConnect:transport,handleWalletIPC:(name,fn)=>routes.set(name,fn)});
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),a=source.indexOf('function renderWalletConnect(payload)'),b=source.indexOf('function invalidateWalletConnectSessions()',a),c=source.indexOf('async function refreshWalletConnectConnectionView()'),d=source.indexOf('window.ynxWallet.onWalletConnectStatus',c);
 let reads=0;const ui={pairCancel:{},pairButton:{},walletConnectTitle:{},walletConnectDetail:{},walletConnectStatusRevision:0,walletConnectViewCurrent:()=>()=>true,refreshWalletConnectSessions:async()=>{},copyUI:(node,text)=>node.textContent=text,window:{ynxWallet:{walletConnectStatus:()=>{reads++;return routes.get('wallet:walletconnect-status')()}}}};
 runInNewContext(source.slice(a,b)+'\n'+source.slice(c,d),ui);
 await transport.start({onPairState:status=>{ui.walletConnectStatusRevision++;ui.renderWalletConnect(status)}});active['original']={topic:'original',pairingTopic:'public-topic'};
 ui.renderWalletConnect(transport.status());assert.equal(ui.pairButton.disabled,false);assert.match(ui.walletConnectDetail.textContent,/1 connected app/);
 kit.core.relayer.connected=false;for(const notify of relayerHandlers)notify();assert.equal(ui.pairButton.disabled,true);assert.match(ui.walletConnectDetail.textContent,/not yet confirmed/);assert.match(ui.walletConnectDetail.textContent,/Reopen Connections/);assert.equal(active.original.topic,'original');
 await ui.refreshWalletConnectConnectionView();assert.equal(reads,1);assert.equal(ui.pairButton.disabled,true);assert.equal(active.original.topic,'original');
 kit.core.relayer.connected=true;for(const notify of relayerHandlers)notify();assert.equal(ui.pairButton.disabled,false);assert.match(ui.walletConnectDetail.textContent,/1 connected app/);assert.equal(active.original.topic,'original');assert.deepEqual(calls,[]);
});
