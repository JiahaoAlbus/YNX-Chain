import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script=await readFile(new URL('../web/read-sources.js',import.meta.url),'utf8');

function run(readSources){
  const target={innerHTML:''};
  let baseRenderCalls=0,locale='en';const handlers=new Map();
  const context={
    URL,
    window:{YNXFinanceLocale:{get:()=>locale}},
    document:{querySelector(selector){return selector==='#read-sources'?target:null},addEventListener(name,handler){handlers.set(name,handler)}},
    esc(value){return String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;')},
    render(){baseRenderCalls+=1},
  };
  vm.runInNewContext(script,context,{filename:'read-sources.js'});
  context.render({portfolio:{readSources}});
  return {target,baseRenderCalls,setLocale(value){locale=value;handlers.get('finance:localechange')?.()}};
}

test('Web companion renders pending owner sources without invented facts',()=>{
  const {target,baseRenderCalls}=run({exchange:{id:'exchange',name:'YNX Exchange',owner:'07-exchange',ownerContractAccepted:false,capability:'Authorized evidence only',status:{available:false,syncStatus:'owner-contract-pending',error:'No owner-frozen read-only contract has been accepted by Finance'},action:{configured:false,label:'Open YNX Exchange'}}});
  assert.equal(baseRenderCalls,1);
  assert.match(target.innerHTML,/YNX Exchange/);
  assert.match(target.innerHTML,/UNAVAILABLE/);
  assert.match(target.innerHTML,/owner-contract-pending/);
  assert.match(target.innerHTML,/Owner action link not configured/);
  assert.doesNotMatch(target.innerHTML,/href=/);
});

test('Web companion exposes reviewed HTTPS actions only',()=>{
  const unsafe=run({quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:false,status:{available:false,syncStatus:'owner-contract-pending'},action:{configured:true,url:'javascript:alert(1)',label:'Open Quant'}}});
  assert.doesNotMatch(unsafe.target.innerHTML,/href=/);

  const reviewed=run({quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:false,status:{available:false,syncStatus:'owner-contract-pending'},action:{configured:true,url:'https://quant.ynx.example/strategies',label:'Open Quant'}}});
  assert.match(reviewed.target.innerHTML,/href="https:\/\/quant\.ynx\.example\/strategies"/);
  assert.match(reviewed.target.innerHTML,/noreferrer noopener/);
});

test('Web companion renders real bound Exchange evidence without inventing values',()=>{
  const {target}=run({exchange:{id:'exchange',name:'YNX Exchange',owner:'07-exchange',ownerContractAccepted:true,status:{available:true,syncStatus:'authoritative-persisted-exchange-state',version:'exchange-finance-read-v1'},action:{configured:true,url:'https://exchange.ynx.example',label:'Open Exchange'},envelope:{asOf:'2026-08-11T09:00:00Z',coverage:'Authorized account only',payload:{productVersion:'0.1.0-testnet',balances:[{asset:'YNXT',availableMicro:9000000,reservedMicro:1000000}],orders:[{id:'order-1',market:'YNXT-YUSD_TEST',side:'buy',status:'open',amountMicro:2000000,priceMicro:3000000}],trades:[{id:'fill-1',market:'YNXT-YUSD_TEST',side:'buy',amountMicro:1000000,priceMicro:2500000}],fees:[{amountMicro:2000}],positions:[{market:'YNXT-PERP',sizeMicro:3000000,unrealizedPnlMicro:400000,status:'open'}],funding:[{id:'funding-1'}]}}}});
  assert.match(target.innerHTML,/Live Exchange account evidence/);
  assert.match(target.innerHTML,/9 YNXT/);
  assert.match(target.innerHTML,/1 open · 1 fills/);
  assert.match(target.innerHTML,/YNXT-PERP/);
  assert.match(target.innerHTML,/1 funding records/);
  assert.doesNotMatch(target.innerHTML,/UNAVAILABLE/);
});

test('Web companion keeps large micro amounts exact and missing balances unknown',()=>{
  const {target}=run({exchange:{id:'exchange',ownerContractAccepted:true,status:{available:true},action:{configured:false},envelope:{payload:{balances:[{asset:'YNXT',availableMicro:'9007199254740993',reservedMicro:null}],orders:[],trades:[],fees:[{amountMicro:'9007199254740993'}],positions:[],funding:[],equityMicro:null,freeCollateralMicro:null}}}});
  assert.match(target.innerHTML,/9,007,199,254\.740993 YNXT/);
  assert.match(target.innerHTML,/9,007,199,254\.740993 YUSD_TEST recorded fees/);
  assert.match(target.innerHTML,/— reserved/);
  assert.match(target.innerHTML,/Margin equity<\/small><strong>—/);
  assert.doesNotMatch(target.innerHTML,/9,007,199,254\.740992|0 YUSD_TEST free/);
});

test('Web companion escapes owner payload labels',()=>{
  const {target}=run({exchange:{id:'exchange',name:'YNX Exchange',owner:'07-exchange',ownerContractAccepted:true,status:{available:true},action:{configured:false},envelope:{payload:{balances:[{asset:'<img src=x onerror=alert(1)>',availableMicro:1,reservedMicro:0}],orders:[],trades:[],fees:[],positions:[],funding:[]}}}});
  assert.doesNotMatch(target.innerHTML,/<img/);
  assert.match(target.innerHTML,/&lt;img/);
});

