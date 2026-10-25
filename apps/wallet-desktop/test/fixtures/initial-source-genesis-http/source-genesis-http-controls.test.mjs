import test from'node:test';import assert from'node:assert/strict';import{readFileSync,writeFileSync,statSync}from'node:fs';import{createHash}from'node:crypto';
import{acquireOriginalWalletAccountInitialSource,isOriginalWalletAccountInitialSource}from'./src/original-policy-supplier/account-initial-source.mjs';
import{acquireOriginalWalletAccountInitialSource as noRelease}from'./src/original-policy-supplier/account-initial-source-no-release.mjs';
import{AccountInitialPermissionKernel}from'./src/original-policy-supplier/account-initial-permission-kernel.mjs';
import{routes,paths,calls}from'./src/mock-initial-https.mjs';import{encodePQRegistrationIntent}from'@ynx-chain/wallet-auth/pq-wallet-authorization';
const f=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url))),release=JSON.parse(readFileSync(new URL('./test-release.json',import.meta.url))),genesis=readFileSync(release.genesis.path),hash=b=>createHash('sha256').update(b).digest('hex'),genPath='/node/consensus-genesis',accountPath='/accounts/'+f.expected.owner+'/authorization';
function r(action='sign'){const now=Date.now();return{version:1,kind:'account-initial',action,purpose:'TX-BATCH',networkId:f.expected.chainId,nativeChainId:'6423',account:f.expected.owner,operationId:'PUBLIC-new-Genesis-'+action,origin:'ynx-wallet:local-pq',requestDigest:hash(encodePQRegistrationIntent(f.intent)),intent:{...f.intent},createdAt:new Date(now).toISOString(),expiresAt:new Date(now+20000).toISOString(),dataOnly:true,bootstrapAdmission:false,...(action==='broadcast'?{originalOperationId:'PUBLIC-original-sign',transportHash:f.transportHash,abciTransactionHash:f.abciTransactionHash,executionHeight:f.expected.executionHeight}:{})};}
function view(){const{accountBefore:v}=JSON.parse(readFileSync(new URL('./comet-fixture.json',import.meta.url)));Object.assign(v,{owner:f.expected.owner,networkId:f.expected.chainId,committedHeight:(BigInt(f.expected.executionHeight)-1n).toString(),executionHeight:f.expected.executionHeight,ledgerNonce:'0',authorizationStatus:'legacy',committedAuthorizationStatus:'legacy',pqSigningEnabled:false,committedPQSigningEnabled:false});Object.assign(v.policy,{networkId:f.expected.chainId,enableAt:'1',records:[]});if(v.policy.revocations)v.policy.revocations=[];return v;}
const headers=()=>({'content-type':'application/json','cache-control':'no-store','x-ynx-comet-genesis-sha256':hash(genesis),'x-ynx-observation-height':view().committedHeight});
function replies(gen={},account={}){return{[genPath]:{body:genesis,headers:headers(),...gen},[accountPath]:{body:JSON.stringify(view()),...account}};}
async function refused(q){let partial;await assert.rejects(q,e=>{partial=e.partial;return e.code==='AUTH_WALLET_INITIAL_SOURCE_NOT_SUPPLIED';});assert(partial);assert.equal(isOriginalWalletAccountInitialSource(partial),false);await partial.close();return partial;}
test('new Protocol raw Genesis route is consumed verbatim before same committed-H account response, no fallback',async()=>{
 routes(replies());const owner=await acquireOriginalWalletAccountInitialSource(r());assert.deepEqual(paths(),[genPath,accountPath]);const source=owner.readOriginal();assert.deepEqual(Buffer.from(source.genesisBytes),genesis);assert.equal(source.genesisSHA256,release.genesis.sha256);assert.equal(owner.genesisObservation().committedHeight,view().committedHeight);assert.equal(owner.genesisObservation().independentFinality,false);assert.equal(owner.genesisObservation().sourceGranted,false);source.genesisBytes.fill(0);assert.deepEqual(Buffer.from(owner.copyOriginalGenesisBytes()),genesis);await owner.close();
});
test('Genesis status/content/no-store/hash/height/encoding failures stop before owner GET, never local file fallback',async()=>{
 const cases=[{status:302},{status:404},{headers:{...headers(),'content-type':'text/html'}},{headers:{...headers(),'cache-control':'public'}},{headers:{...headers(),'x-ynx-comet-genesis-sha256':undefined}},{headers:{...headers(),'x-ynx-comet-genesis-sha256':hash(genesis).toUpperCase()}},{headers:{...headers(),'x-ynx-comet-genesis-sha256':'00'.repeat(32)}},{headers:{...headers(),'x-ynx-observation-height':'01'}},{headers:{...headers(),'x-ynx-observation-height':'0'}},{headers:{...headers(),'x-ynx-observation-height':['1','1']}},{headers:{...headers(),'content-encoding':'gzip'}},{headers:{...headers(),'content-length':String(genesis.length+1)}}];
 for(const c of cases){routes(replies(c));await refused(acquireOriginalWalletAccountInitialSource(r()));assert.deepEqual(paths(),[genPath]);}
});
test('remote self-consistent Genesis digest cannot replace independently admitted original pin/bytes',async()=>{
 const changed=Buffer.concat([genesis,Buffer.from('\n')]);routes(replies({body:changed,headers:{...headers(),'x-ynx-comet-genesis-sha256':hash(changed)}}));await refused(acquireOriginalWalletAccountInitialSource(r()));assert.deepEqual(paths(),[genPath]);
});
test('observation height binds committed H, not next execution H; drift fails without retry',async()=>{
 routes(replies({headers:{...headers(),'x-ynx-observation-height':view().executionHeight}}));await refused(acquireOriginalWalletAccountInitialSource(r()));assert.deepEqual(paths(),[genPath,accountPath]);
 routes(replies());const owner=await acquireOriginalWalletAccountInitialSource(r());routes(replies({headers:{...headers(),'x-ynx-observation-height':view().executionHeight}}));await assert.rejects(owner.recheck());assert.equal(calls(),2);assert.throws(()=>owner.readOriginal());assert.equal(owner.outcome().effectRetryAuthorized,false);await owner.close();
});
test('late Genesis response is retained before local expiry, cannot publish Source or start owner query',async()=>{
 const old=Date.now,base=old();let now=base;Date.now=()=>now;
 try{routes(replies({beforeEnd(){now+=21000;}}));const partial=await refused(acquireOriginalWalletAccountInitialSource(r()));assert.equal(partial.outcome().retainedGenesisResponseBytes,genesis.length);assert.equal(partial.outcome().firstCausePresent,true);assert.equal(calls(),1);}finally{Date.now=old;}
});
test('broadcast consumes exact same original H and Member alongside the new Genesis route',async()=>{
 routes(replies());const owner=await acquireOriginalWalletAccountInitialSource(r('broadcast'),Buffer.from(f.wire,'base64url'));assert.deepEqual(paths(),[genPath,accountPath]);assert.equal(owner.readOriginal().executionHeight,f.expected.executionHeight);await owner.close();
});
test('original empty release table cannot be populated by new endpoint headers or caller data',async()=>{
 routes(replies());await refused(noRelease(r()));assert.equal(calls(),0);
});
test('actual initial permission can retain Genesis above old8MiB boundary without rebuilding bytes',async()=>{
 // Synthetic JSON only; no source admission or Native private signing. Exact
 // existing protocol/native64MiB bound, not a new arbitrary transport limit.
 const bytes=Buffer.from('{"PUBLIC":"'+'.'.repeat(9<<20)+'"}\n'),request=r();
 const source={genesisBytes:bytes,genesisSHA256:hash(bytes),executionHeight:f.expected.executionHeight,occupancy:{chainId:f.expected.chainId,owner:f.expected.owner,executionHeight:f.expected.executionHeight,registered:false,ledgerNonce:'0'},memberBytes:null};
 const peer={readOriginal:()=>({request,issuedAt:request.createdAt,expiresAt:request.expiresAt,source}),assertCurrent(){},recheck(){},enterOriginal(){},completeOriginal(){},assertCompletedCurrent(){},retire(){},join(){},close(){}};
 const owner=new AccountInitialPermissionKernel(request,peer);await owner.initialize();assert.equal(hash(owner.copyOriginalGenesisBytes()),source.genesisSHA256);await owner.close();
});
