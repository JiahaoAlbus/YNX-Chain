// Independent Main selection for the SAME already-created device. These DATA
// observations never grant Source admission or a registered/private-item write.
import {types} from 'node:util';
import {inspectOriginalDeviceCreateIntentDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';
import {isOriginalSelectedPQAccountPublicLease} from '../password-wallet-vault.mjs';

const peers = new WeakMap();
const identityKeys = ['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'];
const selectionKeys = ['identityBinding','originalCreationTerms19','originalGeneration','originalCreationOperation','originalRegistrationOperation'];
const applicationKeys = ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'];
const fail = code => { throw Object.assign(new Error(code), {code}); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype)
    fail('AUTH_DEVICE_FINALIZATION_ORIGINAL_REVIEW_REQUIRED');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(k => !descriptors[k] || !Object.hasOwn(descriptors[k], 'value') || !descriptors[k].enumerable))
    fail('AUTH_DEVICE_FINALIZATION_ORIGINAL_REVIEW_REQUIRED');
  return Object.fromEntries(keys.map(k => [k, descriptors[k].value]));
}
function retire(state, ...causes) {
  if (!state.retired) {
    state.retired = true;
    state.cause = causes.length ? causes[0] : Object.assign(new Error('AUTH_DEVICE_FINALIZATION_SELECTION_RETIRED'), {code:'AUTH_DEVICE_FINALIZATION_SELECTION_RETIRED'});
  }
}
function current(state) {
  if (state.retired) throw state.cause;
  try {
    state.selected.assertCurrent();
    const selected = state.selected.readPublic();
    if (selected.account !== state.data.identityBinding.canonicalOwner || selected.networkId !== state.data.identityBinding.networkId)
      fail('AUTH_DEVICE_FINALIZATION_SELECTED_ACCOUNT_CHANGED');
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < state.clockFloor) fail('AUTH_DEVICE_FINALIZATION_CLOCK_ROLLBACK');
    state.clockFloor = now;
  } catch (cause) { retire(state, cause); throw cause; }
}
function original(peer) {
  const state = peers.get(peer);
  if (!state) fail('AUTH_DEVICE_FINALIZATION_ORIGINAL_SELECTION_REQUIRED');
  current(state);
  return state;
}

// Main supplies the original independent protected Source review and a genuine
// Vault lease. Native must independently reopen/compare its protected same-item
// originals and fresh finalization Source/current; this peer is selection only.
export function captureOriginalDeviceV4RegisteredFinalizationSelection(originalReview, selectedPublicLease, independentApplicationBinding) {
  if (arguments.length !== 3 || !isOriginalSelectedPQAccountPublicLease(selectedPublicLease))
    fail('AUTH_DEVICE_FINALIZATION_SELECTED_ACCOUNT_REQUIRED');
  const review = exact(originalReview, [...selectionKeys,'dataOnly','SourceAdmission','NativeAdmission']);
  if (review.dataOnly !== true || review.SourceAdmission !== false || review.NativeAdmission !== false || typeof review.originalCreationTerms19 !== 'string' || Buffer.byteLength(review.originalCreationTerms19) > 16384)
    fail('AUTH_DEVICE_FINALIZATION_ORIGINAL_REVIEW_REQUIRED');
  const terms = inspectOriginalDeviceCreateIntentDATA(Buffer.from(review.originalCreationTerms19, 'utf8')).terms;
  const identity = exact(review.identityBinding, identityKeys);
  const application = exact(independentApplicationBinding, applicationKeys);
  if (identityKeys.some(k => identity[k] !== terms[k]) || applicationKeys.some(k => application[k] !== terms[k]) || review.originalGeneration !== terms.generation || review.originalCreationOperation !== terms.operationId ||
      review.originalRegistrationOperation !== null && (typeof review.originalRegistrationOperation !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(review.originalRegistrationOperation)))
    fail('AUTH_DEVICE_FINALIZATION_ORIGINAL_SELECTION_CHANGED');
  // Historical creation expiry is parsed as original DATA, never renewed or
  // used as fresh authorization. The selected lease/current remains fresh.
  const data = Object.freeze(Object.fromEntries(selectionKeys.map(k => [k, k === 'identityBinding' ? Object.freeze(identity) : review[k]])));
  const state = {selected:selectedPublicLease, data, retired:false, cause:undefined, clockFloor:0};
  current(state);
  const peer = Object.freeze(Object.assign(Object.create(null), {retire:()=>retire(state), close:()=>retire(state)}));
  peers.set(peer, state);
  return peer;
}
export function isOriginalDeviceV4RegisteredFinalizationPeer(peer) { return peers.has(peer); }
export function readOriginalDeviceV4RegisteredFinalizationForNative(peer) { return original(peer).data; }
export function assertOriginalDeviceV4RegisteredFinalizationCurrent(peer) { original(peer); }
export async function recheckOriginalDeviceV4RegisteredFinalization(peer) {
  const state = original(peer);
  try { await state.selected.recheck(); current(state); }
  catch (cause) { retire(state, cause); throw cause; }
}
