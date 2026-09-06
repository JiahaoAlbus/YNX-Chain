import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./web.go',import.meta.url),'utf8');
const codec=fs.readFileSync(new URL('../accountaddress/browser.js',import.meta.url),'utf8');
const take=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b)};
function context(){
 const c=vm.createContext({});vm.runInContext(codec,c);
 vm.runInContext("const language='en'; const t=k=>k; const exactTime=x=>String(x);",c);
 vm.runInContext(take('    const escapeHTML =','    const relativeTime ='),c);
 vm.runInContext(take('    const accountFields =','\tfunction detailExtra('),c);
 return c;
}
const evm='0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',native='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
test('current Explorer keeps historical/contract rows while displaying native account fields',()=>{
 const c=context();c.tx={from:evm,to:evm,amount:125,fee:1,blockNumber:7,blockHash:'0x'+'ab'.repeat(32),nonce:1,timestamp:'2026-01-01',events:[{address:evm,data:evm,topics:[evm]}]};const before=JSON.stringify(c.tx);
 const rows=JSON.parse(vm.runInContext("JSON.stringify(detailRows('transaction',tx))",c));
 assert.equal(rows.find(r=>r[0]==='from')[1],native);assert.equal(rows.find(r=>r[0]==='to')[1],native);
 assert.equal(rows.find(r=>r[0]==='events')[1],JSON.stringify(c.tx.events));assert.equal(rows.find(r=>r[0]==='hash')[1],c.tx.blockHash);assert.equal(JSON.stringify(c.tx),before);
 c.contract={address:evm,deployer:evm,sourceHash:evm,deployedBytecodeHash:evm};
 const contract=JSON.parse(vm.runInContext("JSON.stringify(detailRows('contract',contract))",c));
 assert.equal(contract.find(r=>r[0]==='address')[1],native);assert.equal(contract.find(r=>r[0]==='deployer')[1],native);assert.equal(contract.find(r=>r[0]==='sourceHash')[1],evm);assert.equal(contract.find(r=>r[0]==='bytecodeHash')[1],evm);
});
test('opaque 20-byte data and legacy accounts survive generic details unchanged',()=>{
 const c=context();c.data={from:evm,memo:evm,raw:evm,signature:evm,topics:[evm],logs:[{address:evm,data:evm,topics:[evm]}],legacy:{address:'ynx_faucet'}};
 const rows=JSON.parse(vm.runInContext('JSON.stringify(flatten(data))',c));const value=k=>rows.find(r=>r[0]===k)[1];
 assert.equal(value('from'),native);for(const key of ['memo','raw','signature'])assert.equal(value(key),evm);assert.deepEqual(JSON.parse(value('topics')),[evm]);
 const log=JSON.parse(value('logs'));assert.equal(log.address,native);assert.equal(log.data,evm);assert.deepEqual(log.topics,[evm]);assert.equal(value('legacy / address'),'ynx_faucet');
});

test('nested account-like keys inside opaque payloads retain the original bytes',()=>{
 const c=context();
 c.data={raw:{address:evm,from:evm},memo:{to:evm},logs:[{address:evm,data:{address:evm,to:evm},topics:[evm]}]};
 const before=JSON.stringify(c.data);
 const rows=JSON.parse(vm.runInContext('JSON.stringify(flatten(data))',c));
 const value=k=>rows.find(r=>r[0]===k)[1];
 assert.deepEqual(JSON.parse(value('raw')),c.data.raw);assert.deepEqual(JSON.parse(value('memo')),c.data.memo);
 const log=JSON.parse(value('logs'));assert.equal(log.address,native);assert.deepEqual(log.data,c.data.logs[0].data);assert.deepEqual(log.topics,[evm]);
 assert.equal(JSON.stringify(c.data),before);
});
test('all 12 current Explorer locales include visible converter, Wallet and copy labels',()=>{
 const locales=['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id'];
 const messages=Object.fromEntries(locales.map(l=>[l,{}]));const c=vm.createContext({messages});
 const start=source.indexOf("Object.entries({en:['YNX ↔ EVM address converter'");const end=source.indexOf('    function applyLanguage',start);
 assert(start>=0&&end>start);vm.runInContext(source.slice(start,end),c);
 for(const locale of locales)for(const key of ['addressConverter','openWallet','copyAddress'])assert(messages[locale][key]?.length>1,locale+'/'+key);
});

test('drawer offers Copy before activation and copies the displayed native address',async()=>{
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',classList:{add(){}},setAttribute(){},focus(){}});return nodes.get(id)};
 let copied='',toast='';
 const c=context();
 Object.assign(c,{$:node,document:{body:{style:{}}},detailStats:()=>[],detailExtra:()=>'',navigator:{clipboard:{writeText:async text=>{copied=text}}},showToast:message=>{toast=message}});
 vm.runInContext('let currentDetailType,currentDetailQuery,currentDetail;',c);
 vm.runInContext(take('    function showDrawer(','    function closeDrawer('),c);
 c.tx={from:evm,to:evm};vm.runInContext("showDrawer('transaction','test',tx)",c);
 const html=node('detailContent').innerHTML;
 assert(html.includes('aria-label="copyAddress">copyAddress</button>'));
 assert(!html.includes('aria-label="copied"'));
 assert(html.includes('data-copy="'+native+'"'));
 const start=source.indexOf("      const button = event.target.closest('[data-copy]');");
 const end=source.indexOf('\n    };',start);
 assert(start>=0&&end>start);
 c.event={target:{closest:()=>({dataset:{copy:encodeURIComponent(native)}})}};
 await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',c);
 assert.equal(copied,native);assert.equal(toast,'copied');
});
