// PUBLIC integration driver only. No production Source/credential/storage.
import {readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createMutationIntents} from '../mutation-intents.js';
import {runInventoryBatchCLI} from '../native/inventory-batch-cli.mjs';
const test=JSON.parse(readFileSync(0,'utf8'));
let rows={};try{rows=JSON.parse(readFileSync(test.journal,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const save=()=>{const next=test.journal+'.tmp';writeFileSync(next,JSON.stringify(rows),{mode:0o600});const fd=openSync(next,'r');try{fsyncSync(fd)}finally{closeSync(fd)}renameSync(next,test.journal)};
const storage={getItem:k=>rows[k]??null,setItem:(k,v)=>{rows[k]=v;save()},removeItem:k=>{delete rows[k];save()}};
const account=()=>test.actor;
const api=async(path,request)=>{
 if(test.command==='recover'&&path!=='/seller/mutations/lookup')throw Error('PUBLIC recovery attempted mutation');
 request.beforeDispatch?.();
 const response=await fetch(test.origin+'/api'+path,{method:request.method,headers:{'Content-Type':'application/json','X-QA-Business-Nonce':randomBytes(32).toString('base64url')},body:request.body,redirect:'error'});
 const result=await response.json();if(!response.ok)throw Error('PUBLIC HTTP '+response.status+' '+JSON.stringify(result));
 if(test.command==='apply')throw Error('PUBLIC dropped original response');
 return result;
};
const intents=createMutationIntents(account,{storage,withLock:async(_,work)=>work()});
try{
 const result=await runInventoryBatchCLI({command:test.command,body:test.body,account,current(){},api,intents});
 if(test.command==='apply')throw Error('PUBLIC loss was not retained');
 process.stdout.write(JSON.stringify({recovered:true,result,remaining:Object.keys(rows).filter(k=>!k.endsWith(':revision')).length}));
}catch(error){
 if(test.command!=='apply'||error.message!=='PUBLIC dropped original response')throw error;
 process.stdout.write(JSON.stringify({unknown:true,remaining:Object.keys(rows).length}));
}
