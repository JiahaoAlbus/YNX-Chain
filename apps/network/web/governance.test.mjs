import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({URL,TextEncoder});vm.runInContext(fs.readFileSync(new URL('./governance.js',import.meta.url),'utf8'),context);const {projectList,projectDetail}=context.NetworkGovernance;
const A='a'.repeat(64),B='b'.repeat(64),T='2026-11-02T01:00:00.123456789Z';
const proposal=()=>({id:A,input:{summary:'Actual registry proposal <script> is text',scope:'network',proposalType:'parameter',proposer:'original-account'},status:'voting',deposit:'18446744073709551615',eligiblePower:'9007199254740993',createdAt:T,updatedAt:T,votingEndsAt:'0001-01-01T00:00:00Z',votes:{original:{weight:'9007199254740993'}},changes:[],active:true});
const meta=()=>({projectionVersion:'YNX-NETWORK-GOVERNANCE-READ/v1',code:'REPORTED',classification:'RPC_ONLY',reportKind:'governance-registry',authority:false,walletApproval:false,nativeEligibility:false,chainFinality:false,source:'ynx-governance-authoritative-state',version:'ynx-governance-api/v1',asOf:T,observedAt:T,endpoint:'https://rpc.ynxweb4.com/governance/proposals',responseSHA256:B,numericEncoding:'decimal-strings'});
const list=()=>({...meta(),proposals:[proposal()],reportedCount:'1',returnedCount:'1',limit:'50',truncated:false});
const detail=()=>({...meta(),endpoint:meta().endpoint+'/'+A,proposal:proposal()});
function frozen(v){if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;}

test('registry projection preserves exact uint64 and source evidence without granting authority',()=>{
 const input=frozen(list()),p=projectList(input);assert.ok(p);assert.equal(p.proposals[0].deposit,'18446744073709551615');assert.equal(p.proposals[0].eligiblePower,'9007199254740993');assert.equal(p.proposals[0].votingEndsAt,null);assert.equal(p.observedAt,T);assert.equal(p.asOf,T);assert.equal(p.responseSHA256,B);assert.equal(p.classification,'RPC_ONLY');for(const f of ['authority','walletApproval','nativeEligibility','chainFinality'])assert.equal(p[f],false);assert.match(p.proposals[0].summary,/<script>/);assert.equal('href' in p.proposals[0],false);assert.equal('approve' in p,false);
});
test('empty, unavailable and byte-truncated lists have distinct truthful counts',()=>{
 const empty={...list(),code:'EMPTY',proposals:[],reportedCount:'0',returnedCount:'0'};assert.ok(projectList(empty));
 const unavailable={...empty,code:'UNSUPPORTED',source:null,version:null,asOf:null,responseSHA256:null,reportedCount:null};assert.ok(projectList(unavailable));
 const truncated={...list(),truncated:true,reportedCount:'90'};assert.equal(projectList(truncated).truncated,true);
 for(const change of [v=>v.code='EMPTY',v=>v.reportedCount='0',v=>v.returnedCount='2',v=>v.reportedCount='01',v=>v.limit='500',v=>v.truncated=1,v=>v.reportedCount=1,v=>v.proposals.push(proposal())]){const x=list();change(x);assert.equal(projectList(x),null);}
 const falseEmpty={...empty,truncated:true};assert.equal(projectList(falseEmpty),null);assert.equal(projectList({...unavailable,proposals:[proposal()],returnedCount:'1'}),null);
});
test('malformed metadata, rounded numbers, cross-domain endpoints and approval flags are refused',()=>{
 for(const change of [v=>v.authority=true,v=>v.walletApproval=1,v=>v.nativeEligibility=true,v=>v.chainFinality=true,v=>v.classification='STATE_VERIFIED',v=>v.source='self-trusted',v=>v.version='v2',v=>v.projectionVersion='unknown',v=>v.responseSHA256='pin',v=>v.observedAt='2026-02-30T00:00:00Z',v=>v.endpoint='https://u:p@host/governance/proposals',v=>v.endpoint+='?target=other',v=>v.endpoint='http://example.com/governance/proposals',v=>v.proposals[0].eligiblePower=9007199254740992,v=>v.proposals[0].votes.original.weight=1,v=>v.proposals[0].id=B,v=>v.proposals[0].createdAt='2026-11-02',v=>v.extra='authority']){const x=list();change(x);if(x.proposals[0].id===B){x.proposals.push({...proposal(),id:B});x.returnedCount='2';x.reportedCount='2';}assert.equal(projectList(x),null);}
 assert.ok(projectList({...list(),endpoint:'http://127.0.0.1:9876/governance/proposals'}));
 assert.ok(projectList({...list(),endpoint:'https://rpc.ynxweb4.com/fixed-prefix/governance/proposals'}));
 for(const prefix of ['/x/../','/%2e%2e/','/x%2fy/','/x%5cy/','//'])assert.equal(projectList({...list(),endpoint:'https://rpc.ynxweb4.com'+prefix+'governance/proposals'}),null);
});
test('detail requires the originally selected ID and keeps the full decimal document as inert JSON',()=>{
 const x=frozen(detail()),p=projectDetail(x,A);assert.ok(p);assert.equal(p.proposal.id,A);assert.equal(JSON.parse(p.rawJSON).votes.original.weight,'9007199254740993');assert.equal(projectDetail(x,B),null);assert.equal(projectDetail({...detail(),endpoint:meta().endpoint+'/'+B},A),null);assert.equal(projectDetail({...detail(),proposal:{...proposal(),id:B}},A),null);
 assert.equal(projectDetail({...detail(),code:'NOT_FOUND',proposal:null},A).proposal,null);assert.equal(projectDetail({...detail(),code:'EMPTY',proposal:null},A),null);
});
test('oversized or deep originals cannot become a clipped apparently complete report',()=>{
 const x=list();x.proposals[0].input.motivation='a'.repeat(128*1024);assert.equal(projectList(x),null);
 const many={...list(),proposals:Array.from({length:51},(_,i)=>({...proposal(),id:i.toString(16).padStart(64,'0')})),reportedCount:'51',returnedCount:'51'};assert.equal(projectList(many),null);
 const deep=list();let p=deep.proposals[0];for(let i=0;i<34;i++){p.next={};p=p.next;}assert.equal(projectList(deep),null);
});
