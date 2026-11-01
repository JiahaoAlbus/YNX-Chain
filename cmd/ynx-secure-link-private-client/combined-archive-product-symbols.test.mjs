import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkCombinedArchive,linkRequiredSymbols,productTransportRequiredSymbols} from './combined-archive-symbols.mjs';

// Compiler fixtures verify only the new Product export gate. No synthetic
// implementation here is a Source, Go runtime or normal client integration.
test('dedicated Product header requires all eight distinct strong exports',()=>{
  const base=process.env.YNX_LINK_DEPLOYMENT_TEST_ARTIFACTS??os.tmpdir();
  const out=fs.mkdtempSync(path.join(base,'product-symbol-controls-'));
  const commands=[],controls=[];
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const pin=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:sha(b)};};
  const put=(n,b)=>{const p=path.join(out,n);fs.writeFileSync(p,b,{flag:'wx'});return pin(p);};
  function run(tool,args){
    const r=spawnSync(tool,args,{encoding:'utf8',timeout:30000});
    const n=String(commands.length).padStart(2,'0');
    fs.writeFileSync(path.join(out,n+'.stdout'),r.stdout??'',{flag:'wx'});
    fs.writeFileSync(path.join(out,n+'.stderr'),r.stderr??'',{flag:'wx'});
    commands.push({tool,args,status:r.status});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  }
  const core=['YNXAccountInitialSignV1','YNXTransactionBatchSignV1'];
  const coreSource=put('exports.go',core.map(n=>'//export '+n).join('\n')+'\n');
  const headers=core.map((n,i)=>({owner:'core',name:i?'tx_batch.h':'account_initial.h',...put(i?'tx_batch.h':'account_initial.h','int32_t '+n+'(void);\n')}));
  const caller=path.resolve(import.meta.dirname,'../ynx-secure-link-caller');
  for(const name of ['private_client_v1.h','private_client_startup_v1.h'])headers.push({owner:'link',name,...pin(path.join(caller,name))});
  const product={owner:'product',name:'product_pay_transport_private.h',...put('product_pay_transport_private.h',
    [...productTransportRequiredSymbols.map(n=>(n.includes('release_response')?'void ':'int32_t ')+n+'(void);'),
      'int32_t ynx_product_pay_source_retain_v1(void);'].join('\n')+'\n')};
  const observed=put('native-undefined.txt','_YNXAccountInitialSignV1\n_ynx_product_pay_transport_request_v1\n');
  const names=[...core,...linkRequiredSymbols,...productTransportRequiredSymbols];
  const arch=process.arch==='arm64'?'arm64':'amd64';
  const runtime=['crosscall2','_cgo_topofstack','_rt0_'+arch+'_darwin_lib'];
  function plan(label,{missing='',weak='',extra=''}={}){
    const dir=path.join(out,label);fs.mkdirSync(dir);
    const source=path.join(dir,'fixture.c'),object=path.join(dir,'go.o'),archive=path.join(dir,'fixture.a');
    fs.writeFileSync(source,[...names,...runtime,...(extra?[extra]:[])].filter(n=>n!==missing).map(n=>(n===weak?'__attribute__((weak)) ':'')+'void '+n+'(void) {}').join('\n')+'\n',{flag:'wx'});
    run('/usr/bin/clang',['-c',source,'-o',object]);run('/usr/bin/ar',['rcs',archive,object]);
    return{version:1,goArchives:[pin(archive)],linkerInputs:[pin(archive)],coreSources:[coreSource],headers:[...headers,product],nativeUndefined:[observed]};
  }
  try{
    const valid=plan('complete');const result=checkCombinedArchive(valid);
    assert.deepEqual(result.productExports,[...productTransportRequiredSymbols].sort());
    assert.equal(result.symbols.length,32);assert(!result.productExports.includes('ynx_product_pay_source_retain_v1'));
    controls.push('complete-eight-and-excludes-Auth-owned-source-callee');
    assert.throws(()=>checkCombinedArchive(plan('missing',{missing:productTransportRequiredSymbols[2]})),/missing\/weak\/undefined\/duplicate/);
    controls.push('missing-new-diagnostics-rejected');
    assert.throws(()=>checkCombinedArchive(plan('weak',{weak:productTransportRequiredSymbols[1]})),/missing\/weak\/undefined\/duplicate/);
    controls.push('weak-new-request-rejected');
    assert.throws(()=>checkCombinedArchive({...valid,headers:headers}),/LINK\/Product reference has no ABI header/);
    controls.push('observed-product-without-original-header-rejected');
    assert.throws(()=>checkCombinedArchive(plan('hidden-setter',{extra:'ynx_product_pay_transport_install_v1'})),/unlisted Product transport archive export/);
    controls.push('unlisted-ninth-installer-rejected');
    assert.throws(()=>checkCombinedArchive(plan('source-provider',{extra:'ynx_product_pay_source_retain_v1'})),/Auth-owned Product Source definition/);
    controls.push('Auth-owned-source-provider-in-Go-archive-rejected');
  }finally{
    fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({commands,controls,normalRuntime:false,SourceAdmission:false,RootAdmission:false},null,2)+'\n',{flag:'wx'});
    console.log('Retained Product symbol controls: '+out);
  }
});
