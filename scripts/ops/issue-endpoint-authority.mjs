// Offline, explicit release issuance. Never runs from a consumer or extends old files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalEndpointAuthorityPayload,assertEndpointAuthorityStructure,endpointAuthorityTime,ENDPOINT_AUTHORITY_URLS,ENDPOINT_AUTHORITY_CANONICALIZATION} from '../../sdk/js/endpoint-authority.js';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildEndpointAuthority({evidence,evidencePath,evidenceSHA256,version,sourceCommit,issuedAt,expiresAt}){
  assert(/^\d{8}\.\d+$/.test(version),'VERSION_REQUIRED');
  assert(evidencePath===`chain-metadata/endpoint-authority/${version}.evidence.json`,'VERSIONED_EVIDENCE_REQUIRED');
  assert(/^[a-f0-9]{64}$/.test(evidenceSHA256),'EVIDENCE_HASH_REQUIRED');
  const observed=evidence.refresh,issued=endpointAuthorityTime(issuedAt);
  assert(evidence.schema==='ynx-endpoint-authority-evidence/v1'&&observed.schema==='ynx-transport-shareable-bundle/v1','EVIDENCE_SCHEMA');
  assert(observed.complete===true&&observed.expectedSamples===8&&observed.observedSamples===8&&observed.healthySamples===8&&observed.probes.length===8,'INCOMPLETE_PUBLIC_EVIDENCE');
  assert(observed.pathMode==='direct-dns'&&observed.expectedRounds===2,'PUBLIC_DNS_EVIDENCE_REQUIRED');
  const checked=endpointAuthorityTime(observed.finishedAt);
  assert(checked<=issued&&issued-checked<=24*60*60*1000,'FRESH_EVIDENCE_REQUIRED');
  const urls=['https://rpc-testnet.ynxweb4.com/status','https://rpc.ynxweb4.com/status','https://faucet-testnet.ynxweb4.com/health','https://faucet.ynxweb4.com/health'];
  const builds={};
  for(const url of urls){
    const rows=observed.probes.filter(p=>p.url===url);
    assert.deepEqual(rows.map(p=>p.round).sort(),[1,2],'MISSING_OR_DUPLICATE_PUBLIC_PROBE');
    for(const p of rows)assert(p.ready===true&&p.classification==='healthy'&&p.chainId===6423&&p.client.http_code===200&&p.client.exitcode===0&&p.client.ssl_verify_result===0&&p.client.proxy_used===0&&p.client.time_appconnect>0&&/^[a-f0-9]{40}$/.test(p.buildCommit),'INVALID_PUBLIC_PROBE');
    assert(rows[0].buildCommit===rows[1].buildCommit,'CHANGING_PUBLIC_VERSION');builds[url]=rows[0].buildCommit;
  }
  assert(builds[urls[0]]===builds[urls[1]]&&builds[urls[2]]===builds[urls[3]],'ALIAS_VERSION_MISMATCH');
  const previous=evidence.priorControlledDeployment;
  assert(previous?.sourceSHA256==='f207c219421babcc32ec0fd15533a127dc925e08c9d5438ae98021c4b9192454','CONTROLLED_PREDECESSOR_REQUIRED');
  assert(previous.chainId==='0x1917'&&previous.networkId==='6423'&&previous.comparisonStableAcrossGrowth===true&&previous.nativeRestVerified===true&&previous.httpCorsVerified===true&&/^0x[a-f0-9]{64}$/.test(previous.comparisonBlockHash),'PRIOR_CHAIN_COMPATIBILITY_REQUIRED');
  assert(previous.currentRPCCommit===builds[urls[0]]&&previous.currentFaucetCommit===builds[urls[2]],'CONTROLLED_VERSION_MISMATCH');
  const states={};
  for(const [key,url] of Object.entries(ENDPOINT_AUTHORITY_URLS)){
    const verified=['rpc','evmRpc','faucet'].includes(key),health=url+(key==='faucet'?'/health':'/status');
    states[key]=verified?{status:'VERIFIED',health,versionIdentity:health,verifiedAt:observed.finishedAt,chainId:6423,sourceCommit:builds[health],reason:'Fresh bounded TLS/chain/build/readiness observations; not continuous availability'}:
      {status:'PENDING',health:null,versionIdentity:null,verifiedAt:null,sourceCommit:null,reason:'Location preserved only; no renewed service authority in this RPC/Faucet release'};
  }
  states.products={finance:{status:'PENDING',reason:'Official provider and current public Finance acceptance are independent gates'}};
  const manifest={schemaVersion:'1.1.0',manifestVersion:`1.1.0-weekly-v3.${version}`,status:'ACCEPTED_BUNDLED_CONSUMER_CONTRACT',
    environment:'testnet',releaseId:`ynx-endpoints-${version}`,sourceCommit,issuedAt,expiresAt,cosmosChainId:'ynx_6423-1',evmChainId:6423,evmChainHex:'0x1917',nativeAsset:'YNXT',
    ...ENDPOINT_AUTHORITY_URLS,healthUrl:'https://monitor.ynxweb4.com/health',versionUrl:'https://monitor.ynxweb4.com/version',
    endpointStates:states,mainnet:{enabled:false,chainId:null,rpc:null,reservedRpcUrl:'https://rpc-mainnet.ynxweb4.com'},
    legacyCompatibility:{rpc:{url:'https://rpc.ynxweb4.com',status:'VERIFIED',chainId:6423,sourceCommit:builds[urls[1]],verifiedAt:observed.finishedAt},
      faucet:{url:'https://faucet.ynxweb4.com',status:'VERIFIED',chainId:6423,sourceCommit:builds[urls[3]],verifiedAt:observed.finishedAt},
      evmRpc:{url:'https://evm.ynxweb4.com',status:'PENDING',reason:'Preserved compatibility location; not renewed by this RPC/Faucet evidence'}},
    sourceEvidence:{path:evidencePath,sha256:evidenceSHA256,scope:'Public health/status refresh plus separately hash-bound controlled deployment compatibility evidence'},
    fallbacks:{rpc:[],evmRpc:[],rest:[],walletGateway:[],appGateway:[],faucet:[]},
    minimumClientVersion:{wallet:null,financialApps:null,policy:'Only independently accepted product release matrices may declare minimum client versions'},
    clientPolicy:{remoteReplacement:'FORBIDDEN_UNSIGNED',clientRenewal:false,automaticWriteRetry:false,compatibilitySelection:'Explicit legacy profile only; never automatic failover'},
    acceptanceBoundary:'Versioned bundled source authority for RPC/Faucet locations and sampled identity only. Not continuous/global uptime, consensus finality, installed product acceptance, official Broker Sandbox, or a remote signature.'};
  manifest.integrity={algorithm:'SHA-256',canonicalization:ENDPOINT_AUTHORITY_CANONICALIZATION,payloadSha256:sha256(canonicalEndpointAuthorityPayload(manifest)),remoteSignature:{status:'PENDING_PROTECTED_SIGNER',keyId:null,signature:null,failClosed:true}};
  assertEndpointAuthorityStructure(manifest,{nowMs:issued});return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){assert(['--version','--source-commit','--issued-at','--expires-at'].includes(args[i])&&args[i+1]&&!options[args[i]],'EXPLICIT_ISSUANCE_ARGUMENTS_REQUIRED');options[args[i]]=args[i+1];}
  const version=options['--version'];assert(/^\d{8}\.\d+$/.test(version??''),'VERSION_REQUIRED');
  const evidencePath=`chain-metadata/endpoint-authority/${version}.evidence.json`;
  const bytes=fs.readFileSync(evidencePath);
  const manifest=buildEndpointAuthority({evidence:JSON.parse(bytes),evidencePath,evidenceSHA256:sha256(bytes),version,sourceCommit:options['--source-commit'],issuedAt:options['--issued-at'],expiresAt:options['--expires-at']});
  assertEndpointAuthorityStructure(manifest); // Operator issuance cannot backdate an expired/future release into use.
  const output=`chain-metadata/endpoint-authority/${version}.json`,encoded=JSON.stringify(manifest,null,2)+'\n';
  fs.writeFileSync(output,encoded,{flag:'wx'});
  console.log(JSON.stringify({manifestPath:output,manifestVersion:manifest.manifestVersion,payloadSha256:manifest.integrity.payloadSha256,fileSha256:sha256(encoded),bytes:Buffer.byteLength(encoded)}));
}
