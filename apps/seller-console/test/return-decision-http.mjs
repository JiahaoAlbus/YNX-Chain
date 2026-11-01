// PUBLIC actual subprocess control; production has no JSON transport/role factory.
import {readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createMutationIntents} from '../mutation-intents.js';
import {runReturnDecisionCLI} from '../native/return-decision-cli.mjs';
const input=JSON.parse(readFileSync(0,'utf8'));let rows={};try{rows=JSON.parse(readFileSync(input.journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
function save(){const path=input.journal+'.tmp';writeFileSync(path,JSON.stringify(rows),{mode:0o600});const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(path,input.journal);}
const storage={getItem:k=>rows[k]??null,setItem:(k,v)=>{rows[k]=v;save();},removeItem:k=>{delete rows[k];save();}},account=()=>input.actor;let writes=0,lookups=0,reads=0;
async function api(path,r){if(input.command.startsWith('recover-')&&path!=='/seller/mutations/lookup')throw Error('PUBLIC recovery read/write replacement');r.beforeDispatch?.();if(r.method==='GET')reads++;else if(path==='/seller/mutations/lookup')lookups++;else writes++;
 const response=await fetch(input.origin+'/api'+path,{method:r.method,headers:{'Content-Type':'application/json','X-QA-Business-Nonce':randomBytes(32).toString('base64url')},body:r.body,redirect:'error'}),value=await response.json();if(!response.ok)throw Object.assign(Error('PUBLIC original refusal'),{status:response.status});if(path.endsWith('/transition'))throw Error('PUBLIC lost return decision');return value;}
try{const result=await runReturnDecisionCLI({...input,account,current(){},api,intents:createMutationIntents(account,{storage,withLock:async(_,work)=>work()})});process.stdout.write(JSON.stringify({...result,writes,lookups,reads}));}
catch(error){if(error.message==='PUBLIC lost return decision')process.stdout.write(JSON.stringify({unknown:true,writes,lookups,reads}));else if(input.expectedFailure)process.stdout.write(JSON.stringify({rejected:true,code:error.code??'',status:error.status??0,writes,lookups,reads}));else throw error;}
