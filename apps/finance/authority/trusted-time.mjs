import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

export const FINANCE_TRUSTED_TIME_URL='https://wallet-auth.ynxweb4.com/v2/product-sessions/time';
const MAX_RTT_MS=2000,MAX_CLOCK_AGE_MS=3000;
const fail=code=>{throw new Error(code)};

async function protectedDirectory(directory){
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||await fs.realpath(directory)!==directory)fail('FINANCE_AUTHORITY_V2_CLOCK_DIRECTORY_INVALID');
  let current=directory;
  while(true){
    const stat=await fs.lstat(current),mode=stat.mode&0o777;
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0&&stat.uid!==process.geteuid()||(mode&0o022)!==0)fail('FINANCE_AUTHORITY_V2_CLOCK_DIRECTORY_INVALID');
    if(current===directory&&(stat.uid!==process.geteuid()||mode!==0o700))fail('FINANCE_AUTHORITY_V2_CLOCK_DIRECTORY_INVALID');
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}

async function readHighWater(file){
  let handle;
  try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW)}catch(error){if(error?.code==='ENOENT')return null;throw error}
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.geteuid()||(stat.mode&0o777)!==0o600||stat.size<1||stat.size>256)fail('FINANCE_AUTHORITY_V2_CLOCK_FILE_INVALID');
    const bytes=await handle.readFile();if(bytes.length!==stat.size)fail('FINANCE_AUTHORITY_V2_CLOCK_FILE_CHANGED');
    let value;try{value=JSON.parse(bytes.toString('utf8'))}catch{fail('FINANCE_AUTHORITY_V2_CLOCK_FILE_INVALID')}
    if(!value||Object.keys(value).sort().join(',')!=='schemaVersion,unixTimeMs'||value.schemaVersion!=='ynx-trusted-time/v1'||!Number.isSafeInteger(value.unixTimeMs)||value.unixTimeMs<0)fail('FINANCE_AUTHORITY_V2_CLOCK_FILE_INVALID');
    return {value:value.unixTimeMs,identity:{dev:stat.dev,ino:stat.ino,size:stat.size}};
  }finally{await handle.close()}
}

