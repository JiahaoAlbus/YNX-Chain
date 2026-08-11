import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script=await readFile(new URL('../web/read-sources.js',import.meta.url),'utf8');

function run(readSources){
  const target={innerHTML:''};
  let baseRenderCalls=0;
  const context={
    URL,
    document:{querySelector(selector){return selector==='#read-sources'?target:null}},
    esc(value){return String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;')},
    render(){baseRenderCalls+=1},
  };
  vm.runInNewContext(script,context,{filename:'read-sources.js'});
  context.render({portfolio:{readSources}});
  return {target,baseRenderCalls};
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
  assert.match(target.innerHTML,/Kill switch clear/);
});

test('Web companion escapes Quant strategy and venue labels',()=>{
  const {target}=run({quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:true,status:{available:true},action:{configured:false},envelope:{payload:{strategies:[{name:'<img src=x onerror=alert(1)>',strategyHash:'safe'}],experiments:[],mandates:[],executions:[{id:'1',market:'<svg onload=alert(1)>',side:'buy',venueStatus:'open',venueOrderId:'<script>x</script>'}],paper:[]}}}});
  assert.doesNotMatch(target.innerHTML,/<img|<svg|<script>/);
  assert.match(target.innerHTML,/&lt;img/);
  assert.match(target.innerHTML,/&lt;svg/);
});
