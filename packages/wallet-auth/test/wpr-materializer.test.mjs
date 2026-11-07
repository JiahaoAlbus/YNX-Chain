// PUBLIC temporary-key DATA/math only; never an authority/Native constructor.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {materializeOriginalWalletProductPublicDATA as materialize,selectReviewedWalletProductMaterialization as normal} from '../src/original-wallet-product-materializer-data.js';
import {encodeOriginalAuthSourceStatementV2} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {createWalletProductSourceFixture} from './fixtures/wallet-product-source.fixture.mjs';
if(process.argv.includes('--cli-only')){const p=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/ynx-wallet-product-public-materialize.mjs',import.meta.url))],{encoding:'utf8',env:{...process.env,WPR_ROWS:'[{"approved":true}]'}});assert.equal(p.status,1);assert.match(p.stderr,/WPR_REVIEWED_PUBLIC_ORIGINAL_LOAN_NOT_SUPPLIED/);assert.equal(p.stdout,'');console.log('PASS zeroarg normal CLI ignores runtime rows; missing genuine public loan; keysOpened=false');process.exit(0);}
const f=await createWalletProductSourceFixture(),results=[];
const {canonical,sha}=f;
const run=(name,fn)=>{fn();results.push(name);console.log('PASS '+name);};
try{
 const nonce1=Buffer.alloc(32,7).toString('base64url'),nonce2=Buffer.alloc(32,8).toString('base64url');
 const originals={root:f.input.rootRaw,enrollment:f.input.enrollmentRaw,profile:f.input.profileRaw,acquisitionHead:f.input.headRaw,freshCurrent:f.current(nonce2)};
 const atMs=Date.now();const bytes=s=>Buffer.from(s),file=(path,s)=>({path,bytes:bytes(s).length,sha256:sha(s)});
 const buildOriginals={root:bytes(originals.root),enrollment:bytes(originals.enrollment),verifier:bytes('PUBLIC actual verifier byte fixture'),node:bytes('PUBLIC Node file fixture'),runtimeManifest:bytes('PUBLIC runtime manifest fixture'),dispatch:bytes('PUBLIC dispatch file fixture')};
 const build={root:file('/PUBLIC/root',originals.root),enrollment:file('/PUBLIC/enrollment',originals.enrollment),verifier:file('/PUBLIC/sdk/native/original-auth-identity-source-verifier.mjs',buildOriginals.verifier),node:file('/PUBLIC/node',buildOriginals.node),runtime:{proofContract:'YNX-AUTH-IDENTITY-PROOF-DATA/v1',packageRoot:'/PUBLIC/sdk',manifest:file('/PUBLIC/sdk/native/original-ide-auth-runtime-manifest.json',buildOriginals.runtimeManifest),dispatch:file('/PUBLIC/sdk/native/original-ide-auth-proof-dispatch.mjs',buildOriginals.dispatch)},nativeNode:{origin:'https://public.invalid',spki:'d'.repeat(64),nativeChainId:'6423'},applicationId:f.p.selection.association.applicationId,productId:'wallet',platform:'macos',uid:501,resourceDirectory:'/PUBLIC/product-originals'};
 const typed={version:'YNX-WALLET-PRODUCT-TYPED-BUILD-INPUT/v1',sourceId:f.p.sourceId,signatureContract:f.input.policy.signatureContract,...Object.fromEntries(['root','enrollment','verifier','node','runtime','nativeNode','applicationId','productId','platform','uid','resourceDirectory'].map(k=>[k,build[k]])),endpoint:f.e.endpoint,spki:f.e.spki};
 const approvals=['enrollment','profile'].map(role=>{const e=JSON.parse(originals[role]),bodyRaw=Buffer.from(e.body,'base64url').toString('utf8'),binding=Object.fromEntries(['networkId','owner','keyVersion','executionHeight'].map(k=>[k,e[k]]));const approvalRaw=canonical({version:'YNX-ORIGINAL-SOURCE-ISSUANCE-APPROVAL/v1',role,purpose:'AUTH-SOURCE-'+role.toUpperCase(),owner:e.owner,networkId:e.networkId,keyVersion:e.keyVersion,bodySHA256:sha(bodyRaw),messageSHA256:sha(encodeOriginalAuthSourceStatementV2(role,f.input.policy.signatureContract[role+'Frame'],binding,bodyRaw)),decision:'approved',issuedAtMs:atMs-100,expiresAtMs:atMs+10000});return{role,approvalRaw,approvalDigest:sha(approvalRaw)};});
 const input={originals,policy:f.input.policy,registrations:{acquisition:f.ctx.registrations,fresh:f.ctx.registrations},currentContext:{acquisitionNonce:nonce1,freshNonce:nonce2,previous:f.input.previous,atMs},approvals,build,independentBuildOriginal:canonical(typed),buildOriginals};
 const clone=()=>({...structuredClone(input),registrations:{acquisition:{...f.ctx.registrations},fresh:{...f.ctx.registrations}}}),reject=(v,rx)=>assert.throws(()=>materialize(v),rx);
 let output;
 run('PUBLIC full Root/profile/acquisition/fresh current registered N1 AND -> immutable DATA',()=>{output=materialize(input);assert.equal(output.RootAdmission,false);assert.equal(output.keysOpened,false);assert.equal(Object.isFrozen(output),true);assert.deepEqual(Object.keys(JSON.parse(output.typedBuildOriginal)).sort(),Object.keys(typed).sort());assert.equal(JSON.parse(output.manifestOriginal).observation.sequence,1);assert.equal(output.typedBuildOriginal.includes(nonce2),false);});
 run('caller mutation cannot alter captured immutable manifest/public originals',()=>{const before=output.manifestOriginal;input.buildOriginals.node.fill(0);assert.equal(output.manifestOriginal,before);input.buildOriginals.node=bytes('PUBLIC Node file fixture');});
 run('normal empty release refuses without IO or loader',()=>assert.throws(()=>normal(),/WPR_REVIEWED_PUBLIC_ORIGINAL_LOAN_NOT_SUPPLIED/));
 run('normal refuses runtime row/ENV style input',()=>assert.throws(()=>normal(input),/WPR_NORMAL_ZERO_ARGUMENTS_REQUIRED/));
 run('duplicate approval roles rejected',()=>{const v=clone();v.approvals[1]=v.approvals[0];reject(v,/WPR_MATERIALIZER_APPROVAL_PAIR/);});
 run('cross purpose rejected',()=>{const v=clone();v.policy.signatureContract.purpose='wallet-native-pay-client-source-v1';reject(v,/WPR_MATERIALIZER_PURPOSE/);});
 run('fresh nonce cannot reuse acquisition nonce',()=>{const v=clone();v.currentContext.freshNonce=nonce1;reject(v,/WPR_MATERIALIZER_FRESH_CONTEXT/);});
 run('independent wrong current registered role rejected',()=>{const v=clone();v.registrations.fresh.current=v.registrations.fresh.profile;reject(v,/AUTH_SOURCE|PQ_/);});
 run('expired original window rejected',()=>{const v=clone();v.currentContext.atMs+=1000000;reject(v,/EXPIRED/);});
 run('independent denied approval rejects without key access',()=>{const v=clone();const a=JSON.parse(v.approvals[1].approvalRaw);a.decision='denied';v.approvals[1].approvalRaw=canonical(a);v.approvals[1].approvalDigest=sha(v.approvals[1].approvalRaw);reject(v,/INDEPENDENT_APPROVAL_REQUIRED/);});
 run('foreign independent tuple rejects',()=>{const v=clone();const b=JSON.parse(v.independentBuildOriginal);b.applicationId='com.foreign.PUBLIC';v.independentBuildOriginal=canonical(b);reject(v,/WPR_MATERIALIZER_DATA_BINDING/);});
 run('same pin but altered actual byte closure rejects',()=>{const v=clone();v.buildOriginals.dispatch[0]^=1;reject(v,/WPR_MATERIALIZER_CLOSURE_BYTES_DIFFERS/);});
 run('duplicate physical input path rejects',()=>{const v=clone();v.build.node.path=v.build.verifier.path;reject(v,/WPR_MATERIALIZER_DUPLICATE_INPUT/);});
 run('canonical BOM original rejects before math',()=>{const v=clone();v.originals.root='\ufeff'+v.originals.root;reject(v,/WPR_MATERIALIZER_ORIGINAL_BYTES|NONCANONICAL/);});
 run('zeroarg normal CLI ignores no runtime rows and reports original missing loan',()=>{const p=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/ynx-wallet-product-public-materialize.mjs',import.meta.url))],{encoding:'utf8',env:{...process.env,WPR_ROWS:'[{"approved":true}]'}});assert.equal(p.status,1);assert.match(p.stderr,/WPR_REVIEWED_PUBLIC_ORIGINAL_LOAN_NOT_SUPPLIED/);assert.equal(p.stdout,'');});
 console.log(JSON.stringify({newControls:results.length,fullMath:'PUBLIC dual N1 original verifier',keysOpened:false,signaturesIssued:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false}));
}finally{f.close();}