async function advanceHighWater(file,sample){
  if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('FINANCE_AUTHORITY_V2_CLOCK_PATH_INVALID');
  const directory=path.dirname(file);await protectedDirectory(directory);
  const lock=file+'.lock';let handle;
  for(let attempt=0;attempt<20;attempt++){
    try{handle=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);await handle.writeFile(JSON.stringify({schemaVersion:'ynx-trusted-time-lock/v1',pid:process.pid})+'\n');await handle.sync();break}
    catch(error){
      if(error?.code!=='EEXIST')throw error;
      let stale=null;
      try{
        const candidate=await fs.open(lock,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{const stat=await candidate.stat();if(stat.isFile()&&stat.nlink===1&&stat.uid===process.geteuid()&&(stat.mode&0o777)===0o600&&stat.size>0&&stat.size<=256){const value=JSON.parse((await candidate.readFile()).toString('utf8'));if(value.schemaVersion==='ynx-trusted-time-lock/v1'&&Number.isSafeInteger(value.pid)&&value.pid>0){try{process.kill(value.pid,0)}catch(check){if(check?.code==='ESRCH')stale={dev:stat.dev,ino:stat.ino}}}}}finally{await candidate.close()}
      }catch(check){if(check?.code!=='ENOENT')stale=null}
      if(stale){const observed=await fs.lstat(lock);if(observed.dev===stale.dev&&observed.ino===stale.ino&&!observed.isSymbolicLink())await fs.unlink(lock);continue}
      if(attempt===19)fail('FINANCE_AUTHORITY_V2_CLOCK_STORE_BUSY');await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
  const lockStat=await handle.stat();let temporary;
  try{
    const prior=await readHighWater(file);
    if(prior&&sample<prior.value)fail('AUTHORITY_V2_CLOCK_ROLLBACK');
    if(!prior||sample>prior.value){
      temporary=path.join(directory,`.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
      const output=await fs.open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      try{await output.writeFile(JSON.stringify({schemaVersion:'ynx-trusted-time/v1',unixTimeMs:sample})+'\n');await output.sync()}finally{await output.close()}
      const observed=await readHighWater(file);
      if((prior===null)!==(observed===null)||prior&&(!observed||prior.identity.dev!==observed.identity.dev||prior.identity.ino!==observed.identity.ino||prior.identity.size!==observed.identity.size))fail('FINANCE_AUTHORITY_V2_CLOCK_FILE_CHANGED');
      await fs.rename(temporary,file);temporary=undefined;
      const dirHandle=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await dirHandle.sync()}finally{await dirHandle.close()}
    }
    await protectedDirectory(directory);
    const final=await readHighWater(file);if(!final||final.value!==sample)fail('FINANCE_AUTHORITY_V2_CLOCK_FILE_CHANGED');
  }finally{
    if(temporary)await fs.unlink(temporary).catch(error=>{if(error?.code!=='ENOENT')throw error});
    await handle.close();
    const current=await fs.lstat(lock).catch(error=>{if(error?.code==='ENOENT')return null;throw error});
    if(!current||current.dev!==lockStat.dev||current.ino!==lockStat.ino)fail('FINANCE_AUTHORITY_V2_CLOCK_LOCK_CHANGED');
    await fs.unlink(lock);
  }
}

/** The fixed Wallet Auth origin is a bootstrap trust dependency, never chosen
 * from the manifest being verified. No device wall-clock value is accepted. */
export async function sampleFinanceTrustedClock(file,{fetchImpl=globalThis.fetch,monotonic=()=>performance.now()}={}){
  if(typeof fetchImpl!=='function'||typeof monotonic!=='function')fail('FINANCE_AUTHORITY_V2_CLOCK_SOURCE_INVALID');
  const requestId='req_'+randomUUID().replaceAll('-',''),started=monotonic();
  const controller=new AbortController();let timeout,reader;
  const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('FINANCE_AUTHORITY_V2_CLOCK_STALE'))},MAX_RTT_MS)});
  let response,raw='',received,rtt;
  try{
    response=await Promise.race([fetchImpl(FINANCE_TRUSTED_TIME_URL,{method:'GET',headers:{accept:'application/json','x-request-id':requestId},cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),deadline]);
    if(response?.status!==200||response.redirected||response.headers?.get('x-request-id')!==requestId||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers?.get('content-type')??'')||!/(^|,)\s*no-store\s*(,|$)/i.test(response.headers?.get('cache-control')??''))fail('FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID');
    reader=response.body?.getReader();if(!reader)fail('FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID');
    const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0;
    while(true){const chunk=await Promise.race([reader.read(),deadline]);if(chunk.done)break;if(!(chunk.value instanceof Uint8Array))fail('FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID');bytes+=chunk.value.byteLength;if(bytes>2048)fail('FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID');raw+=decoder.decode(chunk.value,{stream:true})}
    raw+=decoder.decode();received=monotonic();rtt=received-started;
  }catch(error){if(/^FINANCE_AUTHORITY_V2_CLOCK_(?:STALE|RESPONSE_INVALID)$/u.test(error?.message||''))throw error;fail('FINANCE_AUTHORITY_V2_CLOCK_UNAVAILABLE')}
  finally{clearTimeout(timeout);if(reader)reader.cancel().catch(()=>{})}
  if(!Number.isFinite(started)||!Number.isFinite(received)||rtt<0||rtt>MAX_RTT_MS)fail('FINANCE_AUTHORITY_V2_CLOCK_STALE');
  let body;try{body=JSON.parse(raw)}catch{fail('FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID')}
  const stamp=body?.result?.serverTime,parsed=typeof stamp==='string'?Date.parse(stamp):NaN;
  if(!body||Object.keys(body).sort().join(',')!=='ok,requestId,result,schemaVersion'||body.ok!==true||body.requestId!==requestId||body.schemaVersion!==2||!body.result||Object.keys(body.result).join(',')!=='serverTime'||!Number.isSafeInteger(parsed)||new Date(parsed).toISOString()!==stamp)fail('FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID');
  await advanceHighWater(file,parsed);
  let last=parsed;
  const clock=()=>{
    const elapsed=monotonic()-received;
    if(!Number.isFinite(elapsed)||elapsed<0||elapsed>MAX_CLOCK_AGE_MS)fail('FINANCE_AUTHORITY_V2_CLOCK_STALE');
    const now=parsed+Math.ceil(rtt)+Math.floor(elapsed);
    if(now<last)fail('AUTHORITY_V2_CLOCK_ROLLBACK');last=now;return now;
  };
  return Object.freeze({clock,lowerAtReceive:parsed,upperAtReceive:parsed+Math.ceil(rtt),sampleRTTMs:rtt});
}
