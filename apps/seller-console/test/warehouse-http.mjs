// PUBLIC two-process integration fixture, never production custody/storage.
import {readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createMutationIntents} from '../mutation-intents.js';
import {runWarehouseCLI} from '../native/warehouse-cli.mjs';
const t=JSON.parse(readFileSync(0,'utf8'));let rows={};try{rows=JSON.parse(readFileSync(t.journal,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
function save(){const p=t.journal+'.tmp';writeFileSync(p,JSON.stringify(rows),{mode:0o600});const fd=openSync(p,'r');try{fsyncSync(fd)}finally{closeSync(fd)}renameSync(p,t.journal)}
const storage={getItem:k=>rows[k]??null,setItem:(k,v)=>{rows[k]=v;save()},removeItem:k=>{delete rows[k];save()}},account=()=>t.actor;
const recovering=t.command.startsWith('recover-');
async function api(path,r){
 if(recovering&&path!=='/seller/mutations/lookup')throw Error('PUBLIC recovery mutated');r.beforeDispatch?.();
 const response=await fetch(t.origin+'/api'+path,{method:r.method,headers:{'Content-Type':'application/json','X-QA-Business-Nonce':randomBytes(32).toString('base64url')},body:r.body,redirect:'error'});
 const value=await response.json();if(!response.ok)throw Error('PUBLIC HTTP '+response.status+' '+JSON.stringify(value));if(!recovering)throw Error('PUBLIC lost response');return value;
}
try{const result=await runWarehouseCLI({...t,account,current(){},api,intents:createMutationIntents(account,{storage,withLock:async(_,work)=>work()})});process.stdout.write(JSON.stringify(result))}
catch(error){if(recovering||error.message!=='PUBLIC lost response')throw error;process.stdout.write(JSON.stringify({unknown:true}))}
