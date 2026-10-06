import * as filesystem from "node:fs";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSessionGatewaySnapshot } from "./product-session-gateway-snapshot-v2.js";
import { productSessionControlClockFloor, parseProductSessionControlIntent, migrateProductSessionControlSnapshotV2, parseProductSessionControlSnapshot } from "./product-session-control-intent.js";
import { inspectProductSessionControlCapacity, parseProductSessionControlCapacityPolicy, productSessionControlPublicCapacityPolicy } from "./product-session-control-capacity.js";

import {emptyOriginalSessionProjection, parseOriginalSessionProjection, advanceOriginalSessionProjection, originalSessionProjectionRecord, reserveOriginalEffect, settleOriginalEffect, originalRevocationBarrier} from './product-session-authority-projection.js';

import {emptyOriginalRecoveryState, parseOriginalRecoveryState, parseOriginalOperationMapping, parseOriginalReaderRegistration, appendOriginalOperationMapping, consumeOriginalRecoveryNonce, captureOriginalRecoveryIdentity, captureOriginalReaderBytes, captureOriginalRecoveryJSON} from './original-operation-recovery-state.js';
import {createOriginalUnexpiredOperationReader} from './original-unexpired-operation-reader.js';
import {verifyProductSessionProofV2} from './product-session-proof-v2.js';

import {assertOriginalBackendOperationAuthenticator} from './original-backend-operation-auth.js';

import {emptyOriginalOperatorReaderState,parseOriginalOperatorReaderState,appendOriginalOperatorReaderApproval,assertOriginalOperatorReaderApprovalAuthority} from './original-device-reader-durable-registration.js';
import {emptyOriginalDeveloperResourceRegistryState,parseOriginalDeveloperResourceRegistryState} from './original-developer-resource-registry-current.js';
import {assertOriginalDeveloperResourceSameWriterPair} from './original-developer-resource-same-writer-composition.js';
import {types} from 'node:util';

export const ORIGINAL_DEVELOPER_RESOURCE_ENVELOPE_VERSION = 6;
export const ORIGINAL_OPERATOR_READER_ENVELOPE_VERSION = 5;
export const ORIGINAL_DURABLE_RECOVERY_ENVELOPE_VERSION = 4;
export const PRODUCT_SESSION_CONTROL_NODE_SCHEMA_VERSION = 2;
export const ORIGINAL_SESSION_PROJECTION_ENVELOPE_VERSION = 3;
const MAX_BYTES = 32 * 1024 * 1024;
const digest = value => createHash("sha256").update(typeof value === "string" ? value : canonicalJSON(value)).digest("hex");

export function parseProductSessionControlPersistedState(raw) {
  try {
    const envelope = parseEnvelope(raw, PRODUCT_SESSION_CONTROL_NODE_SCHEMA_VERSION);
    return Object.freeze({ ...envelope, snapshot: parseProductSessionControlSnapshot(envelope.snapshot) });
  } catch { fail("STATE_TAMPERED", "Version-three persisted state failed complete schema and digest validation"); }
}

/** Read-only preflight: safe on current V2 bytes while its atomic writer runs. */
export function inspectProductSessionControlStateFile({ statePath, capacityPolicy }, io = filesystem) {
  const path = absolute(statePath), policy = parseProductSessionControlCapacityPolicy(capacityPolicy);
  safeDirectory(path, io, false);
  const loaded = readOwned(path, io);
  if (!loaded) fail("STATE_NOT_FOUND", "Capacity preflight requires an existing state file");
  let version; try { version = JSON.parse(loaded.raw).schemaVersion; } catch { fail("STATE_TAMPERED", "Capacity preflight state is invalid JSON"); }
  const snapshot = version === ORIGINAL_DEVELOPER_RESOURCE_ENVELOPE_VERSION
    ? parseOriginalDeveloperResourcePersistedState(loaded.raw).snapshot : version === 1
    ? migrateProductSessionControlSnapshotV2(parseProductSessionGatewaySnapshot(parseEnvelope(loaded.raw, 1).snapshot))
    : version === ORIGINAL_OPERATOR_READER_ENVELOPE_VERSION
      ? parseOriginalOperatorReaderPersistedState(loaded.raw).snapshot
      : version === ORIGINAL_DURABLE_RECOVERY_ENVELOPE_VERSION
      ? parseOriginalRecoveryPersistedState(loaded.raw).snapshot
      : version === ORIGINAL_SESSION_PROJECTION_ENVELOPE_VERSION
      ? parseOriginalProjectedPersistedState(loaded.raw).snapshot
      : parseProductSessionControlPersistedState(loaded.raw).snapshot;
  const capacity = inspectProductSessionControlCapacity(snapshot, policy);
  return Object.freeze({ readOnly: true, sourceSHA256: digest(loaded.raw), sourceBytes: loaded.identity.size, sourceEnvelopeVersion: version, snapshotSchemaVersion: version === 1 ? 2 : 3, admittedOwners: capacity.admittedOwners, storedIntents: snapshot.controlIntents.length, reservedIntents: capacity.reservedIntents, overReserved: capacity.overReserved, sessions: snapshot.authority.sessions.length, issuedChallenges: snapshot.authority.issuedChallenges.length, policy: productSessionControlPublicCapacityPolicy(policy) });
}

