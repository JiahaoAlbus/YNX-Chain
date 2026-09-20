// Offline doctor / controlled issue. No service, account, provider or network call.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {assertAuthorityV2TrustRoot,assertAuthorityV2Manifest,assertAuthorityV2IssuancePolicy,canonicalAuthorityV2,canonicalAuthorityV2Payload,authorityV2SigningMessage,verifySignedEndpointAuthority} from '../../sdk/js/endpoint-authority-v2.js';
const check=(ok,code)=>{if(!ok)throw new Error(code);};
export const authorityV2SHA256=x=>createHash('sha256').update(x).digest('hex');
const readJSON=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function prepareAuthorityV2Draft(draft,keyId){
  const m=JSON.parse(canonicalAuthorityV2(draft));
  m.integrity={payloadSha256:authorityV2SHA256(canonicalAuthorityV2Payload(m)),algorithm:'Ed25519',keyId,signature:Buffer.alloc(64).toString('base64url')};return m;
}
export function validateAuthorityV2ReceiptFiles(manifest,directory){
  const checked=new Set();
  function receipt(sha){check(/^[a-f0-9]{64}$/.test(sha),'AUTHORITY_V2_RECEIPT_HASH');const file=path.join(directory,sha+'.json');const stat=fs.lstatSync(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=131072,'AUTHORITY_V2_RECEIPT_FILE');const bytes=fs.readFileSync(file);check(authorityV2SHA256(bytes)===sha,'AUTHORITY_V2_RECEIPT_HASH');checked.add(sha);return JSON.parse(bytes);}
  for(const [endpoint,e] of Object.entries(manifest.endpoints)){
    if(e.status!=='VERIFIED')continue;
    const r=receipt(e.evidence.receiptSha256);
    check(r.schemaVersion==='ynx-endpoint-observation/v2'&&r.endpoint===endpoint&&canonicalAuthorityV2(r.source)===canonicalAuthorityV2(e.evidence.source)&&r.chainId===6423,'AUTHORITY_V2_RECEIPT_IDENTITY');
    for(const kind of ['health','version']){
      check(canonicalAuthorityV2(r[kind].observation)===canonicalAuthorityV2(e.evidence[kind]),'AUTHORITY_V2_RECEIPT_OBSERVATION');
      check(typeof r[kind].body==='string'&&authorityV2SHA256(r[kind].body)===e.evidence[kind].bodySha256,'AUTHORITY_V2_RECEIPT_BODY');
    }
    // source mapping is an explicit controlled-release assertion, independently
    // reviewed before signing; body digests cannot prove deployment ownership.
    check(r.controlledReleaseAccepted===true,'AUTHORITY_V2_CONTROLLED_RELEASE_REQUIRED');
  }
  const p=manifest.products.finance;
  if(p.status==='VERIFIED'){
    const r=receipt(p.evidence.receiptSha256),projection={...p.evidence};delete projection.receiptSha256;
    check(r.schemaVersion==='ynx-finance-public-acceptance/v2'&&canonicalAuthorityV2(r.acceptance)===canonicalAuthorityV2(projection),'AUTHORITY_V2_FINANCE_RECEIPT');
    check(r.officialSandboxVerified===false&&r.providerVerified===false&&r.productionApproved===false,'AUTHORITY_V2_PROVIDER_BOUNDARY');
  }
  return [...checked].sort();
}
function privateKeyFile(file){
  check(typeof file==='string'&&path.isAbsolute(file),'AUTHORITY_V2_KEY_FILE_REQUIRED');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const st=fs.fstatSync(fd);check(st.isFile()&&(st.mode&0o777)===0o600&&st.uid===process.getuid()&&st.nlink===1&&st.size<=16384,'AUTHORITY_V2_KEY_FILE_PERMISSIONS');
    const key=createPrivateKey(fs.readFileSync(fd));check(key.asymmetricKeyType==='ed25519','AUTHORITY_V2_ED25519_REQUIRED');return key;
  }finally{fs.closeSync(fd);}
}
export async function issueAuthorityV2({draft,trustRoot,checkpoint,consumer,privateKeyPath,approvedPayloadSha256,evidenceDirectory,nowMs=Date.now()}){
  const r=assertAuthorityV2TrustRoot(trustRoot),m=assertAuthorityV2Manifest(draft,{nowMs});
  const digest=authorityV2SHA256(canonicalAuthorityV2Payload(m));
  check(digest===approvedPayloadSha256&&digest===m.integrity.payloadSha256,'AUTHORITY_V2_REVIEWED_DIGEST_REQUIRED');
  assertAuthorityV2IssuancePolicy(m,{trustRoot:r,checkpoint,consumer,nowMs});
  validateAuthorityV2ReceiptFiles(m,evidenceDirectory);
  const entry=r.keys.find(k=>k.keyId===m.integrity.keyId);check(entry&&!entry.revoked,'AUTHORITY_V2_UNKNOWN_OR_REVOKED_KEY');
  const key=privateKeyFile(privateKeyPath),jwk=createPublicKey(key).export({format:'jwk'});
  check(jwk.x===entry.publicKeyBase64url,'AUTHORITY_V2_SIGNER_TRUST_MISMATCH');
  m.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(m,entry.keyId)),key).toString('base64url');
  // Return only after the same consumer verifier accepts signature + checkpoint.
  await verifySignedEndpointAuthority(m,{trustRoot:r,checkpoint,consumer,nowMs});return m;
}
export async function authorityV2Doctor({manifest,trustRoot,checkpoint,consumer,nowMs=Date.now()}){
  const r=assertAuthorityV2TrustRoot(trustRoot);
  if(!manifest){
    const currentKeys=r.keys.filter(k=>!k.revoked&&nowMs>=Date.parse(k.notBefore)&&nowMs<Date.parse(k.notAfter));
    return {status:currentKeys.length?'TRUST_ROOT_CONFIGURED_NOT_ACTIVATED':'BLOCKED_NO_PROTECTED_PUBLIC_KEY',rootVersion:r.rootVersion,activeKeys:currentKeys.map(k=>k.keyId),networkCalls:0,signed:false,activated:false};
  }
  const verified=await verifySignedEndpointAuthority(manifest,{trustRoot:r,checkpoint,consumer,nowMs});
  return {status:'VERIFIED_NOT_ACTIVATED',manifestVersion:verified.manifestVersion,payloadSha256:verified.integrity.payloadSha256,rootVersion:r.rootVersion,walletGateway:verified.endpoints.walletGateway.status,finance:verified.products.finance.status,officialSandboxVerified:false,providerVerified:false,productionApproved:false,networkCalls:0,signed:false,activated:false};
}
export async function runAuthorityV2CLI(argv){
  const mode=argv.shift();check(['doctor','verify','issue'].includes(mode),'AUTHORITY_V2_COMMAND');const args={};
  for(let i=0;i<argv.length;i+=2){check(['--manifest','--trust-root','--checkpoint','--consumer-id','--origin','--client-version','--private-key-file','--approved-payload-sha256','--evidence-dir','--output'].includes(argv[i])&&argv[i+1]&&!args[argv[i]],'AUTHORITY_V2_ARGUMENTS');args[argv[i]]=argv[i+1];}
  const trustPath=args['--trust-root']??process.env.YNX_ENDPOINT_AUTHORITY_TRUST_ROOT_FILE;check(trustPath,'AUTHORITY_V2_TRUST_ROOT_REQUIRED');
  const trustRoot=readJSON(trustPath);
  if(mode==='doctor'&&!args['--manifest'])return authorityV2Doctor({trustRoot});
  args['--checkpoint']??=process.env.YNX_ENDPOINT_AUTHORITY_CHECKPOINT_FILE;
  check(args['--manifest']&&args['--checkpoint']&&args['--consumer-id']&&args['--origin']&&args['--client-version'],'AUTHORITY_V2_CONTEXT_REQUIRED');
  const manifest=readJSON(args['--manifest']),checkpoint=readJSON(args['--checkpoint']),consumer={consumerId:args['--consumer-id'],origin:args['--origin'],clientVersion:args['--client-version']};
  if(mode!=='issue')return authorityV2Doctor({manifest,trustRoot,checkpoint,consumer});
  check(args['--output']&&args['--evidence-dir']&&args['--approved-payload-sha256'],'AUTHORITY_V2_REVIEW_REQUIRED');
  const output=await issueAuthorityV2({draft:manifest,trustRoot,checkpoint,consumer,privateKeyPath:args['--private-key-file']??process.env.YNX_ENDPOINT_AUTHORITY_SIGNING_KEY_FILE,approvedPayloadSha256:args['--approved-payload-sha256'],evidenceDirectory:args['--evidence-dir']});
  // Exclusive creation. No checkpoint, consumer bundle or reviewed pin is changed.
  fs.writeFileSync(args['--output'],JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o644});
  return {status:'ISSUED_OFFLINE_NOT_ACTIVATED',manifestVersion:output.manifestVersion,payloadSha256:output.integrity.payloadSha256,activated:false,networkCalls:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runAuthorityV2CLI(process.argv.slice(2))));}
  catch(error){console.error(JSON.stringify({status:'BLOCKED',code:/^AUTHORITY_V2_[A-Z_]+$/.test(error.message)?error.message:'AUTHORITY_V2_INPUT_OR_CRYPTO_ERROR',activated:false}));process.exitCode=1;}
}
