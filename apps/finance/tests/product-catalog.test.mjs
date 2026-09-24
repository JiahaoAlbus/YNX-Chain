import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';

const root=join(import.meta.dirname,'..','web');
const html=readFileSync(join(root,'index.html'),'utf8');
const script=readFileSync(join(root,'product-catalog.js'),'utf8');
const localeScript=readFileSync(join(root,'finance-locale.js'),'utf8');

test('guest Finance exposes four separated product channels without account access',()=>{
  assert.match(html,/id="markets"/);
  assert.match(html,/id="product-channels"/);
  assert.match(html,/Browse the official Broker Sandbox without an account/);
  assert.match(script,/finance-product-catalog-v1/);
  assert.match(script,/never-merge-balances-cost-basis-pnl-or-performance-across-channels/);
  assert.doesNotMatch(script,/eth_requestAccounts|personal_sign|eth_sendTransaction|ynxwallet:/);
});

test('catalog failure remains truthful and never fabricates balances',()=>{
  assert.match(localeScript,/will not merge or infer product balances/);
  assert.match(localeScript,/No enabled capabilities/);
  assert.doesNotMatch(script,/mock|demo balance|sample profit/i);
});

test('guest catalog and its risk text switch language without requesting an account',async()=>{
  const target={innerHTML:''},selector={value:'en',addEventListener(){}};
  const handlers=new Map(),storage=new Map();
  const document={readyState:'complete',documentElement:{lang:'en'},querySelector:s=>s==='#product-channels'?target:s==='#finance-language'?selector:null,querySelectorAll:()=>[],addEventListener:(name,handler)=>handlers.set(name,handler),dispatchEvent:event=>handlers.get(event.type)?.(event)};
  const catalog={schemaVersion:'finance-product-catalog-v1',aggregationPolicy:'never-merge-balances-cost-basis-pnl-or-performance-across-channels',channels:[
    {id:'ynxt-indexed',label:'YNXT indexed portfolio',environment:'YNX Chain public testnet',availability:'source-dependent',riskNotice:'Indexed testnet records are not fiat, a bank balance, or a mainnet asset.',unit:'YNXT',settlement:'indexed-chain-evidence',custody:'none',capabilities:[]},
    {id:'ynx-evm-test',label:'YNX on-chain test markets',environment:'chain 6423 test market',availability:'owner-source-dependent',riskNotice:'Only verified test assets and supported bounded contracts qualify; no mainnet BTC or generic EVM capability is implied.',unit:'verified-test-assets',settlement:'owner-product-testnet',custody:'owner-product-contract',capabilities:[],testMarket:{chainId:6423,sourceCommit:'6663df43e2f973a90a591cc88fc120a540df7f4a',dryRunManifestSha256:'efd4d0c8f372a6a5c94a8687c17321b02144c4b812602a5e672252469a585802',testOnly:true,deploymentVerified:false,chainSubmissionEnabled:false,publicAddresses:null,assets:['TEST-AAPL','tUSD'],settlementContract:'TestDvP'}},
    {id:'broker-sandbox',label:'Official broker sandbox',environment:'provider sandbox',availability:'credential-and-provider-dependent',riskNotice:'Simulated cash and shares are not real funds, securities ownership, or chain assets.',unit:'simulated-USD-and-shares',settlement:'provider-sandbox',custody:'provider-sandbox-only',capabilities:[]},
    {id:'future-live',label:'Future live and mainnet products',environment:'not enabled',availability:'disabled',riskNotice:'No live brokerage, mainnet custody, lending, yield, or investment product is available.',unit:'none',settlement:'disabled',custody:'none',capabilities:[]},
  ]};
  let fetchCount=0;
  const context={document,window:{},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},fetch:async()=>{fetchCount++;return{ok:true,json:async()=>catalog}}};
  runInNewContext(localeScript,context);
  runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(target.innerHTML,/Indexed testnet records are not fiat/);
  assert.match(target.innerHTML,/data-chain-submission="disabled"/);
  assert.match(target.innerHTML,/id="test-market-draft"/);
  assert.match(target.innerHTML,/No public 6423 deployment, balance or chain submission is verified/);
  assert.equal(context.window.YNXFinanceLocale.set('zh-CN'),true);
  assert.equal(document.documentElement.lang,'zh-CN');
  assert.equal(storage.get('ynx-finance-locale'),'zh-CN');
  assert.match(target.innerHTML,/索引的测试网记录不是法币/);
  assert.match(target.innerHTML,/模拟现金与股份不是真实资金/);
  assert.match(target.innerHTML,/未验证公共 6423 部署、余额或链上提交/);
  assert.equal(fetchCount,1);
  const draftResult={textContent:''},draftForm={id:'test-market-draft',elements:{quantity:{value:'1.250000'},limitPrice:{value:'2.5'}},querySelector:()=>draftResult};
  handlers.get('submit')({target:draftForm,preventDefault(){}});
  assert.match(draftResult.textContent,/1.250000 TEST-AAPL @ 2.5 tUSD/);
  assert.match(draftResult.textContent,/行情、费用、授权额度、对手方/);
  draftForm.elements.quantity.value='1e9';handlers.get('submit')({target:draftForm,preventDefault(){}});
  assert.match(draftResult.textContent,/没有创建订单/);
  catalog.channels[1].testMarket.sourceCommit='unreviewed';
  context.window.YNXFinanceLocale.set('en');
  assert.doesNotMatch(target.innerHTML,/id="test-market-draft"/);
  catalog.channels[1].testMarket.sourceCommit='6663df43e2f973a90a591cc88fc120a540df7f4a';
  catalog.channels[2].riskNotice='Provider changed the risk terms.';
  context.window.YNXFinanceLocale.set('zh-CN');
  assert.match(target.innerHTML,/Provider changed the risk terms/);
  assert.doesNotMatch(target.innerHTML,/模拟现金与股份不是真实资金/);
  assert.equal(context.window.YNXFinanceLocale.set('untranslated'),false);
});
