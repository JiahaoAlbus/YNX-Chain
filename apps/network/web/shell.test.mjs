import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {htmlIDs,record} from './test-support.mjs';
function shell({throwPost=false}={}){
 const elements=new Map(),events=new Map(),sent=[];let locale='zh-Hans',subscription;
 function element(){return {dataset:{},parentElement:{classList:{toggle(){}}},style:{},hidden:false,disabled:false,textContent:'',value:'',children:[],handlers:new Map(),classList:{toggle(){},add(){}},setAttribute(){},removeAttribute(){},addEventListener(type,fn){this.handlers.set(type,fn)},querySelector(){return element()},replaceChildren(...children){this.children=children},append(...children){this.children.push(...children)},focus(){},scrollIntoView(){}};}
 for(const id of htmlIDs)elements.set(id,element());
 const $=id=>elements.get(id),window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener:(type,fn)=>events.set(type,fn),scrollTo(){},NetworkOverview:{project:()=>({})},webkit:{messageHandlers:{networkExport:{postMessage(value){if(throwPost)throw Error('bridge unavailable');sent.push(value)}}}},NetworkI18n:{get locale(){return locale},t:key=>locale==='zh-Hans'?key:'ar:'+key,subscribe:fn=>{subscription=fn},setLocale:value=>{locale=value;subscription()}}};
 runInNewContext(readFileSync(new URL('./shell.js',import.meta.url),'utf8'),{window,document:{getElementById:$,querySelector:()=>element(),querySelectorAll:()=>[],createElement:()=>element(),documentElement:{dataset:{}}},location:{hash:'#overview',origin:'http://127.0.0.1:1234'},history:{replaceState(){}},localStorage:{getItem(){},setItem(){}},navigator:{},Intl,Date,BigInt,structuredClone,setTimeout,URL,Blob});
 return {$,window,sent,click:id=>$(id).handlers.get('click')(),event:detail=>events.get('network:export-result')({detail}),pair:()=>window.NetworkUI.receive('status',{paired:true}),receipt:r=>window.NetworkUI.receive('receipt',{record:r})};
}
const buttons=['export-receipt','settings-export','account-export'];
function disabled(s,value){for(const id of buttons)assert.equal(s.$(id).disabled,value,id)}
test('native export stays single and pending across routes, receipt replacement and language switches',()=>{
 const s=shell();s.pair();const original=record();s.receipt(original);disabled(s,false);s.click(buttons[0]);disabled(s,true);assert.equal(s.sent.length,1);assert.match(s.$('shell-notice').textContent,/请选择/);
 s.event({status:'writing',code:'EXPORT_WRITING'});assert.match(s.$('shell-notice').textContent,/正在保存/);s.window.NetworkUI.navigate('history');s.receipt(record(undefined,'RPC_ONLY'));s.window.NetworkI18n.setLocale('ar');disabled(s,true);assert.match(s.$('shell-notice').textContent,/^ar:/);
 for(const id of buttons)s.click(id);assert.equal(s.sent.length,1);assert.equal(s.sent[0].record.receiptId,original.receiptId);
 s.event({status:'failed',code:'EXPORT_BUSY'});disabled(s,true);s.event({status:'saved',code:'EXPORT_SAVED'});disabled(s,false);assert.match(s.$('shell-notice').textContent,/回执已保存/);
});
test('cancel, failed bridge and uncertain durability never claim saved or retry automatically',()=>{
 const s=shell();s.pair();s.receipt(record());s.click(buttons[0]);s.event({status:'cancelled'});disabled(s,false);assert.match(s.$('shell-notice').textContent,/已取消/);
 s.click(buttons[0]);s.event({status:'unknown',code:'EXPORT_DURABILITY_UNKNOWN'});disabled(s,false);assert.match(s.$('shell-notice').textContent,/未确定/);assert.equal(s.sent.length,2);
 const failed=shell({throwPost:true});failed.pair();failed.receipt(record());failed.click(buttons[0]);disabled(failed,false);assert.match(failed.$('shell-notice').textContent,/失败/);
});
test('session reset clears receipt authority while original export completion is still reportable',()=>{
 const s=shell();s.pair();s.receipt(record());s.click(buttons[0]);s.window.NetworkUI.receive('reset');s.event({status:'saved'});disabled(s,true);for(const id of buttons)s.click(id);assert.equal(s.sent.length,1);s.event({status:'cancelled'});assert.match(s.$('shell-notice').textContent,/已保存/);
});

test('old native operation completion releases activity without calling the current receipt saved',()=>{
 const s=shell();s.pair();s.receipt(record());s.click(buttons[0]);s.event({status:'failed',code:'EXPORT_BUSY'});disabled(s,true);s.event({status:'idle',code:'EXPORT_PRIOR_FINISHED'});disabled(s,false);assert.match(s.$('shell-notice').textContent,/先前导出/);assert.doesNotMatch(s.$('shell-notice').textContent,/回执已保存/);assert.equal(s.sent.length,1);
});

test('actual local module states clear on session reset and never fill absent counters with zero',()=>{
 const s=shell();s.pair();s.window.NetworkOverview.project=()=>({native:{activity:{node:{code:'UNSUPPORTED',capacityComplete:false,usedBytes:null},participation:{code:'REVOKED',entries:'3',unknownEntries:'1'},resource:{code:'DISABLED',state:'stopped',verifiedJobs:'0',verifiedBytes:'0',activeWorkers:'0'}}}});s.window.NetworkUI.receive('native',{});
 assert.match(s.$('participation-state').textContent,/已撤销/);assert.equal(s.$('participation-entry-count').textContent,'3');assert.equal(s.$('participation-unknown-count').textContent,'1');assert.equal(s.$('resource-verified-jobs').textContent,'0');assert.equal(s.$('local-node-bytes').textContent,'—');
 s.window.NetworkOverview.project=()=>({});s.window.NetworkUI.receive('reset');assert.equal(s.$('participation-entry-count').textContent,'—');assert.equal(s.$('resource-verified-jobs').textContent,'—');assert.equal(s.$('resource-code').textContent,'—');assert.equal(s.$('resource-state').textContent,'尚未读取');
});

test('resource Source readiness renders, localizes and clears without retaining a grant',()=>{
 const s=shell();s.pair();let source={code:'NOT_ADMITTED',cleanupPending:false};s.window.NetworkOverview.project=()=>({native:{activity:{resource:{code:'DISABLED',state:'disabled',activeWorkers:'0',verifiedJobs:'0',verifiedBytes:'0',source}}}});
 s.window.NetworkUI.receive('native',{});assert.equal(s.$('resource-source-state').textContent,'授权来源未就绪');source={code:'CURRENT',cleanupPending:false};s.window.NetworkUI.receive('native',{});assert.equal(s.$('resource-source-state').textContent,'授权来源可用');
 s.window.NetworkI18n.setLocale('ar');assert.match(s.$('resource-source-state').textContent,/^ar:/);source={code:'RETIRED',cleanupPending:true};s.window.NetworkUI.receive('native',{});assert.match(s.$('resource-source-state').textContent,/正在释放/);
 s.window.NetworkOverview.project=()=>({});s.window.NetworkUI.receive('reset');assert.match(s.$('resource-source-state').textContent,/尚未读取/);assert.equal(s.sent.length,0);
});
