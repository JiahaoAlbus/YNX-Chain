import fs from'node:fs';import path from'node:path';import os from'node:os';import{pathToFileURL,fileURLToPath}from'node:url';
const pkg=process.env.YNX_CLEANUP_PACKAGE??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=process.env.YNX_CLEANUP_BASE??pkg;let publicCloseFiles=0,publicScratch;
export const f=JSON.parse(fs.readFileSync(base+'/test/fixtures/product-session-device-v5-server-public.json'));
const load=n=>import(pathToFileURL(pkg+'/src/'+n));
export const{OriginalBinaryV5AccountPolicyKernel:Kernel}=await load('original-binary-http-account-policy-v5.js');
const{captureProductSessionAccountPolicy:capture}=await load('product-session-account-policy.js');
export function operation(){return{version:'5',requestId:'req_binary_auth_control_0001',method:'POST',path:'/api/v1/ide/deployments',bodyOriginal:Buffer.from(f.bodyBase64url,'base64url'),contentType:f.contentType,bodyDigest:f.unsigned.bodyDigest,bodyBinding:structuredClone(f.unsigned.bodyBinding),proofHeader:f.header,walletControlProofHeader:null,session:structuredClone(f.session),at:f.at}}
// PUBLIC original packet + actual production policy capture. No service, Root,
// key, Native provider or direct private-WeakMap setter is invoked.
export function controlled(options={}){let pending=options.pending??true,acquires=0,effects=0;const calls={retire:0,join:0,close:0};const events=[],pendingError=Object.hasOwn(options,'pendingError')?options.pendingError:Object.assign(Error('PUBLIC_JOIN_PENDING'),{code:'PUBLIC_JOIN_PENDING'});let release;
 const gate=options.asyncJoin?new Promise(r=>release=r):undefined;
 const resource={readOriginal:()=>structuredClone(f.policy),assertCurrent(){},async recheck(){},retire(){calls.retire++;events.push('retire');if(options.retireErrorPresent)throw options.retireError;},join(){calls.join++;events.push('join');if(options.asyncJoin)return gate;if(pending)throw pendingError;},close(){calls.close++;events.push('close');if(options.closeErrorPresent)throw options.closeError;}};
 const policyRef=capture(resource,{networkId:f.policy.networkId,account:f.session.account},new Date(f.at));const lease=Object.freeze({resource,policyRef,expiresAtMs:Date.parse(f.at)+5000});const kernel=new Kernel(async()=>{acquires++;if(options.acquireGate)await options.acquireGate;return lease},()=>{},()=>Date.parse(f.at));
 return{kernel,calls,events,lease,allow(){pending=false;release?.();},effect(){effects++;if(options.effectErrorPresent)throw options.effectError;},get acquired(){return acquires},get entered(){return effects}};
}
export function invoke(fn){let threw=false,cause;try{fn()}catch(e){threw=true;cause=e}return{threw,cause}}
export async function invokeAsync(fn){let threw=false,cause;try{await fn()}catch(e){threw=true;cause=e}return{threw,cause}}
// Expose only the existing normal close closure in a test-only sibling module.
// The production leaf exports no new factory, selection setter or lifecycle hook.
export async function normalClose(kernel,manifest){const original=fs.readFileSync(pkg+'/src/original-binary-http-account-policy-v5.js','utf8');let source;
 if(original.includes('function createOriginalBinaryV5PolicyClose('))source=original+'\nexport const __PUBLIC_CLOSE_TEST_ONLY=createOriginalBinaryV5PolicyClose;\n';
 else{const begin=original.indexOf('const close=()=>{kernel?.retire();kernel?.join();');const end=original.indexOf(';try{',begin);if(begin<0||end<0)throw Error('PUBLIC_ORIGINAL_CLOSE_EXTRACT');const closure=original.slice(begin+'const close='.length,end);source=original+'\nexport function __PUBLIC_CLOSE_TEST_ONLY(readKernel,readManifest,onClosed){let kernel=readKernel(),manifest=readManifest(),closed=false,first;const close='+closure+';return()=>{try{return close()}finally{if(closed)onClosed()}}}\n';}
 const root=process.env.RUNNER_TEMP??process.env.TMPDIR??os.tmpdir();fs.mkdirSync(root,{recursive:true});const scratch=publicScratch??=fs.mkdtempSync(path.join(root,'ynx-binary-cleanup-PUBLIC-'));source=source.replace(/from(['\"])(\.[^'\"]+)\1/g,(_,quote,specifier)=>'from'+quote+pathToFileURL(path.resolve(pkg,'src',specifier)).href+quote);const file=path.join(scratch,'PUBLIC-cleanup-close-'+(++publicCloseFiles)+'.mjs');fs.writeFileSync(file,source);const module=await import(pathToFileURL(file).href+'?PUBLIC='+Date.now());let closed=false;const close=module.__PUBLIC_CLOSE_TEST_ONLY(()=>kernel,()=>manifest,()=>{closed=true});return{close,closed:()=>closed,status:()=>close.status?close.status():kernel.status()};}
