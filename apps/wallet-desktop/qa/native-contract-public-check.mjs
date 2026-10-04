// Public read-only survey: no Wallet Main, SDK, signer, vault or write routes.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {NativeContractClient} from "../src/native-contract.mjs";
import {createNativeContractService} from "../src/native-contract-service.mjs";
import {CANONICAL_RPC_URL} from "../src/rpc.mjs";
const origin=CANONICAL_RPC_URL,requests=[],candidates=[],reads=[],failures=[],surveys=[];
async function publicFetch(url,init={}){
 const parsed=new URL(url),body=init.body===undefined?null:JSON.parse(init.body),method=init.method??"GET";
 if(parsed.origin!==origin||parsed.username||parsed.password||
  !(method==="GET"&&(/^\/txs\?page=[1-3]&limit=100$/.test(parsed.pathname+parsed.search)||/^\/ide\/contracts\/0x[0-9a-f]{40}$/.test(parsed.pathname))||
    method==="POST"&&parsed.pathname==="/evm"&&body?.method==="eth_chainId"&&body.params?.length===0||
    method==="POST"&&parsed.pathname==="/ide/call"&&Object.keys(body).sort().join(",")==="address,calldata"&&/^0x[0-9a-f]{8}$/.test(body.calldata)))throw Error("Non-public-read request refused");
 const response=await fetch(url,{...init,redirect:"error",credentials:"omit",signal:init.signal??AbortSignal.timeout(8000)});
 const raw=await response.text();if(raw.length>1048576)throw Error("Public survey response too large");
 requests.push({method,route:parsed.pathname+parsed.search,status:response.status,bytes:Buffer.byteLength(raw),sha256:createHash("sha256").update(raw).digest("hex")});
 // Preserve metadata/hash, not public transaction memos or replayable bytes.
 return new Response(raw,{status:response.status,headers:{"Content-Type":"application/json"}});
}
const client=new NativeContractClient(origin,publicFetch),context={focused:true,changing:false,account:null,revision:0};
const service=createNativeContractService({client,getContext:()=>context});
try{
 await client.verifyChain(()=>{});
 for(let page=1;page<=3;page++){
  const response=await publicFetch(`${origin}/txs?page=${page}&limit=100`);
  if(!response.ok){failures.push({stage:"public-transaction-survey",status:response.status});break;}
  const value=await response.json();if(!Array.isArray(value.transactions))throw Error("Unexpected public transaction list");
  const types={};for(const tx of value.transactions)types[typeof tx.type==="string"?tx.type:"missing"]=(types[tx.type]??0)+1;
  const paginationVerified=value.page===page&&value.limit===100&&Number.isSafeInteger(value.total)&&value.total>=0&&
   (value.nextPage===null||value.nextPage===page+1);
  surveys.push({requestedPage:page,count:value.transactions.length,types,paginationVerified});
  for(const tx of value.transactions){
   if(tx.type!=="contract_deploy"||!/^0x[0-9a-f]{40}$/.test(tx.from)||!/^0x[0-9a-f]{64}$/.test(tx.hash))continue;
   const address="0x"+createHash("sha256").update(`YNX_BFT_CONTRACT_ADDRESS_V1|${tx.from}|${tx.hash}`).digest("hex").slice(0,40);
   if(!candidates.some(row=>row.address===address))candidates.push({address,publicTransactionHash:tx.hash});
  }
  if(!paginationVerified){failures.push({stage:"public-transaction-survey",code:"PAGINATION_NOT_VERIFIED",meaning:"Only this returned list was inspected; do not infer whole chain membership"});break;}
  if(candidates.length>=3||value.nextPage===null)break;
 }
 for(const target of candidates.slice(0,3)){
  try{
   const lookup=await service({mode:"bft",action:"lookup",address:target.address});
   const method=lookup.methods.find(row=>row.inputCount===0);if(!method)throw Error("No supported zero-argument public view");
   const result=await service({mode:"bft",action:"read",address:target.address,function:method.selector});
   reads.push({address:target.address,name:lookup.artifact.name,auditHash:result.read.artifact.auditHash,method:method.signature,
    returnValue:result.read.returnValue,encodedResult:result.read.encodedResult,opcodeStepCount:result.read.opcodeStepCount,
    truthfulStatus:result.read.truthfulStatus,asOf:result.read.asOf});
  }catch(error){failures.push({stage:"candidate-public-read",address:target.address,code:error.code??"PUBLIC_READ_FAILED"});}
 }
}catch(error){failures.push({stage:"chain-or-survey",code:error.code??error.name});}
console.log(JSON.stringify({observedAt:new Date().toISOString(),origin,mode:"ACTUAL_PUBLIC_RPC_READ_ONLY_ORIGINAL_CLIENT_SERVICE",
 requests,surveys,candidates,reads,failures,successfulExistingContractRead:reads.length>0,
 inputs:["../src/native-contract.mjs","../src/native-contract-service.mjs","../src/rpc.mjs"].map(relative=>({relative,sha256:createHash("sha256").update(readFileSync(new URL(relative,import.meta.url))).digest("hex")})),
 notRun:["Full Wallet Main/shared SDK boot","Installed UI","Private account/signing","Deploy/write/transfer","Consensus finality verification","MONSTER"]},null,2));