test('Web companion renders account-bound Quant lifecycle, PnL, execution, and risk evidence',()=>{
  const {target}=run({quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:true,status:{available:true,syncStatus:'authoritative-persisted-quant-state'},action:{configured:true,url:'https://quant.ynx.example',label:'Open Quant'},envelope:{asOf:'2026-08-11T09:00:00Z',coverage:'Authorized Quant account only',payload:{productVersion:'0.1.0-testnet',strategies:[{id:'alpha-1',name:'Market neutral',family:'spread',stage:'bounded_testnet',strategyHash:'abcdef1234567890'}],experiments:[{id:'experiment-1',metrics:{maxDrawdownBps:250},attribution:{userNetPnl:2400000,userRealizedPnl:1800000}}],mandates:[{digest:'mandate-1',market:'YNXT-YUSD_TEST',maxNotional:10000000,maxDailyLoss:1000000,maxSlippageBps:50,maxLeverageBps:20000,expiresAt:'2099-08-11T09:00:00Z',revoked:false}],executions:[{id:'testnet-1',market:'YNXT-YUSD_TEST',side:'buy',amount:2000000,price:3000000,venueStatus:'filled',venueOrderId:'exchange-order-1'}],paper:[{killSwitch:false}]}}}});
  assert.match(target.innerHTML,/Live Quant account evidence/);
  assert.match(target.innerHTML,/1 strategies · 1 active mandates/);
  assert.match(target.innerHTML,/2\.4 YUSD_TEST/);
  assert.match(target.innerHTML,/1 submitted · 1 filled/);
  assert.match(target.innerHTML,/Market neutral/);
  assert.match(target.innerHTML,/exchange-order-1/);
  assert.match(target.innerHTML,/slippage 0\.5%/);
  assert.match(target.innerHTML,/leverage 2×/);
  assert.doesNotMatch(target.innerHTML,/leverage 200%/);
  assert.match(target.innerHTML,/Kill switch clear/);
});

test('Exchange and Quant evidence status follows Finance language without refetch or invented balances',()=>{
  const source={quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:true,status:{available:true,syncStatus:'authoritative-persisted-quant-state'},action:{configured:false},envelope:{payload:{strategies:[],experiments:[],mandates:[{market:'YNXT-YUSD_TEST',maxNotional:'1000000',maxDailyLoss:'100000',maxSlippageBps:50,maxLeverageBps:20000,expiresAt:'2099-08-11T09:00:00Z',revoked:false}],executions:[],paper:[]}}},exchange:{id:'exchange',name:'YNX Exchange',owner:'07-exchange',ownerContractAccepted:true,status:{available:false,syncStatus:'owner-endpoint-unavailable',error:'raw upstream failure'},action:{configured:false}}};
  const result=run(source);
  assert.match(result.target.innerHTML,/EVIDENCE AVAILABLE/);
  assert.match(result.target.innerHTML,/Owner endpoint unavailable/);
  assert.doesNotMatch(result.target.innerHTML,/raw upstream failure/);
  result.setLocale('zh-CN');
  assert.match(result.target.innerHTML,/证据可用/);
  assert.match(result.target.innerHTML,/产品方端点不可用；不填入替代数据/);
  assert.match(result.target.innerHTML,/杠杆 2×/);
  assert.doesNotMatch(result.target.innerHTML,/raw upstream failure|杠杆 200%/);
  assert.equal(result.baseRenderCalls,1);
});

test('Web companion never sums independent research experiments or invents absent PnL',()=>{
  const {target}=run({quant:{id:'quant',ownerContractAccepted:true,status:{available:true},action:{configured:false},envelope:{payload:{strategies:[],experiments:[{attribution:{userNetPnl:2400000,userRealizedPnl:1800000}},{attribution:{userNetPnl:4200000,userRealizedPnl:4100000}}],mandates:[],executions:[],paper:[]}}}});
  assert.match(target.innerHTML,/First returned research PnL/);
  assert.match(target.innerHTML,/2\.4 YUSD_TEST/);
  assert.doesNotMatch(target.innerHTML,/6\.6 YUSD_TEST/);
  const missing=run({quant:{id:'quant',ownerContractAccepted:true,status:{available:true},action:{configured:false},envelope:{payload:{strategies:[],experiments:[],mandates:[],executions:[],paper:[]}}}});
  assert.match(missing.target.innerHTML,/First returned research PnL<\/small><strong>—/);
  assert.doesNotMatch(missing.target.innerHTML,/0 YUSD_TEST realized/);
});

test('Web companion escapes Quant strategy and venue labels',()=>{
  const {target}=run({quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:true,status:{available:true},action:{configured:false},envelope:{payload:{strategies:[{name:'<img src=x onerror=alert(1)>',strategyHash:'safe'}],experiments:[],mandates:[],executions:[{id:'1',market:'<svg onload=alert(1)>',side:'buy',venueStatus:'open',venueOrderId:'<script>x</script>'}],paper:[]}}}});
  assert.doesNotMatch(target.innerHTML,/<img|<svg|<script>/);
  assert.match(target.innerHTML,/&lt;img/);
  assert.match(target.innerHTML,/&lt;svg/);
});