/** One synchronous writer transaction owns decision, persistence and readback. */
export class ProductSessionControlNodeStore {
  #resourceAuthority; #resourceNow; #resourceSource; #resourceInvalid=false; #resourceClockFloor=null;
  #path; #io; #identity; #projectionTokens; #effectVerifier; #recoveryReader; #mappingVerifier; #readerRegistration; #originalNow; #backendOperationAuth; #operatorReaderAuthority; #operatorRoleCurrent; #pending = null; #busy = false;
  constructor({ statePath, io = filesystem, projectionTokenFactory, originalEffectReadbackVerifier, originalOperationRecoveryReader, originalOperationMappingVerifier, originalRecoveryRegistrationCurrent, originalRecoveryNow, originalBackendOperationAuthenticator, originalOperatorReaderApprovalAuthority, originalOperatorReaderRoleCurrent, originalDeveloperResourceAuthority, originalDeveloperResourceNow, originalDeveloperResourceHeldSource }) {
    this.#resourceAuthority=originalDeveloperResourceAuthority===undefined?undefined:assertOriginalDeveloperResourceSameWriterPair(originalDeveloperResourceAuthority,originalDeveloperResourceHeldSource);
    this.#resourceNow=originalDeveloperResourceNow;
    this.#resourceSource=originalDeveloperResourceHeldSource;
    if(originalDeveloperResourceAuthority!==undefined&&(!originalDeveloperResourceAuthority||typeof originalDeveloperResourceAuthority.admit!=='function'||typeof originalDeveloperResourceAuthority.assertStored!=='function'||typeof originalDeveloperResourceAuthority.readCurrent!=='function'))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Fixed original resource authority is unavailable');
    for(const source of [originalDeveloperResourceNow,originalDeveloperResourceHeldSource])if(source!==undefined&&typeof source!=='function')fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Original resource source must be construction-fixed');
    this.#operatorRoleCurrent=originalOperatorReaderRoleCurrent;
    if(originalOperatorReaderRoleCurrent!==undefined&&typeof originalOperatorReaderRoleCurrent!=='function')fail('ORIGINAL_OPERATOR_ROLE_NOT_CONFIGURED','Fixed original role current source unavailable');
    this.#operatorReaderAuthority=originalOperatorReaderApprovalAuthority===undefined?undefined:assertOriginalOperatorReaderApprovalAuthority(originalOperatorReaderApprovalAuthority);
    this.#path = absolute(statePath); this.#io = io; this.#projectionTokens = projectionTokenFactory; this.#effectVerifier = originalEffectReadbackVerifier; this.#recoveryReader = originalOperationRecoveryReader; this.#mappingVerifier = originalOperationMappingVerifier; this.#readerRegistration = originalRecoveryRegistrationCurrent; this.#originalNow = originalRecoveryNow; this.#backendOperationAuth = originalBackendOperationAuthenticator===undefined ? undefined : assertOriginalBackendOperationAuthenticator(originalBackendOperationAuthenticator);
    for (const dependency of [this.#effectVerifier, this.#recoveryReader, this.#mappingVerifier, this.#readerRegistration, this.#originalNow]) if (dependency !== undefined && typeof dependency !== 'function') fail('EFFECT_PRODUCER_UNAVAILABLE', 'Original producer must be a construction-time capability');
    const loaded = readState(this.#path, this.#io);
    if (!loaded) fail("STATE_NOT_FOUND", "Version-three state must be explicitly initialized or migrated before startup");
    safeDirectory(this.#path, this.#io, false);
    this.#adopt(loaded);
  }
  snapshot() { return this.#readLatest().snapshot; }
  // Not an HTTP API or a complete current/monotonic provenance producer.
  // Consumers must also hold the genuine original authority/effect coordinator.
  originalProjection(sessionBinding) {
    const state = this.#readLatest();
    if (!state.projection) fail("PROJECTION_ENROLLMENT_UNAVAILABLE", "Original writer projection has not been explicitly migrated");
    return originalSessionProjectionRecord(state.snapshot, state.projection, sessionBinding);
  }
  withOriginalProjectedAuthority(read) {
    if (typeof read !== 'function') fail('PROJECTION_READER_UNAVAILABLE', 'Original authority reader must be synchronous');
    if (this.#busy) fail('STATE_WRITER_BUSY', 'Original writer owns another transaction');
    this.#busy = true;
    try {
      const state = this.#readLatest();
      if (!state.projection) fail('PROJECTION_ENROLLMENT_UNAVAILABLE', 'Original authority has no explicitly migrated projection');
      const result = read(Object.freeze({snapshot:state.snapshot, projection:state.projection,...(state.recovery ? {recovery:state.recovery} : {}),...(state.resourceRegistry ? {resourceRegistry:state.resourceRegistry} : {})}));
      if (result && typeof result.then === 'function') fail('PROJECTION_READER_ASYNC', 'Original writer observation cannot escape its synchronous boundary');
      // The complete encoded identity, including projection and obligations,
      // must remain the same before publication of the observation.
      this.#readLatest();
      return result;
    } finally {this.#busy = false;}
  }
  // NEW private normal caller. No old backend/revalidate purpose is promoted.
  // The original domain must have durably prepared request.intentId BEFORE
  // this call. Its independently registered signed evidence binds that exact
  // request; a caller UUID or Session alone is not a resource owner.
  reserveOriginalDeveloperResourceOperation(rawInput, actualRawWire) {
    if(this.#busy){this.#resourceInvalid=true;fail('STATE_WRITER_BUSY','Resource source cannot reenter the original writer');}
    if(this.#resourceInvalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Resource observation previously rejected reentry');
    const input=captureOriginalDeveloperResourceData(rawInput),wire=detachOriginalDeveloperResourceWire(actualRawWire);
    exactFields(input,['session','actionProof','approval','request','sourceEvidence'],'NEW original resource publication');
    if(typeof input.approval!=='string'||typeof input.sourceEvidence!=='string')fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Signed source and explicit approval required');
    if(!this.#resourceAuthority||!this.#resourceNow||!this.#resourceSource)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','No actual admitted resource source is installed');
    if(this.#busy)fail('STATE_WRITER_BUSY','Original resource publication cannot reenter its writer');this.#busy=true;
    try{
      const before=this.#readLatest();if(!before.resourceRegistry)fail('ORIGINAL_RESOURCE_NAMESPACE_UNAVAILABLE','Explicit stopped-writer schema6 adoption required');
      const view=Object.freeze({snapshot:before.snapshot,projection:before.projection,recovery:before.recovery});
      const registration=this.#resourceAuthority.admit(view,before.resourceRegistry,input.session,input.actionProof,input.approval,input.request,wire,input.sourceEvidence);
      if(this.#resourceInvalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Resource callback swallowed a nested refusal');
      const metadata=parseOriginalDeveloperResourceRegistryState(registration.state),record=registration.record;
      const oldMapping=before.recovery.mappings.find(m=>m.sessionBinding===record.actor.session.sessionBinding&&m.productOperationId===record.request.intentId);
      if(oldMapping){
        const prior=before.resourceRegistry.records.find(r=>r.actor.session.sessionBinding===record.actor.session.sessionBinding&&r.request.intentId===record.request.intentId);
        if(!prior||canonicalJSON(prior)!==canonicalJSON(record)||!registration.readOnly)fail('ORIGINAL_RESOURCE_REPLAY_CONFLICT','Original resource intent cannot change approval or nonces');
        const obligation=before.projection.effects.find(e=>e.operationId===oldMapping.operationId);
        if(!obligation)fail('ORIGINAL_RESOURCE_HISTORY_UNAVAILABLE','Original mapped obligation is missing');
        this.#resourceReleaseCurrent(view,metadata,record,wire,input.sourceEvidence);
        this.#readLatest();return captureOriginalRecoveryJSON({version:'ynx-original-developer-resource-publication/v1',mapping:oldMapping,obligation,approvalDigest:record.approvalDigest,readOnly:true,dispatchAllowed:false});
      }
      if(!registration.newlyRegistered||registration.readOnly)fail('ORIGINAL_RESOURCE_REPLAY_CONFLICT','A historical nonce cannot create another operation');
      // Explicit NEW internal commitment, not legacy recovery/chain IDs and
      // never raw wire SHA substituted for the Node request commitment.
      const commitment={version:'ynx-original-developer-resource-node-commitment/v1',actor:record.actor,actionProof:record.actionProof,approval:JSON.parse(record.approval),request:record.request,domainObservation:record.domainObservation,productOperationId:record.request.intentId};
      const identity={operationId:randomBytes(32).toString('hex'),sessionBinding:record.actor.session.sessionBinding,requestDigest:digest(commitment)};
      const mapping=parseOriginalOperationMapping({...identity,method:record.request.method,path:record.request.path,actionNonce:record.actionNonce,actionBodyDigest:record.request.bodyDigest,wireDigest:record.request.bodyDigest,productOperationId:record.request.intentId});
      const at=this.#resourceInstant();
      const prepared=reserveOriginalEffect(before.snapshot,before.projection,identity,at);
      const recovery=parseOriginalRecoveryState(appendOriginalOperationMapping(before.recovery,mapping),before.snapshot,prepared.projection);
      const finalCurrent=()=>this.#resourceReleaseCurrent(view,metadata,record,wire,input.sourceEvidence);
      const durable=this.#commit(before.snapshot,prepared.projection,recovery,finalCurrent,before.operatorReaders,metadata);
      // Both resource nonces, mapping and UNKNOWN were in that ONE original
      // publication. A late refusal leaves them intact; no new random ID retry.
      this.#readLatest();const obligation=durable.projection.effects.find(e=>e.operationId===identity.operationId);
      return captureOriginalRecoveryJSON({version:'ynx-original-developer-resource-publication/v1',mapping,obligation,approvalDigest:record.approvalDigest,readOnly:false,dispatchAllowed:true});
    }finally{this.#busy=false;}
  }
  #resourceInstant(){
    const observed=this.#resourceNow();let at;try{at=Date.prototype.getTime.call(observed);}catch{fail('CLOCK_UNAVAILABLE','Original resource clock unavailable');}
    if(this.#resourceInvalid||!Number.isSafeInteger(at)||at<0||(this.#resourceClockFloor!==null&&at<this.#resourceClockFloor))fail('CLOCK_UNAVAILABLE','Original resource clock must be finite, monotonic and nonreentrant');
    this.#resourceClockFloor=at;return new Date(at);
  }
  #resourceReleaseCurrent(view,metadata,record,wire,evidence){
    this.#resourceAuthority.readCurrent(view,metadata,record.approvalDigest,evidence,wire);
    const at=this.#resourceInstant().getTime();
    for(const until of [record.actor.session.expiresAt,record.actionProof.expiresAt,JSON.parse(record.approval).expiresAt,record.domainObservation.resourceCurrent.expiresAt])if(at>=Date.parse(until))fail('ORIGINAL_RESOURCE_RELEASE_EXPIRED','Original finite approval expired before publication release');
    if(at<productSessionControlClockFloor(view.snapshot)||at<Date.parse(record.approvedAt))fail('CLOCK_UNAVAILABLE','Original resource clock cannot precede durable history');
    // Actual fixed verifier held-source check is AFTER the final external clock.
    // This is a source file fence, not permission supplied by a void callback.
    if(this.#resourceSource()!==undefined)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Source check cannot return an invented permission');
    if(this.#resourceInvalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Source callback swallowed a nested refusal');
    this.#readLatest();
  }
  readOriginalDeveloperResourceOperation(input,rawReaderProof,rawRequestBody,now) {
    if(this.#busy){this.#resourceInvalid=true;fail('STATE_WRITER_BUSY','Resource reader cannot reenter original writer');}
    if(this.#resourceInvalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Resource source previously refused reentry');
      const identity=captureOriginalRecoveryIdentity(input);
    const recovered=this.readOriginalUnexpiredMappedOperation(identity,rawReaderProof,rawRequestBody,now);
    // The original registered reader consumed its nonce in the same writer;
    // no expired action proof is relaxed and no effect is dispatched here.
    return this.withOriginalProjectedAuthority(view=>{
      if(!view.resourceRegistry||!this.#resourceAuthority)fail('ORIGINAL_RESOURCE_NAMESPACE_UNAVAILABLE','Original resource history unavailable');
      this.#resourceAuthority.assertStored(view,view.resourceRegistry);
      const mapping=view.recovery.mappings.find(m=>m.operationId===identity.operationId);
      const record=view.resourceRegistry.records.find(r=>r.actor.session.sessionBinding===identity.sessionBinding&&r.request.intentId===mapping?.productOperationId);
      if(!record||!mapping||mapping.requestDigest!==identity.requestDigest)fail('ORIGINAL_RESOURCE_HISTORY_UNAVAILABLE','No exact original resource association');
      const result=captureOriginalDeveloperResourceData({version:'ynx-original-developer-resource-observation/v1',record,mapping,recovered,readOnly:true,dispatchAllowed:false});
      if(!this.#resourceSource||this.#resourceSource()!==undefined||this.#resourceInvalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED','Historical source failed its final held-source fence');
      this.#readLatest();return result;
    });
  }
  #assertOriginalOperatorRole() {
    if(!this.#operatorRoleCurrent)return;
    const state=this.#readLatest();
    const result=this.#operatorRoleCurrent(Object.freeze({snapshot:state.snapshot,projection:state.projection}));
    if(result!==undefined)fail('ORIGINAL_OPERATOR_ROLE_UNAVAILABLE','Original role current must complete synchronously');
    this.#readLatest();
  }
  // NEW purpose approval in the SAME original writer. No owner-control or
  // browser proof is accepted as operator enrollment. Schema5 explicit only.
  approveOriginalOperatorReaderRegistration(rawApproval) {
    const capturedApproval=captureOriginalRecoveryJSON(rawApproval);
    if(!this.#operatorReaderAuthority)fail('ORIGINAL_DEVICE_READER_OPERATOR_NOT_CONFIGURED','No independently admitted operator approval authority');
    if(this.#busy)fail('STATE_WRITER_BUSY','Original writer owns another transaction');this.#busy=true;
    try{
      const before=this.#readLatest();if(!before.operatorReaders)fail('ORIGINAL_DEVICE_READER_NAMESPACE_UNAVAILABLE','Explicit stopped-writer schema5 migration required');
      this.#assertOriginalOperatorRole();
      const cap=this.#operatorReaderAuthority.authenticate(capturedApproval,before.operatorReaders);
      const prepared=appendOriginalOperatorReaderApproval(before.operatorReaders,cap,this.#operatorReaderAuthority);
      const finalCurrent=()=>{this.#assertOriginalOperatorRole();this.#operatorReaderAuthority.assertCurrent(cap);this.#assertOriginalOperatorRole();};
      const durable=this.#commit(before.snapshot,before.projection,before.recovery,finalCurrent,prepared.state);
      // No external callback follows this original whole-file final observation.
      // A late callback mutation cannot release an approval or exact replay ACK.
      this.#readLatest();
      return captureOriginalRecoveryJSON({readOnly:prepared.readOnly,record:prepared.record,operatorReadersDigest:durable.operatorReadersDigest});
    }finally{this.#busy=false;}
  }
  readOriginalOperatorReaderCheckpoint(operatorId,keyId) {
    if(typeof operatorId!=='string'||typeof keyId!=='string'||!this.#operatorReaderAuthority)fail('ORIGINAL_DEVICE_READER_OPERATOR_NOT_CONFIGURED','Fixed operator reader source unavailable');
    if(this.#busy)fail('STATE_WRITER_BUSY','Original writer owns another transaction');this.#busy=true;
    try{
      const state=this.#readLatest();if(!state.operatorReaders)fail('ORIGINAL_DEVICE_READER_NAMESPACE_UNAVAILABLE','No original operator registration namespace');
      this.#assertOriginalOperatorRole();
      this.#operatorReaderAuthority.assertStored(state.operatorReaders);
      this.#assertOriginalOperatorRole();
      const records=state.operatorReaders.records.filter(r=>r.operatorId===operatorId&&r.keyId===keyId),record=records.at(-1);
      if(!record)fail('ORIGINAL_DEVICE_READER_REGISTRATION_UNAVAILABLE','No durably approved operator reader registration');
      this.#readLatest();return captureOriginalRecoveryJSON({version:'ynx-original-operator-reader-checkpoint/v1',record,operatorReadersDigest:state.operatorReadersDigest,readOnly:true});
    }finally{this.#busy=false;}
  }
  // Only the original registered producer may call this BEFORE its original
  // dispatch. Same operation on a cold retry is readback-only, never a resend.
  reserveOriginalOperation(input, now, originalCurrentRead) {
    if (originalCurrentRead !== undefined && typeof originalCurrentRead !== 'function') fail('PROJECTION_READER_UNAVAILABLE', 'Original current reader is invalid');
    return this.#projectionTransaction(state=>{
      if (originalCurrentRead) {
        const result = originalCurrentRead(state);
        if (result && typeof result.then === 'function') fail('PROJECTION_READER_ASYNC', 'Current observation must remain inside the same original writer');
      }
      return reserveOriginalEffect(state.snapshot, state.projection, input, now);
    });
  }
  // Internal original producer ONLY: verifier is construction-fixed and must
  // authenticate the actual original product intent/full Node commitment.
  // Mapping and UNKNOWN are encoded in ONE original file publication.
  reserveOriginalMappedOperation(input, rawOriginalMapping, now, originalCurrentRead, registeredPublicationCapability) {
    if (typeof this.#mappingVerifier !== 'function') fail('ORIGINAL_MAPPING_PRODUCER_UNAVAILABLE', 'No original mapping producer is configured');
    if (typeof originalCurrentRead !== 'function') fail('PROJECTION_READER_UNAVAILABLE', 'Original same-writer current source is required');
    const originalIdentity=captureOriginalRecoveryIdentity(input);
    const originalMapping=captureOriginalRecoveryJSON(rawOriginalMapping);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_TIME','Original mapped reservation time is invalid');
    const originalAt=new Date(now.getTime());
    return this.#projectionTransaction(state=>{
      if (!state.recovery) fail('RECOVERY_NAMESPACE_UNAVAILABLE', 'Recovery requires explicit stopped-writer format migration');
      const observed = originalCurrentRead(state);
      if (observed && typeof observed.then === 'function') fail('PROJECTION_READER_ASYNC', 'Original current source must remain synchronous');
      const verified = this.#mappingVerifier(Object.freeze({snapshot:state.snapshot,projection:state.projection,recovery:state.recovery}), originalMapping);
      if (verified && typeof verified.then === 'function') fail('PROJECTION_READER_ASYNC', 'Original mapping verification must remain synchronous');
      const mapping = parseOriginalOperationMapping(verified);
      for (const key of Object.keys(originalIdentity)) if (originalIdentity[key] !== mapping[key]) fail('RECOVERY_MAPPING_CONFLICT', 'Original reservation differs from its verified mapping');
      const existing = state.projection.effects.find(value=>value.operationId === originalIdentity.operationId);
      if (existing && !state.recovery.mappings.some(value=>value.operationId === originalIdentity.operationId)) fail('RECOVERY_OLD_MAPPING_UNAVAILABLE', 'Historical effects are never backfilled with guessed associations');
      const prepared = reserveOriginalEffect(state.snapshot, state.projection, originalIdentity, originalAt);
      let recovery = parseOriginalRecoveryState(appendOriginalOperationMapping(state.recovery, mapping), state.snapshot, prepared.projection);
      if (registeredPublicationCapability !== undefined) {
        if (!this.#backendOperationAuth) fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE','Registered publication source is absent');
        const authenticated=this.#backendOperationAuth.assertCurrent(registeredPublicationCapability);
        const consumedAt=this.#originalNow();
        if (!(consumedAt instanceof Date)||!Number.isFinite(consumedAt.getTime())||consumedAt.getTime()<originalAt.getTime()) fail('CLOCK_UNAVAILABLE','Original registered publication clock rolled back');
        recovery=consumeOriginalRecoveryNonce(recovery,authenticated.registration,{readerId:authenticated.registration.readerId,sourceDigest:authenticated.registration.sourceDigest,operationId:mapping.operationId,sessionBinding:mapping.sessionBinding,proofNonce:authenticated.proofNonce,proofExpiresAt:authenticated.proofExpiresAt,consumedAt:consumedAt.toISOString()});
        recovery=parseOriginalRecoveryState(recovery,state.snapshot,prepared.projection);
      }
      const final = originalCurrentRead(state);
      if (final && typeof final.then === 'function') fail('PROJECTION_READER_ASYNC', 'Original final current source must remain synchronous');
      let reservationClockFloor=originalAt.getTime();
      const finalCurrent = ()=>{
        // Mapping callbacks may consume time while returning the same tuple.
        // Revalidate the complete original authority AFTER that callback.
        const checked = this.#mappingVerifier(Object.freeze({snapshot:state.snapshot,projection:state.projection,recovery:state.recovery}),originalMapping);
        if (checked && typeof checked.then === 'function') fail('PROJECTION_READER_ASYNC','Original final mapping verifier must remain synchronous');
        if (canonicalJSON(parseOriginalOperationMapping(checked)) !== canonicalJSON(mapping)) fail('RECOVERY_MAPPING_CONFLICT','Original producer mapping changed before publication');
        const current = originalCurrentRead(state);
        if (registeredPublicationCapability !== undefined) this.#backendOperationAuth.assertCurrent(registeredPublicationCapability);
        if (current && typeof current.then === 'function') fail('PROJECTION_READER_ASYNC','Original final current must remain synchronous');
        if (typeof this.#originalNow !== 'function') fail('ORIGINAL_RESERVATION_CLOCK_UNAVAILABLE','Original finite reservation clock is not configured');
        const observedAt=this.#originalNow();
        if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()) || observedAt.getTime()<reservationClockFloor) fail('CLOCK_UNAVAILABLE','Original reservation clock rolled back');
        const at=new Date(observedAt.getTime()); reservationClockFloor=at.getTime();
        const session=state.snapshot.authority.sessions.find(value=>value.sessionBinding===originalIdentity.sessionBinding);
        if (!session || session.expiresAt<=at.toISOString()) fail('RECOVERY_RELEASE_UNAVAILABLE','Original Session no longer permits finite dispatch release');
        // Host supplies this exact mature signed Action-Proof. Bare internal
        // mappings still require the fixed original current authorization port.
        if (Object.hasOwn(originalMapping,'proof')) verifyProductSessionProofV2(originalMapping.proof,session,{method:mapping.method,path:mapping.path,bodyDigest:mapping.wireDigest},at);
      };
      return Object.freeze({...prepared,recovery,finalCurrent});
    });
  }
  // New explicitly registered readback purpose. Stored original mapping only;
  // revoked but unexpired Session may read, never dispatch or adopt terminal.
  readOriginalRegisteredMappedOperation(input,rawAuthenticated,now) {
    if (!this.#backendOperationAuth || typeof this.#originalNow!=='function') fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE','Registered original recovery source is absent');
    const identity=captureOriginalRecoveryIdentity(input),signed=captureOriginalRecoveryJSON(rawAuthenticated);
    if (!(now instanceof Date)||!Number.isFinite(now.getTime())) fail('INVALID_TIME','Original recovery time is invalid');
    let floor=now.getTime();
    return this.#projectionTransaction(state=>{
      if(!state.recovery)fail('RECOVERY_NAMESPACE_UNAVAILABLE','Original recovery namespace is absent');
      const mapping=state.recovery.mappings.find(value=>value.operationId===identity.operationId);
      const obligation=state.projection.effects.find(value=>value.operationId===identity.operationId);
      if(!mapping||!obligation)fail('RECOVERY_OLD_MAPPING_UNAVAILABLE','No original persisted association exists');
      for(const field of Object.keys(identity))if(mapping[field]!==identity[field]||obligation[field]!==identity[field])fail('RECOVERY_MAPPING_CONFLICT','Original record identity differs');
      const session=state.snapshot.authority.sessions.find(value=>value.sessionBinding===identity.sessionBinding);
      const projection=state.projection.records.find(value=>value.sessionBinding===identity.sessionBinding);
      if(!session||!projection)fail('PROJECTION_ENROLLMENT_UNAVAILABLE','Original stored Session is absent');
      const body=captureOriginalRecoveryJSON({...signed.body,purpose:'mapped-recovery/v1',captured:{session,projection},identity,mapping});
      const capability=this.#backendOperationAuth.authenticate(signed,body);
      floor=Math.max(floor,productSessionControlClockFloor(state.snapshot),...state.recovery.readerNonces.map(value=>Date.parse(value.consumedAt)));
      const finite=()=>{
        const checked=this.#backendOperationAuth.assertCurrent(capability);
        const now=this.#originalNow();
        if(!(now instanceof Date)||!Number.isFinite(now.getTime())||now.getTime()<floor)fail('CLOCK_UNAVAILABLE','Original recovery clock rolled back');
        floor=now.getTime();
        // Check AFTER the last external source callback. Revocation does not
        // renew the signed Session/device proof or grant permission to dispatch.
        if(session.expiresAt<=now.toISOString()||signed.proof.expiresAt<=now.toISOString())fail('RECOVERY_RELEASE_UNAVAILABLE','Original recovery lifetime expired');
        const device=verifyProductSessionProofV2(body.actionProof,session,body.request,now);
        return {checked,device,now};
      };
      const {checked,device,now:consumed}=finite();
      let recovery=consumeOriginalRecoveryNonce(state.recovery,checked.registration,{readerId:checked.registration.readerId,sourceDigest:checked.registration.sourceDigest,operationId:identity.operationId,sessionBinding:identity.sessionBinding,proofNonce:checked.proofNonce,proofExpiresAt:checked.proofExpiresAt,consumedAt:consumed.toISOString()});
      recovery=consumeOriginalRecoveryNonce(recovery,checked.registration,{readerId:checked.registration.readerId,sourceDigest:checked.registration.sourceDigest,operationId:identity.operationId,sessionBinding:identity.sessionBinding,proofNonce:device.nonce,proofExpiresAt:device.expiresAt,consumedAt:consumed.toISOString()});
      recovery=parseOriginalRecoveryState(recovery,state.snapshot,state.projection);
      return Object.freeze({projection:state.projection,recovery,finalCurrent:finite,value:captureOriginalRecoveryJSON({dispatchAllowed:false,readbackOnly:true,obligation,mapping})});
    });
  }
  // Internal revoked-but-UNEXPIRED reader. No public mount/new grant. The
  // fixed installed registration producer binds its trusted original transport
  // descriptor and owning device. Durable mapping and reader nonce ports below
  // are implemented inside this SAME original writer transaction, not echoes.
  readOriginalUnexpiredMappedOperation(input, rawProof, rawRequestBody, now) {
    if (typeof this.#readerRegistration !== 'function' || typeof this.#originalNow !== 'function') fail('ORIGINAL_REGISTERED_READER_UNAVAILABLE', 'Independent registered reader source is not configured');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_TIME','Original reader time is invalid');
    const originalAt=new Date(now.getTime());
    const originalIdentity=captureOriginalRecoveryIdentity(input);
    const originalBytes=captureOriginalReaderBytes(rawRequestBody);
    const proofSnapshot = captureOriginalRecoveryJSON(rawProof);
    let raw, body;
    try { raw = new TextDecoder('utf-8',{fatal:true}).decode(originalBytes); body = JSON.parse(raw); } catch { fail('RECOVERY_REQUEST_INVALID', 'Original read request is not strict UTF-8 JSON'); }
    exactFields(body, ['operationId','sessionBinding','requestDigest'], 'Original read body identity');
    if (canonicalJSON(body) !== raw || canonicalJSON(body) !== canonicalJSON(originalIdentity)) fail('RECOVERY_REQUEST_INVALID', 'Original read body does not exactly bind the requested old record');
    return this.#projectionTransaction(state=>{
      if (!state.recovery) fail('RECOVERY_NAMESPACE_UNAVAILABLE', 'Original recovery format is not present');
      if (!Number.isFinite(originalAt.getTime()) || originalAt.getTime() < productSessionControlClockFloor(state.snapshot)) fail('CLOCK_UNAVAILABLE', 'Original reader clock is behind durable history');
      const obligation = state.projection.effects.find(value=>value.operationId === originalIdentity.operationId);
      const mapping = state.recovery.mappings.find(value=>value.operationId === originalIdentity.operationId);
      if (!obligation || !mapping) fail('RECOVERY_OLD_MAPPING_UNAVAILABLE', 'Original persisted mapping is required');
      for (const key of Object.keys(originalIdentity)) if (mapping[key] !== originalIdentity[key] || obligation[key] !== originalIdentity[key]) fail('RECOVERY_MAPPING_CONFLICT', 'Original recovery identity changed');
      const session = state.snapshot.authority.sessions.find(value=>value.sessionBinding === originalIdentity.sessionBinding);
      const projection = state.projection.records.find(value=>value.sessionBinding === originalIdentity.sessionBinding);
      if (!session || !projection) fail('PROJECTION_ENROLLMENT_UNAVAILABLE', 'Original stored session binding is unavailable');
      const expected = Object.freeze({...originalIdentity,account:session.account,deviceBinding:session.deviceBinding,productId:session.productId});
      const context = Object.freeze({identity:expected,session,projection,obligation});
      let captured, recovery = state.recovery;
      let clockFloor = state.recovery.readerNonces.reduce((floor,value)=>Math.max(floor,Date.parse(value.consumedAt)),originalAt.getTime());
      if (originalAt.getTime() < clockFloor) fail('CLOCK_UNAVAILABLE','Original reader is behind its durable nonce history');
      const clock = ()=>{
        const value = this.#originalNow();
        if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < clockFloor) fail('CLOCK_UNAVAILABLE','Original reader clock rolled back');
        clockFloor = value.getTime(); return new Date(clockFloor);
      };
      const current = (identity, at)=>{
        const observed = this.#readerRegistration(Object.freeze({context:identity,snapshot:state.snapshot,mapping}),at);
        if (observed && typeof observed.then === 'function') fail('PROJECTION_READER_ASYNC', 'Registration verification cannot await under original writer');
        exactFields(observed,['registration','request'],'Original independent registered reader source');
        const registration = parseOriginalReaderRegistration(observed.registration);
        exactFields(observed.request,['method','path','bodyDigest'],'Original registered read transport');
        if (registration.productId !== session.productId || registration.clientId !== session.clientId || registration.platform !== session.platform || registration.account !== session.account || registration.deviceBinding !== session.deviceBinding || observed.request.bodyDigest !== createHash('sha256').update(originalBytes).digest('hex')) fail('RECOVERY_READER_BINDING_MISMATCH','Installed reader does not bind actual owning device/read bytes');
        const frozen = JSON.parse(canonicalJSON({registration,request:observed.request}));
        if (captured && canonicalJSON(frozen) !== canonicalJSON(captured)) fail('RECOVERY_READER_SOURCE_CHANGED','Installed reader changed during the same original transaction');
        captured = frozen;
        return expected;
      };
      const reader = createOriginalUnexpiredOperationReader({
        originalNow:clock,
        assertRegisteredReaderCurrent:current,
        readOriginalRequestBinding:()=>Object.freeze({identity:expected,request:Object.freeze({...captured.request})}),
        consumeOriginalReaderNonce:(_identity,proof,at)=>{
          recovery = consumeOriginalRecoveryNonce(recovery,captured.registration,{readerId:captured.registration.readerId,sourceDigest:captured.registration.sourceDigest,operationId:originalIdentity.operationId,sessionBinding:originalIdentity.sessionBinding,proofNonce:proof.nonce,proofExpiresAt:proof.expiresAt,consumedAt:at.toISOString()});
          recovery = parseOriginalRecoveryState(recovery,state.snapshot,state.projection);
          return Object.freeze({identity:expected,proofNonce:proof.nonce,proofExpiresAt:proof.expiresAt});
        },
      });
      reader(context,proofSnapshot,originalAt);
      const finalCurrent = ()=>{
        const assertLifetime=()=>{
          const at=clock();
          if (session.expiresAt <= at.toISOString() || proofSnapshot.expiresAt <= at.toISOString()) fail('RECOVERY_RELEASE_UNAVAILABLE','Original reader lifetime no longer permits release');
          return at;
        };
        current(context,assertLifetime());
        // This includes the last postpublication source callback. It may have
        // advanced the original clock while returning the same source tuple.
        assertLifetime();
      };
      return Object.freeze({projection:state.projection,recovery,finalCurrent,value:Object.freeze({dispatchAllowed:false,readbackOnly:true,obligation,mapping})});
    });
  }
  // Verifier is a construction-time ORIGINAL authenticated producer capability,
  // never an HTTP result/caller flag. No verifier => closed, no terminal adoption.
  confirmOriginalOperation(operationId, rawReadback) {
    if (typeof this.#effectVerifier !== 'function') fail('EFFECT_PRODUCER_UNAVAILABLE', 'Original authenticated readback producer is not bound');
    return this.#projectionTransaction(state=>{
      const original = state.projection.effects.find(effect=>effect.operationId === operationId);
      if (!original) fail('EFFECT_ORIGINAL_NOT_FOUND', 'No original obligation exists');
      if (state.recovery?.mappings.some(value=>value.operationId === operationId)) fail('MAPPED_EFFECT_READBACK_REQUIRED','Mapped effects require full original mapping terminal verification');
      const result = this.#effectVerifier(original, rawReadback);
      return settleOriginalEffect(state.snapshot, state.projection, operationId, result);
    });
  }
  confirmOriginalMappedOperation(operationId,rawReadback) {
    if (typeof this.#effectVerifier !== 'function') fail('EFFECT_PRODUCER_UNAVAILABLE','No original authenticated terminal producer is configured');
    const originalReadback=captureOriginalRecoveryJSON(rawReadback);
    return this.#projectionTransaction(state=>{
      const original=state.projection.effects.find(value=>value.operationId === operationId);
      const mapping=state.recovery?.mappings.find(value=>value.operationId === operationId);
      if (!original || !mapping) fail('RECOVERY_OLD_MAPPING_UNAVAILABLE','No full original durable association exists');
      const checked=this.#effectVerifier(Object.freeze({obligation:original,mapping}),originalReadback);
      if (checked && typeof checked.then === 'function') fail('PROJECTION_READER_ASYNC','Terminal verification cannot await within the writer');
      exactFields(checked,['mapping','result'],'Authenticated mapped terminal result');
      if (canonicalJSON(parseOriginalOperationMapping(checked.mapping)) !== canonicalJSON(mapping)) fail('EFFECT_READBACK_MISMATCH','Terminal provenance differs from the complete original association');
      return settleOriginalEffect(state.snapshot,state.projection,operationId,checked.result);
    });
  }
  // Independent original-record recovery: revocation/expiry forbid new work,
  // but do not erase an admitted UNKNOWN obligation. This is NOT a grant,
  // HTTP route or caller-supplied authenticated flag. The fixed original reader
  // authenticates the account/device/product and exact request before release.
  readOriginalOperation(input, rawReaderProof, now) {
    exactFields(input, ['operationId','sessionBinding','requestDigest'], 'Original recovery identity');
    for (const field of ['operationId','sessionBinding','requestDigest']) if (typeof input[field] !== 'string' || !/^[0-9a-f]{64}$/.test(input[field])) fail('EFFECT_BARRIER_INVALID', 'Original recovery identity is invalid');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_TIME', 'Original recovery time is unavailable');
    if (typeof this.#recoveryReader !== 'function') fail('EFFECT_RECOVERY_READER_UNAVAILABLE', 'Original authenticated operation reader is not bound');
    return this.withOriginalProjectedAuthority(state=>{
      if (state.recovery?.mappings.some(value=>value.operationId === input.operationId)) fail('MAPPED_RECOVERY_READER_REQUIRED','Mapped effects require same-commit authenticated reader nonce consumption');
      if (now.getTime() < productSessionControlClockFloor(state.snapshot)) fail('CLOCK_UNAVAILABLE', 'Original recovery clock is behind durable authority history');
      const obligation = state.projection.effects.find(effect=>effect.operationId === input.operationId);
      if (!obligation) fail('EFFECT_ORIGINAL_NOT_FOUND', 'No original obligation exists');
      if (obligation.sessionBinding !== input.sessionBinding || obligation.requestDigest !== input.requestDigest) fail('EFFECT_BINDING_CONFLICT', 'Recovery differs from the original request');
      const session = state.snapshot.authority.sessions.find(value=>value.sessionBinding === obligation.sessionBinding);
      const projection = state.projection.records.find(value=>value.sessionBinding === obligation.sessionBinding);
      if (!session || !projection) fail('PROJECTION_ENROLLMENT_UNAVAILABLE', 'Original recovery has no stored binding');
      const expected = Object.freeze({operationId:obligation.operationId, sessionBinding:session.sessionBinding, requestDigest:obligation.requestDigest, account:session.account, deviceBinding:session.deviceBinding, productId:session.productId});
      const context = Object.freeze({identity:expected, session, projection, obligation});
      const observed = this.#recoveryReader(context, rawReaderProof, new Date(now.getTime()));
      if (observed && typeof observed.then === 'function') fail('PROJECTION_READER_ASYNC', 'Original authentication must complete inside the same writer');
      exactFields(observed, Object.keys(expected), 'Authenticated original recovery identity');
      if (canonicalJSON(observed) !== canonicalJSON(expected)) fail('EFFECT_RECOVERY_READER_MISMATCH', 'Authenticated reader differs from the original operation');
      return Object.freeze({dispatchAllowed:false, readbackOnly:true, obligation});
    });
  }
  assertOriginalIntentEffectObligationsClosed(intentInput) {
    const intent = parseProductSessionControlIntent(intentInput);
    const state = this.#readLatest();
    if (!state.projection) return; // Original envelope-two compatibility only.
    const sessions = new Map(state.snapshot.authority.sessions.map(session=>[session.sessionBinding, session]));
    // Include previously revoked AND expired original sessions. The receipt's
    // newly-revoked list is not the scope of outstanding original obligations.
    if (state.projection.effects.some(effect=>{
      if (effect.state !== 'unknown') return false;
      const session = sessions.get(effect.sessionBinding);
      return session?.account === intent.account &&
        (intent.operation === 'account-logout' || session.deviceBinding === intent.body.deviceBinding);
    })) fail('EFFECT_OUTCOME_UNKNOWN', 'Original admitted operation still has an unconfirmed outcome; read the original record without redispatch');
  }
  originalRevocationReadback(sessionBinding) {
    const state = this.#readLatest();
    if (!state.projection) fail('PROJECTION_ENROLLMENT_UNAVAILABLE', 'Original projection is not present');
    return originalRevocationBarrier(state.snapshot, state.projection, sessionBinding);
  }
  #projectionTransaction(action) {
    if (this.#busy) fail('STATE_WRITER_BUSY', 'Original writer already owns a transaction');
    this.#busy = true;
    try {
      const state = this.#readLatest();
      if (!state.projection) fail('PROJECTION_ENROLLMENT_UNAVAILABLE', 'Original projection is not present');
      const prepared = action(state);
      this.#commit(state.snapshot, prepared.projection, prepared.recovery ?? state.recovery, prepared.finalCurrent);
      return prepared.value;
    } finally {this.#busy = false;}
  }
  transact(action) {
    if (this.#busy) fail("STATE_WRITER_BUSY", "The control state writer is already executing a transaction");
    this.#busy = true;
    try {
      const before = this.#readLatest(), prepared = action(before.snapshot);
      exactFields(prepared, ["snapshot", "value"], "Control writer candidate");
      const next = parseProductSessionControlSnapshot(prepared.snapshot);
      const projection = before.projection
        ? advanceOriginalSessionProjection(before.snapshot, next, before.projection, this.#projectionTokens)
        : undefined;
      const durable = this.#commit(next, projection);
      return Object.freeze({ value: prepared.value, snapshot: durable.snapshot });
    } finally { this.#busy = false; }
  }
  #adopt(loaded) { this.#identity = loaded.identity; this.#pending = null; }
  #readLatest() {
    let loaded;
    try { safeDirectory(this.#path, this.#io, false); loaded = readState(this.#path, this.#io); }
    catch (error) {
      if (error instanceof WalletAuthError && error.code !== "STATE_READ_FAILED") throw error;
      fail(this.#pending ? "STATE_DURABILITY_UNCERTAIN" : "STATE_READ_FAILED", "The latest control state cannot be read; no revocation confirmation is available");
    }
    if (!loaded) fail("STATE_TAMPERED", "Control state disappeared; an empty state must not replace it");
    if (this.#pending) {
      if (sameIdentity(loaded.identity, this.#pending.before)) {
        // The rename did not take effect. Preserve the original durable state;
        // no earlier cutoff was established by the abandoned preparation.
        this.#adopt(loaded); return loaded;
      }
      if (loaded.snapshotDigest !== this.#pending.digest || !sameIdentity(loaded.identity, this.#pending.after)) fail("STATE_TAMPERED", "Control state differs from both sides of the interrupted write");
      // Own rename may have succeeded before directory sync/readback failed.
      // Re-establish durability of those exact latest bytes, never write back
      // the older in-memory snapshot. A failed recovery still confirms nothing.
      const observed = loaded.identity;
      try { syncExisting(this.#path, this.#io); loaded = readState(this.#path, this.#io); }
      catch { fail("STATE_DURABILITY_UNCERTAIN", "The latest control state still cannot be confirmed durably; retry the same intent"); }
      if (!loaded || !sameIdentity(observed, loaded.identity)) fail("STATE_TAMPERED", "Control state changed during interrupted-write recovery");
      this.#adopt(loaded); return loaded;
    }
    if (!sameIdentity(loaded.identity, this.#identity)) fail("STATE_TAMPERED", "Control state identity changed outside the writer");
    return loaded;
  }
  #commit(snapshot, projection, recovery, finalCurrent, operatorReaders, resourceRegistry) {
    const before = this.#readLatest(), encoded = before.resourceRegistry
      ? encodeDeveloperResourceState(snapshot,projection,recovery??before.recovery,operatorReaders??before.operatorReaders,resourceRegistry??before.resourceRegistry) : before.operatorReaders
      ? encodeOperatorReaderState(snapshot,projection,recovery ?? before.recovery,operatorReaders ?? before.operatorReaders) : before.projection
      ? before.recovery ? encodeRecoveryState(snapshot, projection, recovery ?? before.recovery) : encodeProjectedState(snapshot, projection) : encodeState(snapshot);
    if (digest(snapshot) === before.snapshotDigest && (!before.projection || digest(projection) === before.projectionDigest) && (!before.recovery || digest(recovery ?? before.recovery) === before.recoveryDigest) && (!before.operatorReaders || digest(operatorReaders ?? before.operatorReaders) === before.operatorReadersDigest) && (!before.resourceRegistry || digest(resourceRegistry??before.resourceRegistry)===before.resourceRegistryDigest)) { if (finalCurrent) finalCurrent(); return before; }
    if (finalCurrent) finalCurrent();
    const directory = safeDirectory(this.#path, this.#io), temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = this.#io.openSync(temporary, filesystem.constants.O_WRONLY | filesystem.constants.O_CREAT | filesystem.constants.O_EXCL | noFollow(), 0o600);
      this.#io.writeFileSync(descriptor, encoded, "utf8"); this.#io.fchmodSync(descriptor, 0o600); this.#io.fsyncSync(descriptor);
      const written = this.#io.fstatSync(descriptor); safeStat(written); this.#io.closeSync(descriptor); descriptor = undefined;
      // Identity is checked immediately before the only live-file mutation.
      if (finalCurrent) finalCurrent();
      if (!sameIdentity(readState(this.#path, this.#io)?.identity, before.identity)) fail("STATE_TAMPERED", "Control state changed before commit");
      this.#pending = { before: before.identity, digest: digest(snapshot), after: { dev: written.dev, ino: written.ino, size: written.size, digest: digest(encoded) } };
      this.#io.renameSync(temporary, this.#path);
      syncDirectory(directory, this.#io);
      const loaded = readState(this.#path, this.#io);
      if (!loaded || loaded.snapshotDigest !== this.#pending.digest || !sameIdentity(loaded.identity, this.#pending.after)) fail("STATE_TAMPERED", "Control state did not read back as its exact candidate");
      this.#adopt(loaded); if (finalCurrent) { try { finalCurrent(); } catch { fail('RECOVERY_RELEASE_UNAVAILABLE', 'Reader nonce is durably consumed but final current no longer permits record release'); } } return loaded;
    } catch (error) {
      if (this.#pending) fail("STATE_DURABILITY_UNCERTAIN", "Control state persistence may have committed; retry the same intent to learn its outcome");
      if (error instanceof WalletAuthError && (error.code.startsWith("STATE_") || error.code === "RECOVERY_RELEASE_UNAVAILABLE")) throw error;
      fail("STATE_WRITE_FAILED", "Control state could not be saved; no revocation confirmation is available");
    } finally {
      if (descriptor !== undefined) this.#io.closeSync(descriptor);
      // An unlinked temporary is never a live state. Cleanup failure must not
      // replace the precise commit/unknown outcome or restore older bytes.
      try { this.#io.unlinkSync(temporary); } catch {}
    }
  }
}

/** Explicit creation only. A serving host never silently creates missing state. */
export function initializeProductSessionControlState(statePath, snapshot, io = filesystem) {
  const path = absolute(statePath), encoded = encodeState(parseProductSessionControlSnapshot(snapshot));
  writeExclusive(path, encoded, io);
  const loaded = readState(path, io);
  if (!loaded || loaded.snapshotDigest !== digest(snapshot)) fail("STATE_TAMPERED", "Initialized control state did not read back exactly");
  return Object.freeze({ snapshotDigest: loaded.snapshotDigest });
}

/** Caller must stop every source writer and hold its release lock throughout. */
export function migrateProductSessionControlStateFileV2({ sourcePath, targetPath, backupPath, expectedSourceDigest }, io = filesystem) {
  const source = absolute(sourcePath), target = absolute(targetPath), backup = absolute(backupPath);
  if (new Set([source, target, backup]).size !== 3 || !/^[0-9a-f]{64}$/.test(expectedSourceDigest)) fail("INVALID_STATE_MIGRATION", "Offline migration requires three distinct paths and an exact stopped source digest");
  const before = readOwned(source, io);
  if (!before || digest(before.raw) !== expectedSourceDigest) fail("STATE_TAMPERED", "Offline migration source is missing or differs from the expected stopped bytes");
  const old = parseEnvelope(before.raw, 1), snapshot = migrateProductSessionControlSnapshotV2(parseProductSessionGatewaySnapshot(old.snapshot));
  // O_EXCL prevents overwriting either an earlier backup or a latest v3 state.
  if (io.existsSync(target) || io.existsSync(backup)) fail("STATE_TARGET_EXISTS", "Migration never overwrites an existing target or backup");
  writeExclusive(backup, before.raw, io);
  if (!sameIdentity(readOwned(source, io)?.identity, before.identity)) fail("STATE_TAMPERED", "Source changed while preserving its migration backup; do not activate the target");
  initializeProductSessionControlState(target, snapshot, io);
  if (!sameIdentity(readOwned(source, io)?.identity, before.identity)) fail("STATE_TAMPERED", "Source was not quiescent throughout migration; do not activate the target");
  return Object.freeze({ sourceDigest: expectedSourceDigest, backupDigest: digest(readOwned(backup, io).raw), targetDigest: readState(target, io).snapshotDigest, snapshotSchemaVersion: 3, rollbackRequiresVersionThree: true });
}

function encodeState(snapshot) {
  const encoded = canonicalJSON({ schemaVersion: PRODUCT_SESSION_CONTROL_NODE_SCHEMA_VERSION, snapshotDigest: digest(snapshot), snapshot });
  if (Buffer.byteLength(encoded) > MAX_BYTES) fail("STATE_CAPACITY", "Control state exceeds the durable file capacity");
  return encoded;
}
function parseEnvelope(raw, version) {
  let value; try { value = JSON.parse(raw); } catch { fail("STATE_TAMPERED", "Control state is not valid JSON"); }
  exactFields(value, ["schemaVersion", "snapshotDigest", "snapshot"], "Product Session persisted state");
  if (value.schemaVersion !== version || !/^[0-9a-f]{64}$/.test(value.snapshotDigest) || digest(value.snapshot) !== value.snapshotDigest || canonicalJSON(value) !== raw) fail("STATE_TAMPERED", "Persisted state schema or canonical digest is invalid; explicit migration is required");
  return value;
}
function readState(path, io) {
  const loaded = readOwned(path, io); if (!loaded) return null;
  let version; try { version = JSON.parse(loaded.raw).schemaVersion; } catch { fail("STATE_TAMPERED", "Control state is not valid JSON"); }
  const envelope = version === ORIGINAL_DEVELOPER_RESOURCE_ENVELOPE_VERSION
    ? parseOriginalDeveloperResourcePersistedState(loaded.raw) : version === ORIGINAL_OPERATOR_READER_ENVELOPE_VERSION
    ? parseOriginalOperatorReaderPersistedState(loaded.raw) : version === ORIGINAL_DURABLE_RECOVERY_ENVELOPE_VERSION
    ? parseOriginalRecoveryPersistedState(loaded.raw) : version === ORIGINAL_SESSION_PROJECTION_ENVELOPE_VERSION
    ? parseOriginalProjectedPersistedState(loaded.raw) : parseProductSessionControlPersistedState(loaded.raw);
  return { ...envelope, identity: loaded.identity };
}
function readOwned(path, io) {
  let descriptor;
  try { descriptor = io.openSync(path, filesystem.constants.O_RDONLY | noFollow()); }
  catch (error) { if (error?.code === "ENOENT") return null; if (error?.code === "ELOOP") fail("STATE_PERMISSIONS", "Control state cannot be a symbolic link"); throw error; }
  try {
    const stat = io.fstatSync(descriptor); safeStat(stat);
    const raw = io.readFileSync(descriptor, "utf8");
    return { raw, identity: { dev: stat.dev, ino: stat.ino, size: stat.size, digest: digest(raw) } };
  } finally { io.closeSync(descriptor); }
}
function safeStat(stat) {
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES || !owned(stat)) fail("STATE_PERMISSIONS", "Control state must be one owner-bound mode-0600 regular file");
}
function safeDirectory(path, io, create = true) {
  const directory = dirname(path); if (create) io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = io.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || !owned(stat)) fail("STATE_PERMISSIONS", "Control state directory must be a real owner-bound mode-0700 directory");
  return directory;
}
function writeExclusive(path, raw, io) {
  const directory = safeDirectory(path, io); let descriptor;
  try {
    descriptor = io.openSync(path, filesystem.constants.O_WRONLY | filesystem.constants.O_CREAT | filesystem.constants.O_EXCL | noFollow(), 0o600);
    io.writeFileSync(descriptor, raw, "utf8"); io.fsyncSync(descriptor); safeStat(io.fstatSync(descriptor));
    io.closeSync(descriptor); descriptor = undefined; syncDirectory(directory, io);
    if (readOwned(path, io)?.raw !== raw) fail("STATE_TAMPERED", "Explicit state copy did not read back exactly");
  } finally { if (descriptor !== undefined) io.closeSync(descriptor); }
}
function syncExisting(path, io) {
  const descriptor = io.openSync(path, filesystem.constants.O_RDWR | noFollow());
  try { safeStat(io.fstatSync(descriptor)); io.fsyncSync(descriptor); } finally { io.closeSync(descriptor); }
  syncDirectory(safeDirectory(path, io), io);
}
function syncDirectory(path, io) { const descriptor = io.openSync(path, filesystem.constants.O_RDONLY); try { io.fsyncSync(descriptor); } finally { io.closeSync(descriptor); } }
function owned(stat) { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
function sameIdentity(a, b) { return Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.digest === b.digest); }
function absolute(path) { if (typeof path !== "string" || !isAbsolute(path) || path === "/" || resolve(path) !== path) fail("INVALID_STATE_PATH", "Control state requires a canonical absolute file path"); return path; }
function noFollow() { return filesystem.constants.O_NOFOLLOW ?? 0; }
function fail(code, message) { throw new WalletAuthError(code, message); }

// Separate exact envelope version; old schema2 encoding/parser stay unchanged.
// There is no serving-startup creation, migration or old-session backfill.
export function parseOriginalProjectedPersistedState(raw) {
  let value; try { value = JSON.parse(raw); } catch { fail("STATE_TAMPERED", "Projection state is not valid JSON"); }
  exactFields(value, ["schemaVersion", "snapshotDigest", "snapshot", "projectionDigest", "projection"], "Original projected authority state");
  if (value.schemaVersion !== ORIGINAL_SESSION_PROJECTION_ENVELOPE_VERSION ||
      typeof value.snapshotDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.snapshotDigest) ||
      typeof value.projectionDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.projectionDigest) ||
      digest(value.snapshot) !== value.snapshotDigest || digest(value.projection) !== value.projectionDigest ||
      canonicalJSON(value) !== raw) fail("STATE_TAMPERED", "Projection state requires exact canonical digests and version");
  const snapshot = parseProductSessionControlSnapshot(value.snapshot);
  const projection = parseOriginalSessionProjection(value.projection, snapshot);
  return Object.freeze({...value, snapshot, projection});
}
function encodeProjectedState(snapshot, projection) {
  const checked = parseOriginalSessionProjection(projection, snapshot);
  const encoded = canonicalJSON({schemaVersion:ORIGINAL_SESSION_PROJECTION_ENVELOPE_VERSION,
    snapshotDigest:digest(snapshot), snapshot, projectionDigest:digest(checked), projection:checked});
  if (Buffer.byteLength(encoded) > MAX_BYTES) fail("STATE_CAPACITY", "Projected authority exceeds original durable capacity");
  return encoded;
}
// Explicit stopped-writer migration only. Source and backup retain exact old
// bytes; every old Session remains unenrolled in an EMPTY projection namespace.
export function migrateOriginalSessionProjectionFile({sourcePath, targetPath, backupPath, expectedSourceDigest}, io = filesystem) {
  const source = absolute(sourcePath), target = absolute(targetPath), backup = absolute(backupPath);
  if (new Set([source,target,backup]).size !== 3 || typeof expectedSourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(expectedSourceDigest)) fail("INVALID_STATE_MIGRATION", "Original projection migration needs distinct canonical paths and a stopped source digest");
  const before = readOwned(source, io);
  if (!before || digest(before.raw) !== expectedSourceDigest) fail("STATE_TAMPERED", "Original stopped authority source does not match");
  const original = parseProductSessionControlPersistedState(before.raw);
  if (io.existsSync(target) || io.existsSync(backup)) fail("STATE_TARGET_EXISTS", "Projection migration never overwrites existing paths");
  writeExclusive(backup, before.raw, io);
  if (!sameIdentity(readOwned(source, io)?.identity, before.identity)) fail("STATE_TAMPERED", "Source changed while retaining original backup");
  writeExclusive(target, encodeProjectedState(original.snapshot, emptyOriginalSessionProjection()), io);
  const projected = readState(target, io);
  if (!projected || projected.snapshotDigest !== original.snapshotDigest || projected.projection.records.length !== 0 ||
      !sameIdentity(readOwned(source, io)?.identity, before.identity)) fail("STATE_TAMPERED", "Stopped migration did not preserve the original snapshot");
  return Object.freeze({sourceDigest:expectedSourceDigest, targetDigest:projected.identity.digest,
    oldSessionsEnrolled:false, activationApproved:false, rollbackRequiresProjectionCompatibleWriter:true});
}

// Exact sibling envelope, not a silent extension accepted by the old writer.
// Old schema2/3 stay byte-compatible and cannot reserve/read mapped operations.
export function parseOriginalRecoveryPersistedState(raw) {
  let value; try { value = JSON.parse(raw); } catch { fail('STATE_TAMPERED','Recovery state is not valid JSON'); }
  exactFields(value,['schemaVersion','snapshotDigest','snapshot','projectionDigest','projection','recoveryDigest','recovery'],'Original recovery persisted state');
  if (value.schemaVersion !== ORIGINAL_DURABLE_RECOVERY_ENVELOPE_VERSION || canonicalJSON(value) !== raw ||
      value.snapshotDigest !== digest(value.snapshot) || value.projectionDigest !== digest(value.projection) || value.recoveryDigest !== digest(value.recovery)) fail('STATE_TAMPERED','Recovery state requires exact original canonical digests');
  const snapshot = parseProductSessionControlSnapshot(value.snapshot);
  const projection = parseOriginalSessionProjection(value.projection,snapshot);
  const recovery = parseOriginalRecoveryState(value.recovery,snapshot,projection);
  return Object.freeze({...value,snapshot,projection,recovery});
}
function encodeRecoveryState(snapshot,projection,recovery) {
  const checkedProjection = parseOriginalSessionProjection(projection,snapshot);
  const checkedRecovery = parseOriginalRecoveryState(recovery,snapshot,checkedProjection);
  const raw = canonicalJSON({schemaVersion:ORIGINAL_DURABLE_RECOVERY_ENVELOPE_VERSION,snapshotDigest:digest(snapshot),snapshot,projectionDigest:digest(checkedProjection),projection:checkedProjection,recoveryDigest:digest(checkedRecovery),recovery:checkedRecovery});
  if (Buffer.byteLength(raw) > MAX_BYTES) fail('STATE_CAPACITY','Original mapped recovery exceeds original file capacity');
  return raw;
}
// Offline only. Preserve exact source+backup, empty new namespace; do not derive
// missing historical mappings or registrations from old Sessions/SSO/receipts.
export function migrateOriginalDurableRecoveryFile({sourcePath,targetPath,backupPath,expectedSourceDigest},io=filesystem) {
  const source=absolute(sourcePath),target=absolute(targetPath),backup=absolute(backupPath);
  if (new Set([source,target,backup]).size !== 3 || typeof expectedSourceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSourceDigest)) fail('INVALID_STATE_MIGRATION','Stopped migration requires distinct original paths and digest');
  const before=readOwned(source,io);
  if (!before || digest(before.raw) !== expectedSourceDigest) fail('STATE_TAMPERED','Original stopped source differs');
  const old=parseOriginalProjectedPersistedState(before.raw);
  if (io.existsSync(target) || io.existsSync(backup)) fail('STATE_TARGET_EXISTS','Never overwrite existing target/backup');
  writeExclusive(backup,before.raw,io);
  if (!sameIdentity(readOwned(source,io)?.identity,before.identity)) fail('STATE_TAMPERED','Original source changed during backup');
  writeExclusive(target,encodeRecoveryState(old.snapshot,old.projection,emptyOriginalRecoveryState()),io);
  const loaded=readState(target,io);
  if (!loaded || loaded.snapshotDigest !== old.snapshotDigest || loaded.projectionDigest !== old.projectionDigest || loaded.recovery.mappings.length !== 0 || !sameIdentity(readOwned(source,io)?.identity,before.identity)) fail('STATE_TAMPERED','Stopped migration did not preserve original history');
  return Object.freeze({sourceDigest:expectedSourceDigest,targetDigest:loaded.identity.digest,historicalMappingsAdded:false,registrationsCreated:false,activationApproved:false,rollbackRequiresRecoveryCompatibleWriter:true});
}

// Explicit NEW envelope, preserving all old snapshot/projection/recovery bytes.
export function parseOriginalOperatorReaderPersistedState(raw){
 let value;try{value=JSON.parse(raw);}catch{fail('STATE_TAMPERED','Operator registry state is invalid JSON');}
 exactFields(value,['schemaVersion','snapshotDigest','snapshot','projectionDigest','projection','recoveryDigest','recovery','operatorReadersDigest','operatorReaders'],'Original operator registration persisted state');
 if(value.schemaVersion!==ORIGINAL_OPERATOR_READER_ENVELOPE_VERSION||canonicalJSON(value)!==raw||value.snapshotDigest!==digest(value.snapshot)||value.projectionDigest!==digest(value.projection)||value.recoveryDigest!==digest(value.recovery)||value.operatorReadersDigest!==digest(value.operatorReaders))fail('STATE_TAMPERED','Operator registry state requires original canonical digests');
 const base=parseOriginalRecoveryPersistedState(canonicalJSON({schemaVersion:ORIGINAL_DURABLE_RECOVERY_ENVELOPE_VERSION,snapshotDigest:value.snapshotDigest,snapshot:value.snapshot,projectionDigest:value.projectionDigest,projection:value.projection,recoveryDigest:value.recoveryDigest,recovery:value.recovery}));
 return Object.freeze({...value,snapshot:base.snapshot,projection:base.projection,recovery:base.recovery,operatorReaders:parseOriginalOperatorReaderState(value.operatorReaders)});
}
function encodeOperatorReaderState(snapshot,projection,recovery,operatorReaders){
 const base=parseOriginalRecoveryPersistedState(encodeRecoveryState(snapshot,projection,recovery)),checked=parseOriginalOperatorReaderState(operatorReaders);
 const raw=canonicalJSON({...base,schemaVersion:ORIGINAL_OPERATOR_READER_ENVELOPE_VERSION,operatorReadersDigest:digest(checked),operatorReaders:checked});
 if(Buffer.byteLength(raw)>MAX_BYTES)fail('STATE_CAPACITY','Operator registry exceeds original durable file capacity');return raw;
}
// Exact new resource namespace. The immutable original signed Session and
// proof are validated at their stored approval time, not renewed on cold read.
export function parseOriginalDeveloperResourcePersistedState(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_BYTES)fail('STATE_CAPACITY','Original resource state exceeds original file budget');
 let value;try{value=JSON.parse(raw);}catch{fail('STATE_TAMPERED','Original resource state is invalid JSON');}
 exactFields(value,['schemaVersion','snapshotDigest','snapshot','projectionDigest','projection','recoveryDigest','recovery','operatorReadersDigest','operatorReaders','resourceRegistryDigest','resourceRegistry'],'Original resource persisted state');
 if(value.schemaVersion!==ORIGINAL_DEVELOPER_RESOURCE_ENVELOPE_VERSION||canonicalJSON(value)!==raw||value.resourceRegistryDigest!==digest(value.resourceRegistry))fail('STATE_TAMPERED','Original resource envelope or digest differs');
 const {resourceRegistry,resourceRegistryDigest,...old}=value;
 const base=parseOriginalOperatorReaderPersistedState(canonicalJSON({...old,schemaVersion:ORIGINAL_OPERATOR_READER_ENVELOPE_VERSION}));
 const checked=parseOriginalDeveloperResourceRegistryState(resourceRegistry);
 for(const row of checked.records){
  const mappings=base.recovery.mappings.filter(m=>m.sessionBinding===row.actor.session.sessionBinding&&m.productOperationId===row.request.intentId);
  if(mappings.length!==1)fail('STATE_TAMPERED','Resource approval must retain exactly its original association');
  const m=mappings[0],effect=base.projection.effects.find(e=>e.operationId===m.operationId);
  const commitment={version:'ynx-original-developer-resource-node-commitment/v1',actor:row.actor,actionProof:row.actionProof,approval:JSON.parse(row.approval),request:row.request,domainObservation:row.domainObservation,productOperationId:row.request.intentId};
  if(!effect||m.requestDigest!==digest(commitment)||m.method!==row.request.method||m.path!==row.request.path||m.actionNonce!==row.actionNonce||m.actionBodyDigest!==row.request.bodyDigest||m.wireDigest!==row.request.bodyDigest)fail('STATE_TAMPERED','Resource nonce, body or Node commitment differs');
 }
 return Object.freeze({...base,schemaVersion:ORIGINAL_DEVELOPER_RESOURCE_ENVELOPE_VERSION,resourceRegistry:checked,resourceRegistryDigest});
}
function encodeDeveloperResourceState(snapshot,projection,recovery,operatorReaders,resourceRegistry){
 const base=parseOriginalOperatorReaderPersistedState(encodeOperatorReaderState(snapshot,projection,recovery,operatorReaders)),metadata=parseOriginalDeveloperResourceRegistryState(resourceRegistry);
 const raw=canonicalJSON({...base,schemaVersion:ORIGINAL_DEVELOPER_RESOURCE_ENVELOPE_VERSION,resourceRegistry:metadata,resourceRegistryDigest:digest(metadata)});
 parseOriginalDeveloperResourcePersistedState(raw);return raw;
}
// Pure candidate only: no file writes, old records retained, no source role or
// migration is approved by generating these bytes. Once written, older schema5
// writers must not be used as rollback writers.
export function createOriginalDeveloperResourceEnvelopeCandidate(rawSchema5){
 const before=parseOriginalOperatorReaderPersistedState(rawSchema5);
 return encodeDeveloperResourceState(before.snapshot,before.projection,before.recovery,before.operatorReaders,emptyOriginalDeveloperResourceRegistryState());
}
function captureOriginalDeveloperResourceData(raw,max=147456){
 const seen=new Set();let nodes=0,budget=0;
 function copy(value,depth){
  if(++nodes>100000||depth>32)fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource input exceeds its bounded structure');
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isSafeInteger(value))return value;
  if(typeof value==='string'){budget+=Buffer.byteLength(value);if(budget>max)fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource input exceeds its byte cap');return value;}
  if(!value||typeof value!=='object'||types.isProxy(value)||seen.has(value))fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource input must be detached data');
  seen.add(value);const array=Array.isArray(value),out=array?[]:{};
  if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype))fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource input prototype is not data');
  const keys=Reflect.ownKeys(value);
  if(array&&(keys.length!==value.length+1||keys.some(key=>key!=='length'&&(typeof key!=='string'||!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length))))fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource array is sparse or extended');
  for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource input cannot invoke accessors');Object.defineProperty(out,key,{value:copy(d.value,depth+1),enumerable:true});}
  seen.delete(value);return Object.freeze(out);
 }
 const captured=copy(raw,0);if(Buffer.byteLength(canonicalJSON(captured))>max)fail('ORIGINAL_RESOURCE_INPUT_INVALID','Resource envelope exceeds its byte cap');return captured;
}
function detachOriginalDeveloperResourceWire(raw){
 if(!raw||typeof raw!=='object'||types.isProxy(raw)||!types.isUint8Array(raw))fail('ORIGINAL_RESOURCE_WIRE_INVALID','Exact raw wire required');
 const proto=Object.getPrototypeOf(Uint8Array.prototype);let length,buffer;
 try{length=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(raw);buffer=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(raw);}catch{fail('ORIGINAL_RESOURCE_WIRE_INVALID','Raw wire view unavailable');}
 if(!Number.isSafeInteger(length)||length<1||length>16*1024*1024||!(buffer instanceof ArrayBuffer))fail('ORIGINAL_RESOURCE_WIRE_INVALID','Raw wire must be bounded and not shared');
 const copy=new Uint8Array(length);Uint8Array.prototype.set.call(copy,raw);return copy;
}
// OFFLINE source implementation only; no serving startup auto-migration.
export function migrateOriginalOperatorReaderFile({sourcePath,targetPath,backupPath,expectedSourceDigest},io=filesystem){
 const source=absolute(sourcePath),target=absolute(targetPath),backup=absolute(backupPath);
 if(new Set([source,target,backup]).size!==3||typeof expectedSourceDigest!=='string'||!/^[0-9a-f]{64}$/.test(expectedSourceDigest))fail('INVALID_STATE_MIGRATION','Distinct stopped-writer paths and original digest required');
 const before=readOwned(source,io);if(!before||digest(before.raw)!==expectedSourceDigest)fail('STATE_TAMPERED','Original stopped source differs');const old=parseOriginalRecoveryPersistedState(before.raw);
 if(io.existsSync(target)||io.existsSync(backup))fail('STATE_TARGET_EXISTS','Migration cannot overwrite target/backup');writeExclusive(backup,before.raw,io);
 if(!sameIdentity(readOwned(source,io)?.identity,before.identity))fail('STATE_TAMPERED','Original source changed while preserving backup');
 writeExclusive(target,encodeOperatorReaderState(old.snapshot,old.projection,old.recovery,emptyOriginalOperatorReaderState()),io);const next=readState(target,io);
 if(!next||next.snapshotDigest!==old.snapshotDigest||next.projectionDigest!==old.projectionDigest||next.recoveryDigest!==old.recoveryDigest||next.operatorReaders.records.length!==0||!sameIdentity(readOwned(source,io)?.identity,before.identity))fail('STATE_TAMPERED','Explicit migration failed exact original history preservation');
 return Object.freeze({sourceDigest:expectedSourceDigest,targetDigest:next.identity.digest,registrationsCreated:false,activationApproved:false,rollbackRequiresOperatorCompatibleWriter:true});
}
