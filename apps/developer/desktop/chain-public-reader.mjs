import {randomUUID} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {createChainReader,CHAIN_PROTOCOL,validateReadRpc} from '../services/chain-service/src/chain-reader.mjs';
const REST='https://rpc.ynxweb4.com/', EVM='https://evm.ynxweb4.com/';
const LIMIT=2*1024*1024;
export function createPublicChainHost(context,{fetcher=fetch,sourceVersion='ynx-native-public-read/v1'}={}){
 const launch=randomUUID();let closed=false,identity;
 async function current(){
  if(closed)throw Error('Chain host has stopped.');
  const stat=await lstat(context.workspace),key=`${stat.dev}:${stat.ino}`;
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(context.workspace)!==context.workspace||identity&&identity!==key)throw Error('Chain project directory changed.');
  identity ||= key;
  if(closed)throw Error('Chain host has stopped.');
  return {protocolVersion:'ynx-code-chain-public/v1',projectId:context.id,workspace:context.workspace,launch,sourceVersion};
 }
 async function json(url,options,signal){
  signal?.throwIfAborted();
  const response=await fetcher(url,{...options,headers:{accept:'application/json',...(options?.body?{'content-type':'application/json'}:{})},redirect:'error',credentials:'omit',signal});
  if(!response.ok||response.redirected)throw Error('Public Chain endpoint rejected the read.');
  if(Number(response.headers?.get('content-length')||0)>LIMIT)throw Error('Public Chain response is too large.');
  const chunks=[];let size=0;
  if(!response.body)throw Error('Public Chain response body is unavailable.');
  try{for await(const chunk of response.body){signal?.throwIfAborted();size+=chunk.byteLength;if(size>LIMIT)throw Error('Public Chain response is too large.');chunks.push(Buffer.from(chunk));}}
  catch(error){await response.body.cancel?.().catch(()=>{});throw error;}
  signal?.throwIfAborted();return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async function rpc(method,params,signal){
  validateReadRpc({protocolVersion:CHAIN_PROTOCOL,method,params});const id=randomUUID();
  const value=await json(EVM,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id,method,params})},signal);
  if(value?.jsonrpc!=='2.0'||value.id!==id||value.error||!Object.hasOwn(value,'result'))throw Error('Public Chain RPC response is inconsistent.');
  return value.result;
 }
 function reader(signal){return createChainReader(async(route,options)=>{
  await current();signal?.throwIfAborted();let value;
  if(route==='/status')value={protocolVersion:CHAIN_PROTOCOL,status:await json(REST+'status',undefined,signal)};
  else if(route==='/compiler')value={protocolVersion:CHAIN_PROTOCOL,compiler:await json(REST+'ide/compiler',undefined,signal)};
  else if(route==='/rpc'){const body=JSON.parse(options.body);value={protocolVersion:CHAIN_PROTOCOL,method:body.method,result:await rpc(body.method,body.params,signal)};}
  else if(/^\/transactions\/0x[0-9a-fA-F]{64}$/.test(route)){const hash=route.slice(14);const transaction=await rpc('eth_getTransactionByHash',[hash],signal),receipt=await rpc('eth_getTransactionReceipt',[hash],signal);value={protocolVersion:CHAIN_PROTOCOL,hash,record:null,transaction,receipt,confirmed:Boolean(receipt)};}
  else if(/^\/blocks\/(0x[0-9a-fA-F]{64}|[0-9]{1,20})$/.test(route)){const id=route.slice(8),isHash=id.startsWith('0x');value={protocolVersion:CHAIN_PROTOCOL,id,record:null,block:await rpc(isHash?'eth_getBlockByHash':'eth_getBlockByNumber',[isHash?id:`0x${BigInt(id).toString(16)}`,true],signal)};}
  else throw Error('Public Chain route is not allowed.');
  await current();signal?.throwIfAborted();return value;
 });}
 return {current,close(){closed=true;},async read(action,params,externalSignal){
  if(!['current','status','compiler','balance','transaction','block'].includes(action)||!Array.isArray(params)||params.length!==(['current','status','compiler'].includes(action)?0:1))throw Error('Public Chain action is not allowed.');
  await current();if(action==='current'){if(params.length)throw Error('Invalid current request.');return current();}
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);
  externalSignal?.addEventListener('abort',abort,{once:true});if(externalSignal?.aborted)abort();
  try{
   const api=reader(controller.signal),status=await api.status();
   // Verify both fixed sources belong to the same chain before accepting data.
   await api.rpc('eth_chainId',[]);
   if(action==='status')return status;
   if(action==='compiler'){if(params.length)throw Error('Invalid compiler request.');return await api.compiler();}
   if(action==='balance'){if(!/^0x[0-9a-fA-F]{40}$/.test(params[0]||''))throw Error('Invalid balance address.');return await api.rpc('eth_getBalance',[params[0],'latest']);}
   if(action==='transaction')return await api.transaction(params[0]);
   if(action==='block')return await api.block(params[0]);
  }finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
 }};
}
