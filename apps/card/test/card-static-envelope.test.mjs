import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCardStaticEnvelope,envelopeArguments} from '../scripts/card-static-envelope.mjs';
import {verifyStaticArtifacts} from '../scripts/verify-static-artifacts.mjs';

function fixture(){
  const root=mkdtempSync(resolve(tmpdir(),'card-envelope-gate-')),source=resolve(root,'web'),target=resolve(root,'candidate');
  mkdirSync(source);
  const config={buildCommand:'npm run build:web',outputDirectory:'dist-web',headers:[{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'}]}],rewrites:[{source:'/api/card/v1/:path*',destination:'https://api.ynxweb4.com/api/card/v1/:path*'},{source:'/api/card/v2/:path*',destination:'https://api.ynxweb4.com/api/card/v2/:path*'},{source:'/wallet-auth/callback',destination:'/'}]};
  writeFileSync(resolve(root,'vercel.json'),JSON.stringify(config));
  writeFileSync(resolve(root,'static-deploy-package.json'),JSON.stringify({name:'card-static-test',private:true}));
  const sourceCommit='a'.repeat(40),sourceTree='b'.repeat(40);
  writeFileSync(resolve(source,'runtime-identity.json'),JSON.stringify({productId:'ynx-card',environment:'testnet',productionRealPayments:false,sourceCommit,sourceTree,cardApiCompatibility:{frontendSourceCommit:sourceCommit,frontendSourceTree:sourceTree,backendSourceCommit:sourceCommit}}));
  writeFileSync(resolve(source,'index.html'),'<html lang="en">Testnet</html>');
  return {root,source,target};
}
test('nested envelope exact files pass dependency-free remote build',()=>{
  const f=fixture();createCardStaticEnvelope(f.root,f.source,f.target);
  assert.equal(verifyStaticArtifacts(f.target),5);
  assert.match(execFileSync(process.execPath,['build-static.mjs'],{cwd:f.target,encoding:'utf8'}),/CARD_EXACT_STATIC_ENVELOPE_PASS 5/);
  assert.throws(()=>createCardStaticEnvelope(f.root,f.source,f.target),/OUTPUT_EXISTS/);
});
test('missing, additional and mutated artifacts fail closed',()=>{
  for(const change of ['missing','additional','mutated']){
    const f=fixture();createCardStaticEnvelope(f.root,f.source,f.target);
    const file=resolve(f.target,'dist-web/index.html');
    if(change==='missing')unlinkSync(file);
    else writeFileSync(change==='additional'?resolve(f.target,'dist-web/unknown.js'):file,'changed');
    assert.throws(()=>verifyStaticArtifacts(f.target),/MISMATCH/);
  }
});
test('config formatting is harmless but routes and security values are pinned',()=>{
  const f=fixture();createCardStaticEnvelope(f.root,f.source,f.target);
  const path=resolve(f.target,'vercel.json'),config=JSON.parse(readFileSync(path,'utf8'));
  writeFileSync(path,JSON.stringify(config,null,4));assert.equal(verifyStaticArtifacts(f.target),5);
  config.headers[0].headers[0].value='unsafe';writeFileSync(path,JSON.stringify(config));
  assert.throws(()=>verifyStaticArtifacts(f.target),/CONFIG_MISMATCH/);
  config.headers[0].headers[0].value='nosniff';config.rewrites[0].destination='https://hostile.example/';writeFileSync(path,JSON.stringify(config));
  assert.throws(()=>verifyStaticArtifacts(f.target),/CONFIG_MISMATCH/);
});
test('source and output symlinks cannot enter the immutable envelope',()=>{
  const f=fixture();symlinkSync(resolve(f.source,'index.html'),resolve(f.source,'alias.html'));
  assert.throws(()=>createCardStaticEnvelope(f.root,f.source,f.target),/SYMLINK/);
  unlinkSync(resolve(f.source,'alias.html'));createCardStaticEnvelope(f.root,f.source,f.target);
  symlinkSync(resolve(f.target,'dist-web/index.html'),resolve(f.target,'dist-web/alias.html'));
  assert.throws(()=>verifyStaticArtifacts(f.target),/SYMLINK/);
});
test('invalid identity, routes and CLI options fail closed',()=>{
  const f=fixture();
  assert.throws(()=>envelopeArguments(['--unknown'],f.root),/ARGUMENT/);
  assert.throws(()=>envelopeArguments(['--source-dir=a','--source-dir=b'],f.root),/ARGUMENT/);
  assert.equal(envelopeArguments(['--output-dir=new'],f.root).envelope,resolve(f.root,'new'));
  const path=resolve(f.source,'runtime-identity.json'),identity=JSON.parse(readFileSync(path,'utf8'));identity.productionRealPayments=true;writeFileSync(path,JSON.stringify(identity));
  assert.throws(()=>createCardStaticEnvelope(f.root,f.source,f.target),/IDENTITY/);
  identity.productionRealPayments=false;identity.cardApiCompatibility.productionRealPayments=true;writeFileSync(path,JSON.stringify(identity));
  assert.throws(()=>createCardStaticEnvelope(f.root,f.source,f.target),/IDENTITY/);
});
