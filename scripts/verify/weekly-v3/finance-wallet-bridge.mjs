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
  localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
  window:{addEventListener(){},YNXFinanceWallet:{ready:new Promise(()=>{}),getRevision:()=>0,requireProof:async scope=>{requested.push(scope);return{proofHeader:scope,requestId:'local-scope-fixture'}}}},
  fetch:async (url,options={})=>{
    if(url==='/api/broker/status')return new Response(JSON.stringify({schema:'ynx-finance-broker-status-v1',status:{tradingEnvironment:'sandbox',chainEnvironment:'testnet',enabled:false,submissionEnabled:false}}),{headers:{'content-type':'application/json'}});
    const base=new URL(input.base);
    if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw new Error('Only explicit loopback fixture allowed');
    const response=await fetch(new URL(url,base),{...options,headers:{...options.headers,Origin:'https://finance.ynxweb4.com'}});
    httpResults.push({path:url,status:response.status,body:await response.clone().text()});return response;
  }
});
if(input.mode==='api'||input.mode==='draft'){
  vm.runInContext(fs.readFileSync(`${finance}/apps/finance/web/order-wallet.js`,'utf8'),context);
  vm.runInContext(fs.readFileSync(`${finance}/apps/finance/web/app.js`,'utf8'),context);
  context.testInput=input;
  if(input.mode==='draft'){
    const form=element('#broker-order-form');
    for(const key of ['accountPublicKey','assetId','symbol','side','qty','limitPrice'])form.elements[key]={value:input.body[key]??input.body.draft[key]??''};
    if(input.source==='ai'){
      vm.runInContext('state.aiJob={id:"local-ai-fixture",result:{orderDraft:testInput.body.draft}}',context);
      await element('#ai-actions').handlers.click({target:{dataset:{ai:'use-order'}}});
      if(requested.length||httpResults.length)throw new Error('AI copy unexpectedly requested private authority or order API');
    }
    context.draftForm=form;
    await vm.runInContext('createBrokerApproval({preventDefault(){},currentTarget:draftForm})',context);
    process.stdout.write(JSON.stringify({requested,httpResults,url:element('#broker-wallet-approve').href??null,notice:element('#notice').textContent,form:Object.fromEntries(Object.entries(form.elements).map(([k,v])=>[k,v.value]))}));
    process.exit(0);
  }
  try{const response=await vm.runInContext('api(testInput.path,{method:"POST",body:JSON.stringify(testInput.body)})',context);process.stdout.write(JSON.stringify({requested,response}));}
  catch(error){process.stdout.write(JSON.stringify({requested,error:error.message,status:error.status}));}
}else{
  vm.runInContext(fs.readFileSync(`${finance}/apps/finance/web/order-wallet.js`,'utf8'),context);
  const api=context.window.YNXFinanceOrderWallet;
  const sdk=await import(pathToFileURL(`${wallet}/packages/wallet-auth/src/index.js`).href);
  const {FinanceOrderApprovalController}=await import(pathToFileURL(`${wallet}/apps/wallet/src/protocol/financeOrderApprovalController.ts`).href);
  const vector=JSON.parse(fs.readFileSync(`${wallet}/packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json`,'utf8')).positive;
  const secret=vector.testOnlyPublicSecretScalarHex;
  const now=new Date(input.challenge.serverTime), account={...sdk.walletIdentity(secret),label:'Public synthetic integration key',backupConfirmed:true,createdAt:now.toISOString()};
  const journal=new Map(), urls=[];let keys=0,failOpen=input.mode==='revoke';
  const controller=new FinanceOrderApprovalController({
    storage:{async getItem(k){return journal.get(k)??null},async setItem(k,v){journal.set(k,v)},async deleteItem(){throw new Error('Journal deletion forbidden')}},
    selectedAccount:()=>account,currentTime:async assertCurrent=>{assertCurrent();return now},
    withAccountSecret:async(id,assertCurrent,use)=>{if(id!==account.account)throw new Error('Wrong synthetic account');assertCurrent();keys++;return use(secret,assertCurrent)},
    openURL:async url=>{urls.push(url);if(failOpen)throw new Error('Isolated callback delivery failure')}
  });
  context.challengeJSON=JSON.stringify(input.challenge);
  context.authorityDateAdapter=input.authorityDateAdapter===true;
  let request;
  try{request=vm.runInContext('(()=>{const c=JSON.parse(challengeJSON);return window.YNXFinanceOrderWallet.begin(c.unsigned,authorityDateAdapter?new Date(c.serverTime):c.serverTime)})()',context)}
  catch(error){process.stdout.write(JSON.stringify({beginError:error.message,code:error.code}));process.exit(0)}
  const review=await controller.receive(request.url);
  if(input.mode==='reject')await controller.reject(review.id);
  else if(input.mode==='revoke'){
    try{await controller.approve(review.id)}catch(error){if(error.message!=='Isolated callback delivery failure')throw error}
    failOpen=false;await controller.revokeUnused(review.id);
  }else await controller.approve(review.id);
  let raw=null,parseError=null;
  try{raw=api.parseReturn(urls.at(-1),input.authorityDateAdapter?now:input.challenge.serverTime)}catch(error){parseError=error.message}
  // Keep raw transport available for backend-only continuation when the browser
  // bridge is broken. The caller must never count that continuation as full E2E.
  const encoded=new URL(urls.at(-1)).searchParams.get('financeOrderApprovalResult');
  const decoded=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
  process.stdout.write(JSON.stringify({raw,parseError,decoded,keys,callbackCount:urls.length}));
}
