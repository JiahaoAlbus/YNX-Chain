// Local-only executable smoke test. No remote authority requests or credentials.
import {createServer} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [binary,webDir,commit]=process.argv.slice(2);
if(!binary?.startsWith('/tmp/ynx-finance-sdk-')||!webDir?.startsWith('/tmp/ynx-finance-sdk-')||!/^[a-f0-9]{40}$/.test(commit??''))throw Error('Exact local candidate paths and source required');
const state=await mkdtemp(join(tmpdir(),'ynx-finance-local-sdk-state-'));
const upstream=createServer((req,res)=>{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"explicit offline local fixture"}');});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const portProbe=createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
const receipts=[];
try{for(let launch=1;launch<=2;launch++){
  const child=spawn(binary,[],{env:{YNX_FINANCE_AUTH_MODE:'product-session-v2',YNX_FINANCE_STATE_PATH:join(state,'state.json'),YNX_EXPLORER_URL:`http://127.0.0.1:${upstream.address().port}`,YNX_FINANCE_DISPUTE_URL:'https://support.invalid/disputes',YNX_FINANCE_HELP_URL:'https://support.invalid/help',YNX_FINANCE_PRIVACY_URL:'https://support.invalid/privacy',YNX_FINANCE_CURSOR_SIGNING_KEY:'disposable-local-test-cursor-key-0001',YNX_FINANCE_OPERATIONS_KEY:'disposable-local-test-operations-0001',YNX_FINANCE_WEB_DIR:webDir,YNX_FINANCE_LISTEN:`127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();const exit=once(child,'exit');
  try{
    const base=`http://127.0.0.1:${port}`;let alive=false;
    for(let attempt=0;attempt<40;attempt++){try{const r=await fetch(base+'/health');if(r.ok){alive=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(alive,true,'local cold start');
    for(const path of ['/version','/health','/ready','/','/wallet-auth.js','/api/profile']){
      const r=await fetch(base+path),body=Buffer.from(await r.arrayBuffer());assert.equal(r.status,path==='/api/profile'?401:200);
      if(path==='/version')assert.equal(JSON.parse(body).commit,commit);
      if(path==='/api/profile')assert.equal(JSON.parse(body).code,'PROOF_REQUIRED');
      receipts.push({launch,path,status:r.status,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),mime:r.headers.get('content-type')});
    }
    const old=await fetch(base+'/wallet-gateway/v1/wallet/sessions/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(old.status,410);
  }finally{child.kill('SIGTERM');await exit;}
}}finally{await new Promise(resolve=>upstream.close(resolve));}
console.log(JSON.stringify({kind:'local-darwin-executable-only',source:commit,coldStart:true,secondLaunch:true,missingProofRejected:true,legacyIsolated:true,public:false,linuxExecuted:false,receipts},null,2));
