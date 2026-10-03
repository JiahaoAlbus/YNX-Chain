// Adapted expectations from Root's retained bounded 801 independent probe; original remains untouched.
import fs from 'node:fs';import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';
const source=fs.readFileSync('apps/wallet-desktop/src/renderer.js','utf8');
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
const node=()=>({children:[],textContent:'',value:'wc:old',disabled:false,append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},addEventListener(k,f){this[k]=f},after(){}});
const copy=source.match(/^function copyUI\([^\n]+/m)[0];
const session={topic:'topic-old',name:'App',origin:'https://app.example.invalid',expiry:Math.floor(Date.now()/1000)+3600};
const ack=deferred();let event;const ctx={sessionsPanel:node(),walletConnectDetail:node(),walletConnectSessionsRevision:0,walletConnectDisconnectRevision:0,walletConnectDisconnectOwners:new Map(),walletConnectStatusRevision:0,activeAccount:'a',accountViewRevision:0,accountSecurityIntent:0,keyState:{revision:1},invalidateWalletConnectInput(){},document:{createElement:node},window:{ynxWallet:{walletConnectSessions:async()=>({ok:true,value:[session]}),walletConnectDisconnect:()=>ack.promise,onWalletConnectStatus(){},onWalletConnectSessionChanged:f=>event=f}},walletConnectInputRevision:0};
runInNewContext(copy+'\n'+source.slice(source.indexOf('function walletConnectViewCurrent()'),source.indexOf('const pairCancel'))+'\n'+source.slice(source.indexOf('function invalidateWalletConnectSessions()'),source.indexOf('void refreshWalletConnectConnectionView();')),ctx);
await ctx.refreshWalletConnectSessions();ctx.walletConnectDetail.textContent='previous status';const job=ctx.sessionsPanel.children[0].children[1].click();event({type:'disconnected',topic:session.topic});ack.resolve({ok:true,value:{topic:session.topic,disconnected:true,localPermissionRevoked:true}});await job;assert.equal(ctx.walletConnectDetail.textContent,'Session disconnected and local account permission revoked.');console.log('CLOSED: own disconnect event retires clicks while its matching complete ACK displays confirmation.');
for(const cancel of [false,true]){
 const reply=deferred(),status=deferred(),c={activeAccount:'a',accountViewRevision:0,accountSecurityIntent:0,keyState:{revision:1},walletConnectInputRevision:0,walletConnectStatusRevision:0,pairButton:node(),pairCancel:node(),walletConnectURI:node(),walletConnectTitle:node(),walletConnectDetail:node(),errorText:()=>'',document:{createElement:node},window:{ynxWallet:{walletConnectPair:()=>reply.promise,walletConnectCancelPair:()=>reply.promise,walletConnectStatus:()=>status.promise}}};
 const helper=source.slice(source.indexOf('function walletConnectViewCurrent()'),source.indexOf('const pairCancel'));
 runInNewContext(copy+'\n'+helper+'\n'+source.slice(source.indexOf('function renderWalletConnect(payload)'),source.indexOf('function invalidateWalletConnectSessions()')),c);
 const start=source.indexOf(cancel?'pairCancel.addEventListener("click"':'pairButton.addEventListener("click"');const end=source.indexOf(cancel?'function renderWalletConnect(payload)':'function invalidateWalletConnectInput()',start);runInNewContext(source.slice(start,end),c);
 const p=(cancel?c.pairCancel:c.pairButton).click();reply.resolve({ok:true});await new Promise(r=>setImmediate(r));
 c.walletConnectStatusRevision++;c.renderWalletConnect({started:true,pairing:true,pair:{phase:'pairing'}});assert.equal(c.pairButton.disabled,true);
 status.resolve({started:true,pairing:false,pair:{phase:'canceled'}});await p;
 assert.equal(c.pairButton.disabled,true);assert.match(c.walletConnectDetail.textContent,/Connecting/);console.log('CLOSED: '+(cancel?'cancel':'pair')+' stale finally status cannot overwrite a newer pairing event or enable Pair.');
}
