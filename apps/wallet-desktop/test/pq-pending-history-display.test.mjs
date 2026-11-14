import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {projectPendingTransactions} from '../src/transaction-resolution-display.mjs';
import {appendPQFinalityActions} from '../src/wallet-pq-finality-ui.mjs';
const account='0x'+'11'.repeat(20),hash=i=>'0x'+i.toString(16).padStart(64,'0');
const terminal=(i,status='pq-finalized-succeeded')=>({hash:hash(i),account,kind:'pq-transfer',operationId:'PUBLIC-'+i,status,canRetryExact:false,resultStorageConfirmed:true,resultHeldInMemory:false,consensusFinality:true,nativeGrant:false});
const active=(i)=>({hash:hash(i),account,kind:'pq-transfer',operationId:'PUBLIC-'+i,status:'pq-submission-unknown',canRetryExact:false,resultStorageConfirmed:false,resultHeldInMemory:true});
const envelope=value=>({ok:true,value});
test('bounded 64 verified terminal rows plus one original UNKNOWN retain every bound identity',()=>{
 const rows=[active(100),...Array.from({length:64},(_,i)=>terminal(i+1))],out=projectPendingTransactions(envelope(rows),account);
 assert.equal(out.length,65);assert.equal(out[0].status,'pq-submission-unknown');assert.equal(out[0].hash,hash(100));assert.equal(out[0].canRetryExact,false);
 assert(out.slice(1).every(row=>row.consensusFinality===true&&row.nativeGrant===false&&row.canRetryExact===false));
 for(const bad of [[...rows,terminal(65)],[terminal(1),terminal(1)],[terminal(1),{...terminal(2),account:'0x'+'22'.repeat(20)}],[active(1),active(2)],[terminal(1),{hash:null,account,status:'signing_unknown',canRetryExact:false,to:null,amount:null,signingUnknown:true}]])assert.throws(()=>projectPendingTransactions(envelope(bad),account));
});
test('terminal state is not invented from incomplete or contradictory finality fields',()=>{
 const good=terminal(1),unknown={...good,status:'pq-finality-save-unknown',resultStorageConfirmed:false,resultHeldInMemory:true,consensusFinality:false};
 assert.equal(projectPendingTransactions(envelope([unknown]),account)[0].consensusFinality,false);
 assert.equal(projectPendingTransactions(envelope([terminal(2,'pq-finalized-rejected')]),account)[0].status,'pq-finalized-rejected');
 for(const altered of [{...good,consensusFinality:false},{...good,nativeGrant:true},{...good,resultStorageConfirmed:false},{...good,resultHeldInMemory:true},{...good,canRetryExact:true},Object.fromEntries(Object.entries(good).filter(([key])=>key!=='consensusFinality')),{...unknown,consensusFinality:true},{...unknown,resultHeldInMemory:false}])assert.throws(()=>projectPendingTransactions(envelope([altered]),account));
});
test('normal renderer shows retained UNKNOWN alongside original terminal without creating a retry',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),start=source.indexOf('async function refreshTransactions()'),end=source.indexOf('\ndocument.querySelector("#refresh-pending-transactions")',start),nodes=new Map();
 class Element{constructor(doc){this.ownerDocument=doc;this.children=[];this.textContent='';this.hidden=false;this.disabled=false;}append(...args){this.children.push(...args)}replaceChildren(...args){this.children=args}addEventListener(){}}
 const doc={querySelector(name){if(!nodes.has(name))nodes.set(name,new Element(doc));return nodes.get(name)},createElement(){return new Element(doc)}};
 const records=[active(2),terminal(1)],context={document:doc,window:{ynxWallet:{pendingTransactions:async()=>envelope(records)}},activeAccount:account,transactionRevision:0,transactionActionRevision:0,keyState:{account,revision:1,locked:false,authenticating:false},projectPendingTransactions,appendPQOriginalRecoveryActions(){},appendPQProgressActions(){},appendPQFinalityActions:options=>appendPQFinalityActions({...options,document:doc}),copyUI:(node,text)=>node.textContent=text};
 runInNewContext(source.slice(start,end),context);await context.refreshTransactions();const list=nodes.get('#pending-transactions');assert.equal(list.children.length,2);assert.equal(nodes.get('#transaction-resolution').hidden,false);
 const text=node=>node.textContent+' '+node.children.map(text).join(' ');assert.match(text(list.children[0]),/outcome unknown/i);assert.match(text(list.children[1]),/Consensus-finalized/i);assert(!/retry identical|sign again/i.test(text(list.children[1])));
});
