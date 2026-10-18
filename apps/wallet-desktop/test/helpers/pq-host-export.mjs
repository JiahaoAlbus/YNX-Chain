import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodePQTransferRequest,preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../src/wallet-pq-intent-record.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),copy=o=>JSON.parse(JSON.stringify(o));
const packed=readFileSync(new URL('../../src/features/pq-transaction/fixtures/finality-c3-public.json.gz',import.meta.url));assert.equal(sha(packed),'ef1562c14a3528e29928dd1889e5fa94416e1223e405fac2a7648829c0b43095');
const row=JSON.parse(gunzipSync(packed)).cases.find(x=>x.name==='succeeded-transfer'),wire=Buffer.from(row.expectedTransaction.nativeWire,'base64'),transfer=decodePQTransferRequest(wire).transfer,binding={account:transfer.from,networkId:transfer.chainId};
const original=createPQOriginalRecord({account:binding.account,kind:'pq-transfer',operationId:'PUBLIC-Host-export',request:preparePQTransferTransport(wire)}),H='ab'.repeat(32),J='cd'.repeat(32);
// PUBLIC shape-only Host export: no source files, trusted signatures, clock,
// producer process, deployed header, or original Host grant is supplied here.
function fixture(){
 const expected=copy(row.expectedTransaction),sourceId='PUBLIC.source:1',epoch='9007199254740993';
 const light={version:'YNX-CONSENSUS-PROOF-TRUST/v1',chainId:expected.block.chainId,migrationFile:'/PUBLIC/migration.json',genesisFile:'/PUBLIC/genesis.json',stateFile:'/PUBLIC/state.json',scheduleFile:'/PUBLIC/schedule.json',scheduleHash:H,consensusGenesisSHA256:J,originalGenesisHash:binding.networkId,migrationStateHash:H,runtimePlanFile:'',runtimePlanHash:'',engineHeight:'6',engineAppHash:H,expectedHeaderHeight:expected.block.headerHeight,expectedBlockHash:expected.block.blockHash,expectedStateHeight:expected.block.stateHeight,expectedStateAppHash:expected.block.stateAppHash,trustedLightBlockFile:'/PUBLIC/trusted.json',trustedLightBlockSHA256:J,trustingPeriodNanoseconds:'3600000000000',maxClockDriftNanoseconds:'0',trustLevelNumerator:'1',trustLevelDenominator:'3'};
 const context={version:'YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',lightTrust:light,expectedTransaction:copy(expected)},lifecycle={version:'YNX-CONSENSUS-PROOF-HOST-LIFECYCLE/v1',sourceId,epoch,status:'current'};
 const source={version:'YNX-CONSENSUS-PROOF-HOST-SOURCE/v1',sourceId,epoch,contextFile:'/PUBLIC/context&qa.json',contextSHA256:'',lifecycleFile:'/PUBLIC/lifecycle.json',lifecycleSHA256:'',migrationSHA256:H,genesisSHA256:J,stateSHA256:H,scheduleSHA256:H,runtimePlanSHA256:'',trustedLightBlockSHA256:J};
 const exported={version:'YNX-CONSENSUS-PROOF-HOST-CONTEXT/v1',classification:'data',sourceId,epoch,sourceFingerprint:H,sourceBytes:'',sourceSHA256:'',lifecycleBytes:'',lifecycleSHA256:'',contextVersion:context.version,contextPath:source.contextFile,contextBytes:'',contextSHA256:'',expectedTransaction:expected,chainId:light.chainId,engineHeight:light.engineHeight,engineAppHash:light.engineAppHash,trustedLightBlockSHA256:J,expiresAt:'2099-01-01T00:00:00.123456789Z',currentChecked:true,nativeRootAuthorized:false,sourceDeploymentQualified:false,proofVerified:false};
 const selection={sourcePath:'/PUBLIC/source&qa.json',sourceSha256:'',sourceId,epoch};
 function encode(){
  const c=Buffer.from(JSON.stringify(context)),l=Buffer.from(JSON.stringify(lifecycle));source.contextSHA256=sha(c);source.lifecycleSHA256=sha(l);const s=Buffer.from(JSON.stringify(source));
  Object.assign(exported,{sourceBytes:s.toString('base64'),sourceSHA256:sha(s),lifecycleBytes:l.toString('base64'),lifecycleSHA256:sha(l),contextBytes:c.toString('base64'),contextSHA256:sha(c)});selection.sourceSha256=sha(s);
  return {stdout:Buffer.from(JSON.stringify({version:'YNX-CONSENSUS-PROOF-HOST-RESULT/v1',code:'EXPORTED_PROOF_TRUST_DATA',context:exported})+'\n'),stderr:Buffer.alloc(0),exitCode:0,signal:null};
 }
 return {expected,light,context,lifecycle,source,exported,selection,encode};
}

export {sha,original,binding,H,J,fixture,row};
