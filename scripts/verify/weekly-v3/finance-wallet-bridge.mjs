// Integration-only adapter: executes the exact Finance browser assets and Wallet
// controller. Authority, browser DOM/storage, time and synthetic key are fixtures.
// No remote request or real account is used. Product source is never patched.
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';

const input=JSON.parse(fs.readFileSync(0,'utf8'));
const finance=process.env.WEEKLY_FINANCE_ROOT, wallet=process.env.WEEKLY_WALLET_ROOT;
if(!finance||!wallet)throw new Error('Exact checkpoint paths required');
const values=new Map(), elements=new Map();
const element=selector=>{
  if(!elements.has(selector))elements.set(selector,{textContent:'',innerHTML:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},handlers:{},addEventListener(type,handler){this.handlers[type]=handler},append(){},elements:{}});
  return elements.get(selector);
};
const requested=[],httpResults=[];
const context=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,Date,console,crypto:webcrypto,
  AbortController,AbortSignal,FormData:class{constructor(form){this.form=form}get(key){return this.form.elements[key]?.value??null}},Intl,Map,Set,
  setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},
  document:{querySelector:element,querySelectorAll:()=>[],createElement:element,body:element('body')},
  location:{pathname:'/',hash:'',search:'',href:'https://finance.ynxweb4.com/'},
  history:{replaceState(){}},
  localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
  window:{addEventListener(){},confirm:()=>input.confirm===true,YNXFinanceWallet:{ready:new Promise(()=>{}),getRevision:()=>0,requireProof:async scope=>{requested.push(scope);return{proofHeader:scope,requestId:'local-scope-fixture'}}}},
  fetch:async (url,options={})=>{
    if(url==='/api/broker/status')return new Response(JSON.stringify({schema:'ynx-finance-broker-status-v1',status:{tradingEnvironment:'sandbox',chainEnvironment:'testnet',enabled:false,submissionEnabled:false}}),{headers:{'content-type':'application/json'}});
    const base=new URL(input.base);
    if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw new Error('Only explicit loopback fixture allowed');
    const response=await fetch(new URL(url,base),{...options,headers:{...options.headers,Origin:'https://finance.ynxweb4.com'}});
    httpResults.push({path:url,status:response.status,body:await response.clone().text()});
    // Browser Response.json creates objects in the page's realm. A Node fetch
    // result must cross that realm as wire JSON, not as a host-prototype object.
    return {ok:response.ok,status:response.status,headers:response.headers,
      json:async()=>{context.responseJSON=await response.text();return vm.runInContext('JSON.parse(responseJSON)',context)},
      text:()=>response.text(),blob:()=>response.blob()};
  }
});
async function walletDecision(challenge,route,mode){
  const sdk=await import(pathToFileURL(`${wallet}/packages/wallet-auth/src/index.js`).href);
  const {FinanceOrderApprovalController}=await import(pathToFileURL(`${wallet}/apps/wallet/src/protocol/financeOrderApprovalController.ts`).href);
  const vector=JSON.parse(fs.readFileSync(`${wallet}/packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json`,'utf8')).positive;
  const secret=vector.testOnlyPublicSecretScalarHex;
  const now=new Date(challenge.serverTime), account={...sdk.walletIdentity(secret),label:'Public synthetic integration key',backupConfirmed:true,createdAt:now.toISOString()};
  const journal=new Map(), urls=[];let keys=0,failOpen=mode==='revoke';
  const controller=new FinanceOrderApprovalController({
    storage:{async getItem(k){return journal.get(k)??null},async setItem(k,v){journal.set(k,v)},async deleteItem(){throw new Error('Journal deletion forbidden')}},
    selectedAccount:()=>account,currentTime:async assertCurrent=>{assertCurrent();return now},
    withAccountSecret:async(id,assertCurrent,use)=>{if(id!==account.account)throw new Error('Wrong synthetic account');assertCurrent();keys++;return use(secret,assertCurrent)},
    openURL:async url=>{urls.push(url);if(failOpen)throw new Error('Isolated callback delivery failure')}
  });
  const review=await controller.receive(route);
  if(mode==='reject')await controller.reject(review.id);
  else if(mode==='revoke'){
    try{await controller.approve(review.id)}catch(error){if(error.message!=='Isolated callback delivery failure')throw error}
    failOpen=false;await controller.revokeUnused(review.id);
  }else await controller.approve(review.id);
  return {urls,keys,now};
}
if(input.mode==='api'||input.mode==='draft'||input.mode==='full'||input.mode==='workspace'){
  vm.runInContext(fs.readFileSync(`${finance}/apps/finance/web/order-wallet.js`,'utf8'),context);
  vm.runInContext(fs.readFileSync(`${finance}/apps/finance/web/app.js`,'utf8'),context);
  context.testInput=input;
  if(input.mode==='workspace'){
    vm.runInContext('state.connected=true',context);
    await vm.runInContext('refreshBrokerWorkspace()',context);
    if(input.action==='cancel')await vm.runInContext('requestBrokerCancel(testInput.orderId)',context);
    else if(input.action==='reconcile')await vm.runInContext('reconcileBroker()',context);
    else if(input.action!=='read')throw new Error('Unknown workspace fixture action');
    process.stdout.write(JSON.stringify({requested,httpResults,notice:element('#notice').textContent,orders:element('#broker-local-orders').innerHTML,watchlist:element('#broker-watchlist').innerHTML}));
    process.exit(0);
  }
  if(input.mode==='draft'||input.mode==='full'){
    const form=element('#broker-order-form');
    for(const key of ['accountPublicKey','assetId','symbol','side','qty','limitPrice'])form.elements[key]={value:input.body[key]??input.body.draft[key]??''};
    if(input.source==='ai'){
      vm.runInContext('state.aiJob=testInput.aiJob||{id:"local-ai-fixture",result:{orderDraft:testInput.body.draft}}',context);
      await element('#ai-actions').handlers.click({target:{dataset:{ai:'use-order'}}});
      if(requested.length||httpResults.length)throw new Error('AI copy unexpectedly requested private authority or order API');
    }
    // Follow the actual new search/select UI; never inject selected-asset state
    // to bypass provider-backed selection. Server and adapter are real; only
    // the provider socket and public asset data are loopback fixtures.
    if(input.mode==='full')vm.runInContext('state.connected=true',context);
    element('#broker-asset-search').elements.query={value:input.body.draft.symbol};
    await element('#broker-asset-search').handlers.submit({preventDefault(){}});
    const search=httpResults.find(item=>item.path.startsWith('/api/broker/assets?')&&item.status===200);
    const selected=search&&JSON.parse(search.body).assets.find(asset=>asset.id===input.body.draft.assetId&&asset.symbol===input.body.draft.symbol);
    if(!selected||!element('#broker-asset-results').innerHTML.includes(`data-broker-select="${selected.id}"`))throw new Error('Actual provider-backed asset search did not render the selected asset');
    await element('#broker-asset-results').handlers.click({target:{dataset:{brokerSelect:selected.id}}});
    if(input.mode==='full'){
      await element('#broker-asset-results').handlers.click({target:{dataset:{brokerWatch:selected.id}}});
      await vm.runInContext('refreshBrokerQuote()',context);
      await vm.runInContext('refreshBrokerSnapshot()',context);
      const watched=httpResults.find(item=>item.path==='/api/broker/watchlist'&&item.status===200);
      if(!watched||!element('#broker-watchlist').innerHTML.includes(selected.symbol))throw new Error('Real owner-scoped watchlist update/render failed');
    }
    context.draftForm=form;
    await vm.runInContext('createBrokerApproval({preventDefault(){},currentTarget:draftForm})',context);
    if(input.mode==='full'&&element('#broker-wallet-approve').href){
      const created=httpResults.find(item=>item.path==='/api/broker/challenges'&&item.status===201);
      const decision=await walletDecision(JSON.parse(created.body).challenge,element('#broker-wallet-approve').href,input.decision);
      const callbackURL=new URL(decision.urls.at(-1));
      Object.assign(context.location,{pathname:callbackURL.pathname,search:callbackURL.search,href:callbackURL.href});
      vm.runInContext('state.connected=true',context);
      await vm.runInContext('completeBrokerCallback()',context);
      process.stdout.write(JSON.stringify({requested,httpResults,keys:decision.keys,notice:element('#notice').textContent,pending:context.window.YNXFinanceOrderWallet.pending()}));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify({requested,httpResults,url:element('#broker-wallet-approve').href??null,notice:element('#notice').textContent,form:Object.fromEntries(Object.entries(form.elements).map(([k,v])=>[k,v.value]))}));
    process.exit(0);
  }
  try{const response=await vm.runInContext('api(testInput.path,{method:"POST",body:JSON.stringify(testInput.body)})',context);process.stdout.write(JSON.stringify({requested,response}));}
  catch(error){process.stdout.write(JSON.stringify({requested,error:error.message,status:error.status}));}
}else{
  vm.runInContext(fs.readFileSync(`${finance}/apps/finance/web/order-wallet.js`,'utf8'),context);
  const api=context.window.YNXFinanceOrderWallet;
  context.challengeJSON=JSON.stringify(input.challenge);
  context.authorityDateAdapter=input.authorityDateAdapter===true;
  let request;
  try{request=await vm.runInContext('(()=>{const c=JSON.parse(challengeJSON);return window.YNXFinanceOrderWallet.begin(c.unsigned,authorityDateAdapter?new Date(c.serverTime):c.serverTime)})()',context)}
  catch(error){process.stdout.write(JSON.stringify({beginError:error.message,code:error.code,keys:0,callbackCount:0,requested,httpResults,pending:api.pending()}));process.exit(0)}
  const {urls,keys,now}=await walletDecision(input.challenge,request.url,input.mode);
  let raw=null,parseError=null;
  try{raw=await api.parseReturn(urls.at(-1),input.authorityDateAdapter?now:input.challenge.serverTime)}catch(error){parseError=error.message}
  // Keep raw transport available for backend-only continuation when the browser
  // bridge is broken. The caller must never count that continuation as full E2E.
  const encoded=new URL(urls.at(-1)).searchParams.get('financeOrderApprovalResult');
  const decoded=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
  process.stdout.write(JSON.stringify({raw,parseError,decoded,keys,callbackCount:urls.length}));
}
