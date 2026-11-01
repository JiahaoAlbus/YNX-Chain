// PUBLIC subprocess fixture. Original official SDK digest/journal is bundled by CI.
import {readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createMutationIntents} from '../mutation-intents.js';
import {runListingCLI} from '../native/listing-cli.mjs';
const input=JSON.parse(readFileSync(0,'utf8'));let rows={};try{rows=JSON.parse(readFileSync(input.journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
function save(){const path=input.journal+'.tmp';writeFileSync(path,JSON.stringify(rows),{mode:0o600});const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(path,input.journal);}
const storage={getItem:k=>rows[k]??null,setItem:(k,v)=>{rows[k]=v;save();},removeItem:k=>{delete rows[k];save();}},account=()=>input.actor;
let writes=0,lookups=0,reads=0;
async function api(path,request){
 if(input.command==='recover'&&path!=='/seller/mutations/lookup')throw Error('PUBLIC recovery attempted publication');
 request.beforeDispatch?.();if(path.endsWith('/native-listing'))writes++;else if(path==='/seller/mutations/lookup')lookups++;else reads++;
 const response=await fetch(input.origin+'/api'+path,{method:request.method,headers:{'Content-Type':'application/json','X-QA-Business-Nonce':randomBytes(32).toString('base64url')},body:request.body,redirect:'error'});
 const value=await response.json();if(!response.ok)throw Object.assign(Error('PUBLIC original HTTP refusal'),{status:response.status});
 if(input.command==='publish')throw Error('PUBLIC lost publication response');return value;
}
try{const result=await runListingCLI({...input,account,current(){},api,intents:createMutationIntents(account,{storage,withLock:async(_,work)=>work()})});process.stdout.write(JSON.stringify({...result,writes,lookups,reads}));}
catch(error){if(error.message==='PUBLIC lost publication response')process.stdout.write(JSON.stringify({unknown:true,writes,lookups,reads}));else if(input.expectedFailure)process.stdout.write(JSON.stringify({rejected:true,code:error.code??'',status:error.status??0,writes,lookups,reads}));else throw error;}
