import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  checkCombinedArchive,linkRequiredSymbols,productTransportRequiredSymbols,
  shopArchiveRole,shopBorrowSymbols,shopNativeRequiredSymbols,shopRequiredSymbols,
} from './combined-archive-symbols.mjs';

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

// Structural Mach-O fixtures. The gate must read actual object symbols even
// when the source declarations and the Native receipt agree with each other.
test('original Shop role binds Go13, actual Native11 and its two outside borrow providers',()=>{
  const base=process.env.YNX_LINK_DEPLOYMENT_TEST_ARTIFACTS??os.tmpdir();
  const out=fs.mkdtempSync(path.join(base,'shop-symbol-controls-'));
  const controls=[],commands=[];
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const pin=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:sha(b)};};
  const put=(name,bytes)=>{
    const file=path.join(out,name);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,bytes,{flag:'wx'});
    return pin(file);
  };
  function run(tool,args){
    const r=spawnSync(tool,args,{encoding:'utf8',timeout:30000});
    const sequence=String(commands.length).padStart(2,'0');
    put(sequence+'.stdout',r.stdout??'');
    put(sequence+'.stderr',r.stderr??'');
    commands.push({tool,args,status:r.status});
    assert.equal(r.error,undefined);
    assert.equal(r.status,0,r.stderr);
  }
  function object(name,{definitions=[],undefineds=[],weak}={}){
    const source=put(name+'.c',[
      ...definitions.map(n=>(n===weak?'__attribute__((weak)) ':'')+'void '+n+'(void) {}'),
      ...undefineds.map(n=>'extern void '+n+'(void);'),
      ...(undefineds.length?['void call_imports(void) { '+undefineds.map(n=>n+'();').join(' ')+' }']:[]),
    ].join('\n')+'\n');
    const target=path.join(out,name);
    run('/usr/bin/clang',['-c',source.path,'-o',target]);
    return pin(target);
  }
  function control(name,fn){fn();controls.push(name);}

  const acquire='ynx_auth_shop_original_client_acquire_v1';
  const constraints='ynx_auth_shop_original_client_constraints_v1';
  const drain='ynx_auth_shop_original_response_drain_pending_v1';
  const proof='ynx_auth_shop_original_client_read_with_proof_v1';
  const baseShop=shopRequiredSymbols.filter(n=>![constraints,drain,proof].includes(n));
  const sourceAssignments={
    'shop_private_client_cgo.go':[...baseShop,drain],
    'shop_source_constraints_cgo.go':[constraints],
    'shop_proof_carrier_cgo.go':[proof],
  };
  const sources=Object.entries(sourceAssignments).map(([file,names])=>put(file,names.map(n=>'//export '+n).join('\n')+'\n'));
  const headerAssignments={
    'ShopOriginalPrivateClient.h':baseShop,
    'ShopOwnedExchangePrivate.h':[drain],
    'ShopSourceConstraintsPrivate.h':[constraints],
    'ShopProofCarrierPrivate.h':[proof,...shopBorrowSymbols],
  };
  const shopHeaders=Object.entries(headerAssignments).map(([name,names])=>({name,...put(name,
    names.map(n=>(n===acquire?'ynx_auth_shop_acquisition_v1 ':'ynx_auth_shop_status_v1 ')+n+'(void);').join('\n')+'\n')}));
  const core=['YNXAccountInitialSignV1','YNXTransactionBatchSignV1'];
  const coreSources=[put('core.go',core.map(n=>'//export '+n).join('\n')+'\n')];
  const headers=['account_initial.h','tx_batch.h'].map((name,i)=>({owner:'core',name,...put(name,'int32_t '+core[i]+'(void);\n')}));
  const caller=path.resolve(import.meta.dirname,'../ynx-secure-link-caller');
  for(const name of ['private_client_v1.h','private_client_startup_v1.h'])headers.push({owner:'link',name,...pin(path.join(caller,name))});
  const nativeUndefined=[put('core-undefined.txt','_'+core[0]+'\n')];
  const arch=process.arch==='arm64'?'arm64':'amd64';
  const mandatory=[...core,...linkRequiredSymbols,'crosscall2','_cgo_topofstack','_rt0_'+arch+'_darwin_lib'];
  function archive(label,{missing,weak,extra=[],undefineds=shopBorrowSymbols,duplicate}={}){
    const go=object(label+'/go.o',{definitions:[...mandatory,...shopRequiredSymbols,...extra].filter(n=>n!==missing),undefineds,weak});
    const members=[go.path];
    if(duplicate)members.push(object(label+'/duplicate.o',{definitions:[duplicate]}).path);
    const target=path.join(out,label,'combined.a');
    run('/usr/bin/ar',['rcs',target,...members]);
    return pin(target);
  }
  const realArchive=archive('exact');
  const nativeObject=object('native/legacy-objects.o',{definitions:shopBorrowSymbols,undefineds:shopNativeRequiredSymbols});
  const borrowObject=object('native/ShopProofLoan.o',{definitions:shopBorrowSymbols});
  const definitions=Object.fromEntries(Object.entries(sourceAssignments).flatMap(([file,names])=>names.map(n=>[n,'source/productreadsource/'+file])));
  function receipt(label,combined,borrow,imports=shopNativeRequiredSymbols){
    return put(label+'/RESULT.json',JSON.stringify({combined,objects:[borrow],authGoImports:imports.map(n=>'_'+n),authGoExportSourceDefinitions:definitions}));
  }
  const shop={role:shopArchiveRole,sources,headers:shopHeaders,nativeObject,borrowObject,nativeUndefined:receipt('native',nativeObject,borrowObject)};
  const plan={version:1,goArchives:[realArchive],linkerInputs:[realArchive,borrowObject],coreSources,headers,nativeUndefined,shop};
  function withArchive(entry){return {...plan,goArchives:[entry],linkerInputs:[entry,borrowObject]};}
  try{
    control('exact source/headers and actual Mach-O matrix',()=>{
      const result=checkCombinedArchive(plan);
      assert.equal(result.shopRole,shopArchiveRole);
      assert.deepEqual(result.shopExports,shopRequiredSymbols);
      assert.deepEqual(result.shopNativeObservedGoReferences,shopNativeRequiredSymbols);
      assert.deepEqual(result.shopArchiveBorrowUndefinedReferences,shopBorrowSymbols.map(symbol=>({symbol,undefinedReferences:1})));
      assert.equal(result.symbols.length,37);
      assert.equal(result.symbols.find(s=>s.symbol===proof).header.name,'ShopProofCarrierPrivate.h');
      assert.equal(result.finalNativeImageVerified,false);
    });
    control('explicit Shop selection required',()=>assert.throws(()=>checkCombinedArchive({...plan,shop:undefined}),/unselected.*Shop/));
    control('missing or weak Shop T',()=>{
      assert.throws(()=>checkCombinedArchive(withArchive(archive('missing',{missing:proof}))),/missing.*Shop/);
      assert.throws(()=>checkCombinedArchive(withArchive(archive('weak',{weak:proof}))),/weak.*read_with_proof/);
    });
    control('duplicate Shop T',()=>assert.throws(()=>checkCombinedArchive(withArchive(archive('duplicate',{duplicate:proof}))),/extra.*Shop/));
    control('missing C++ borrow U',()=>assert.throws(()=>checkCombinedArchive(withArchive(archive('missing-borrow-u',{undefineds:[shopBorrowSymbols[0]]}))),/expected Shop undefined/));
    control('Go cannot supply the C++ borrow provider',()=>assert.throws(()=>checkCombinedArchive(withArchive(
      archive('wrong-borrow-owner',{extra:[shopBorrowSymbols[1]],undefineds:[shopBorrowSymbols[0]]}))),/extra.*Shop/));
    control('Native eleven checked against actual U rather than receipt alone',()=>{
      const wrong=object('wrong-native/legacy-objects.o',{definitions:shopBorrowSymbols,undefineds:shopNativeRequiredSymbols.slice(1)});
      assert.throws(()=>checkCombinedArchive({...plan,shop:{...shop,nativeObject:wrong,nativeUndefined:receipt('wrong-native',wrong,borrowObject)}}),/actual Native Shop object must import exactly/);
    });
    control('Native borrow must be strong in the original object',()=>{
      const wrong=object('weak-borrow/ShopProofLoan.o',{definitions:shopBorrowSymbols,weak:shopBorrowSymbols[0]});
      assert.throws(()=>checkCombinedArchive({...plan,linkerInputs:[realArchive,wrong],shop:{...shop,borrowObject:wrong,nativeUndefined:receipt('weak-borrow',nativeObject,wrong)}}),/weak.*borrow_current/);
    });
    control('source and header closures cannot shrink or change owners',()=>{
      assert.throws(()=>checkCombinedArchive({...plan,shop:{...shop,sources:sources.slice(1)}}),/all three/);
      assert.throws(()=>checkCombinedArchive({...plan,shop:{...shop,headers:shopHeaders.slice(1)}}),/all four/);
      const replacement={name:'ShopProofCarrierPrivate.h',...put('wrong-header/ShopProofCarrierPrivate.h',
        'ynx_auth_shop_status_v1 '+proof+'(void);\n')};
      assert.throws(()=>checkCombinedArchive({...plan,shop:{...shop,headers:[...shopHeaders.slice(0,-1),replacement]}}),/exact original Shop header/);
    });
    control('one actual borrow linker input with no additional provider',()=>{
      assert.throws(()=>checkCombinedArchive({...plan,linkerInputs:[realArchive]}),/ShopProofLoan object must occur exactly once/);
      assert.throws(()=>checkCombinedArchive({...plan,linkerInputs:[realArchive,borrowObject,borrowObject]}),/ShopProofLoan object must occur exactly once/);
      assert.throws(()=>checkCombinedArchive({...plan,linkerInputs:[realArchive,borrowObject,nativeObject]}),/combined Native Shop evidence/);
      const extra=object('second-provider.o',{definitions:[shopBorrowSymbols[0]]});
      assert.throws(()=>checkCombinedArchive({...plan,linkerInputs:[realArchive,borrowObject,extra]}),/additional Shop provider/);
    });
    control('Native receipt pin and one-archive gate still apply',()=>{
      assert.throws(()=>checkCombinedArchive({...plan,shop:{...shop,nativeUndefined:{...shop.nativeUndefined,sha256:'0'.repeat(64)}}}),/input changed/);
      assert.throws(()=>checkCombinedArchive({...plan,goArchives:[realArchive,realArchive]}),/exactly one/);
    });
  }finally{
    put('RESULT.json',JSON.stringify({controls,commands,structuralFixturesOnly:true,actualCompilerAndNm:true,actualGoRuntime:false,
      finalNativeImageVerified:false,SourceAdmission:false,RootAdmission:false},null,2)+'\n');
    console.log('Retained Shop symbol controls: '+out);
  }
});
