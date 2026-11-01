import {createHash} from 'node:crypto';
import {YNXCloudClient, YNXCloudDeploymentUnknownError} from '../sdk/index.js';

const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw Error('Invalid original request ID');
  return value;
};
const revision = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= 18446744073709551615n) throw Error('Invalid deployment slot revision');
  return value;
};
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
function snapshot(value, maximum) {
  if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer || value.byteLength < 1 || value.byteLength > maximum) throw Error('Bounded actual bytes required');
  return Buffer.from(value);
}
function dual(bytes) { return Object.freeze({bytes:String(bytes.length),sha3_512:hash('sha3-512',bytes),sha512:hash('sha512',bytes)}); }
const sameBinding = (a,b) => !!a && !!b && a.bytes === b.bytes && a.sha3_512 === b.sha3_512 && a.sha512 === b.sha512;

// Product client extension over the ORIGINAL SDK transport and per-request
// Auth proof producer. A normal Wallet bearer or JSON verifier cannot enable it.
// Keep the returned selection with the IDE's original durable request record.
export class CloudDeploymentClient {
  #original; #prepared=new WeakMap(); #entered=new WeakSet();
  constructor(original) {
    if (!(original instanceof YNXCloudClient) || original.product !== 'cloud' || typeof original.getDeploymentRequestHeaders !== 'function') throw Error('Original Cloud SDK deployment proof provider required');
    this.#original = original;
  }
  get endpoint(){return this.#original.endpoint.replace(/\/$/,'');}
  prepare({requestId, manifest, artifact, approval, expectedSlotRevision, rollbackTo}) {
    id(requestId); revision(expectedSlotRevision);
    const manifestBytes = snapshot(manifest,16*1024), artifactBytes = snapshot(artifact,64*1024*1024), approvalBytes = snapshot(approval,1024*1024);
    if(rollbackTo===requestId)throw Error('Rollback requires a new independently approved request');
    const selection = Object.freeze({requestId, manifestSHA256:hash('sha256',manifestBytes), approvalSHA256:hash('sha256',approvalBytes), contentBinding:dual(artifactBytes), expectedSlotRevision, rollbackTo:rollbackTo === undefined ? '' : id(rollbackTo)});
    const prepared=Object.freeze({selection});this.#prepared.set(prepared,{manifestBytes,artifactBytes,approvalBytes});return prepared;
  }
  async submit(input){return this.submitPrepared(this.prepare(input),{signal:input.signal});}
  async submitPrepared(prepared,{signal}={}){
    const held=this.#prepared.get(prepared);if(!held)throw Error('Original prepared deployment required');
    const {selection}=prepared;
    if(this.#entered.has(prepared))throw new YNXCloudDeploymentUnknownError(selection.requestId);
    if(signal?.aborted)throw signal.reason;
    this.#entered.add(prepared);
    const headers = {'X-Expected-Deployment-Revision':selection.expectedSlotRevision};
    if (selection.rollbackTo) headers['X-Rollback-To'] = selection.rollbackTo;
    const operation = await this.#original.submitIDEDeployment({requestId:selection.requestId, manifest:held.manifestBytes, artifact:held.artifactBytes, approval:held.approvalBytes, headers, signal});
    this.#check(operation,selection);
    return {operation,selection};
  }
  async prepareRollback(targetSelection,input,{signal}={}){
    const prior=await this.lookupOriginal(targetSelection,{signal});
    if(prior.state!=='completed'||prior.exitCode!==0||!prior.deploymentId)throw Error('Rollback target must be a proven successful original');
    const prepared=this.prepare({...input,rollbackTo:targetSelection.requestId});
    if(prepared.selection.requestId===targetSelection.requestId||prepared.selection.manifestSHA256!==targetSelection.manifestSHA256||!sameBinding(prepared.selection.contentBinding,targetSelection.contentBinding)||prepared.selection.approvalSHA256===targetSelection.approvalSHA256)throw Error('Original artifact and fresh independent rollback approval required');
    return prepared;
  }
  #check(operation,selection) {
    if (operation?.requestId !== selection.requestId || operation.manifestSHA256 !== selection.manifestSHA256 || operation.approvalSHA256 !== selection.approvalSHA256 || !sameBinding(operation.contentBinding,selection.contentBinding) || operation.expectedSlotRevision !== selection.expectedSlotRevision || (operation.rollbackTarget || '') !== selection.rollbackTo) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    if (operation.slotRevision !== undefined && operation.slotRevision !== String(BigInt(selection.expectedSlotRevision)+1n)) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    if (['running','completed'].includes(operation.state) && !operation.slotRevision) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    return operation;
  }
  async lookupOriginal(selection,{signal}={}) {
    id(selection.requestId); revision(selection.expectedSlotRevision);
    return this.#check(await this.#original.getIDEDeploymentStatus(selection.requestId,{signal}),selection);
  }
  async logs(selection,options) { await this.lookupOriginal(selection,options); return this.#original.getIDEDeploymentLogs(selection.requestId,options); }
  async usage(selection,{signal,observe=true}={}) {
    // Reconcile and bind the same original instance before its usage lookup.
    const op = await this.lookupOriginal(selection,{signal});
    if (!op.deploymentId) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    const path = `/ide/deployments/${selection.requestId}/usage${observe ? '' : '/records'}`;
    const headers = await this.#original.deploymentHeaders('GET',path,selection.requestId,{},signal);
    const record = await this.#original.request(path,{headers,originalAuthorizationHeaders:headers,signal,retry:1,redirect:'error'});
    if (record?.requestId !== selection.requestId || record.instanceId !== op.deploymentId || !['UNPRICED','PERIOD_BILLS'].includes(record.billingState) || !record.samples || record.latest?.instanceId !== op.deploymentId) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    const samples=Object.entries(record.samples);
    if (!samples.length || samples.length>1024) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    for (const [key,sample] of samples) {
      if (sample.instanceId!==op.deploymentId || key!==`${sample.period}/${sample.sampleSeq}` || sample.storedBytes!==selection.contentBinding.bytes) throw new YNXCloudDeploymentUnknownError(selection.requestId);
      for (const field of ['sampleSeq','cpuNanos','cpuMs','memoryBytes','storedBytes','egressBytes']) {
        if (typeof sample[field]!=='string' || !/^(0|[1-9][0-9]*)$/.test(sample[field]) || BigInt(sample[field])>18446744073709551615n) throw new YNXCloudDeploymentUnknownError(selection.requestId);
      }
      if (BigInt(sample.cpuMs)!==BigInt(sample.cpuNanos)/1000000n) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    }
    if (JSON.stringify(record.samples[`${record.latest.period}/${record.latest.sampleSeq}`])!==JSON.stringify(record.latest)) throw new YNXCloudDeploymentUnknownError(selection.requestId);
    return record;
  }
  async bill(selection,period,{prepare=false,signal}={}) {
    if (typeof period!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(period) || new Date(period+'T00:00:00Z').toISOString().slice(0,10)!==period) throw Error('Canonical UTC billing day required');
    const operation=await this.lookupOriginal(selection,{signal});
    const method=prepare?'POST':'GET',path=`/ide/deployments/${selection.requestId}/billing/${period}`;
    const headers=await this.#original.deploymentHeaders(method,path,selection.requestId,{},signal);
    const bill=await this.#original.request(path,{method,headers,originalAuthorizationHeaders:headers,signal,retry:1,redirect:'error'});
    const unknown=()=>{throw new YNXCloudDeploymentUnknownError(selection.requestId);};
    if (bill?.request?.requestId!==selection.requestId || bill.request.instanceId!==operation.deploymentId || bill.request.period!==period || bill.aggregate?.period!==period || !['UNKNOWN','PREPARED','ISSUED','NO_CHARGE'].includes(bill.state)) unknown();
    if (bill.state==='NO_CHARGE' ? bill.settlement!=='NOT_APPLICABLE' || bill.request.atoms!=='0' : bill.settlement!=='NOT_VERIFIED') unknown();
    const schedule=bill.schedule,asset=bill.request.asset;
    if (!schedule || schedule.id!==bill.request.scheduleId || schedule.revision!==bill.request.scheduleRevision || schedule.resourceId!==operation.resourceId || schedule.projectId!==operation.binding.projectId || schedule.merchant!==bill.request.merchant || schedule.recipient!==bill.request.recipient || schedule.registrationRef!==bill.request.registrationRef || schedule.approvalRef!==bill.request.approvalRef || !sameBinding(bill.request.sampleBinding,bill.aggregate.sampleBinding)) unknown();
    if (!asset || !/^[0-9a-f]{64}$/.test(asset.genesis) || !asset.assetId || !asset.nativeChainId || !asset.unitVersion || Object.keys(asset).some(key=>asset[key]!==schedule.asset?.[key])) unknown();
    const uint=value=>{if(typeof value!=='string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value)>18446744073709551615n) unknown();return BigInt(value);};
    if(uint(asset.nativeChainId)===0n || uint(asset.nativeChainId)>9223372036854775807n || uint(schedule.revision)===0n) unknown();
    uint(asset.unitVersion);
    let total=0n;
    for(const [metric,rate] of [['cpuNanos',schedule.cpuNanos],['egressBytes',schedule.egressBytes],['peakStoredBytes',schedule.peakStoredBytes]]){
      if(!rate)unknown();const units=uint(rate.units);if(units===0n)unknown();total+=(uint(bill.aggregate[metric])+units-1n)/units*uint(rate.atoms);
      if(total>18446744073709551615n)unknown();
    }
    if(total!==uint(bill.request.atoms))unknown();
    if(['PREPARED','ISSUED'].includes(bill.state) && (!bill.invoiceId || !bill.originalOperation))unknown();
    // An invoice is a request for payment. No branch here accepts a paid flag,
    // signs a Member, settles funds, follows a result URL or submits twice.
    return bill;
  }
}
