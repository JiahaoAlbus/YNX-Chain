import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {canonicalJSON} from '../src/canonical.js';
import {encodeOriginalAITaskResponseCarrierV6DATA as encode,decodeOriginalAITaskResponseCarrierV6DATA as decode} from '../src/original-ai-task-response-carrier-v6-data.mjs';
const enc=s=>new TextEncoder().encode(s),hex=b=>Buffer.from(b).toString('hex');
const out=process.env.AI_CARRIER_FIXTURES;
const fixtures=[];let tests=0;
function accept(name,body,receipt,state='UNKNOWN'){
 const metadata=enc(canonicalJSON({state,action:'task.create',businessAction:state==='COMMITTED'?'create-task':null,completionScope:state==='COMMITTED'?'PRODUCT_LOCAL_COMMIT_ONLY':null,requestRef:state==='COMMITTED'?'ref-1':null}));
 const raw=encode({bodyOriginal:body,outcomeMetadataOriginal:metadata,businessReceiptOriginal:receipt});
 const got=decode(raw);assert.deepEqual(got.bodyOriginal,body);assert.deepEqual(got.outcomeMetadataOriginal,metadata);assert.deepEqual(got.businessReceiptOriginal,receipt);assert.deepEqual(got.transportOriginal,raw);assert.equal(got.receiptProvenanceVerified,false);assert.equal(got.operationVerified,false);assert.equal(got.SourceAdmission,false);
 const original=got.bodyOriginal[0];if(body.length){body[0]^=255;assert.equal(got.bodyOriginal[0],original);body[0]^=255;}
 fixtures.push({name,accept:true,raw,expected:[hex(body),hex(metadata),receipt===null?'-':hex(receipt)].join('\n')+'\n'});tests++;return raw;
}
function reject(name,raw){assert.throws(()=>decode(raw));fixtures.push({name,accept:false,raw});tests++;}
const committed=accept('committed-opaque-go-receipt',enc('{"taskId":"task1"}'),enc('{"State":"COMMITTED","OriginalOperationID":"original-op"}'),'COMMITTED');
accept('absent-receipt-empty-body',new Uint8Array(),null);
accept('present-empty-receipt',new Uint8Array(),new Uint8Array());
accept('all-octets',Uint8Array.from({length:256},(_,i)=>i),Uint8Array.from([0,255,194,128]));
const near=accept('near-carrier-budget',new Uint8Array(785000),new Uint8Array());assert(near.length<1048576);
const v=JSON.parse(Buffer.from(committed).toString());
reject('duplicate-key',enc(Buffer.from(committed).toString().replace('{','{"version":"duplicate",')));
reject('trailing-space',enc(Buffer.from(committed).toString()+' '));
reject('legacy-business-body',enc('{"state":"COMMITTED"}'));
reject('wrong-tag',enc(canonicalJSON({...v,version:'legacy'})));
reject('unknown-field',enc(canonicalJSON({...v,SourceAdmission:true})));
reject('base64-padding',enc(canonicalJSON({...v,bodyOriginalBase64url:v.bodyOriginalBase64url+'='})));
reject('base64-tail-bits',enc(canonicalJSON({...v,bodyOriginalBase64url:'AB'})));
reject('bad-receipt-type',enc(canonicalJSON({...v,businessReceiptOriginalBase64url:false})));
reject('metadata-duplicate',enc(canonicalJSON({...v,outcomeMetadataOriginalBase64url:Buffer.from('{"state":"UNKNOWN","state":"UNKNOWN"}').toString('base64url')})));
reject('metadata-not-canonical',enc(canonicalJSON({...v,outcomeMetadataOriginalBase64url:Buffer.from('{"state":"UNKNOWN", "action":"task.create"}').toString('base64url')})));
reject('metadata-wrong-fields',enc(canonicalJSON({...v,outcomeMetadataOriginalBase64url:Buffer.from('{"state":"UNKNOWN"}').toString('base64url')})));
reject('utf8-bom',Uint8Array.from([239,187,191,...committed]));
reject('aggregate-overflow',new Uint8Array(1048577));
assert.throws(()=>encode({bodyOriginal:new Uint8Array(800000),outcomeMetadataOriginal:enc(canonicalJSON({state:'UNKNOWN',action:'task.create',businessAction:null,completionScope:null,requestRef:null})),businessReceiptOriginal:new Uint8Array()}));tests++;
let getterCalls=0;assert.throws(()=>encode(Object.defineProperty({},'bodyOriginal',{get(){getterCalls++;return new Uint8Array();},enumerable:true})));assert.equal(getterCalls,0);tests++;
if(out){mkdirSync(out,{recursive:true});for(const [i,f]of fixtures.entries()){writeFileSync(path.join(out,i+'.bin'),f.raw);if(f.accept)writeFileSync(path.join(out,i+'.expected'),f.expected);}writeFileSync(path.join(out,'manifest.json'),JSON.stringify(fixtures.map(({raw,expected,...f},i)=>({...f,index:i})),null,2)+'\n');}
console.log(JSON.stringify({tests,pass:tests,fail:0,fixtures:fixtures.length,dataOnly:true,RootAdmission:false,SourceAdmission:false}));
