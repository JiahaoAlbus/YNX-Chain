// Main-only read-only selection DATA. This is neither a creation decision nor
// Native/Source admission. Auth must retain the SAME opaque peer through its
// independently selected fixed module; copied DATA cannot confer provenance.
import {inspectOriginalDeviceIdentityDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';
import {isOriginalSelectedPQAccountPublicLease} from '../password-wallet-vault.mjs';

const selections = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), {code}); };
function retire(state, ...causes) {
  if (!state.retired) {
    state.retired = true;
    state.cause = causes.length ? causes[0] : Object.assign(new Error('AUTH_DEVICE_QUERY_SELECTION_RETIRED'), {code: 'AUTH_DEVICE_QUERY_SELECTION_RETIRED'});
  }
}
function current(state) {
  if (state.retired) throw state.cause;
  try {
    state.selected.assertCurrent();
    const selected = state.selected.readPublic();
    if (selected.account !== state.identityBinding.canonicalOwner || selected.networkId !== state.identityBinding.networkId)
      fail('AUTH_DEVICE_QUERY_SELECTED_ACCOUNT_CHANGED');
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < state.clockFloor)
      fail('AUTH_DEVICE_QUERY_CLOCK_ROLLBACK');
    state.clockFloor = now;
  } catch (cause) {
    retire(state, cause);
    throw cause;
  }
}
function original(peer) {
  // WeakMap lookup never consults properties/getters on an untrusted peer.
  const state = selections.get(peer);
  if (!state) fail('AUTH_DEVICE_QUERY_ORIGINAL_SELECTION_REQUIRED');
  current(state);
  return state;
}

/** Only the original selected-ASSET lease can establish local selection. The
 * sole SDK validates original stable UTF-8 bytes, owner/address conversion and
 * independent Registry application binding. No creation intent/window is used.
 * The caller owns the supplied lease; closing this peer retires only this peer.
 */
export function captureOriginalDeviceQuerySelectionDATA(originalStableBytes, independentApplicationBinding, selectedPublicLease) {
  if (!isOriginalSelectedPQAccountPublicLease(selectedPublicLease))
    fail('AUTH_DEVICE_QUERY_SELECTED_ACCOUNT_REQUIRED');
  const view = inspectOriginalDeviceIdentityDATA(originalStableBytes, independentApplicationBinding);
  const {version, domain, ...identity} = view.identity;
  // Stable six fields + Registry eight fields overlap productId/clientId.
  // These are original sole-SDK outputs: exactly twelve identity input fields.
  const identityBinding = Object.freeze({...identity, ...view.applicationBinding});
  const data = Object.freeze({queryOnly: true, stableDeviceIdentity: view.stableDeviceIdentity, identityBinding});
  const state = {selected: selectedPublicLease, identityBinding, data, clockFloor: 0, retired: false, cause: undefined};
  current(state);
  const peer = Object.freeze(Object.assign(Object.create(null), {
    retire: () => retire(state),
    close: () => retire(state)
  }));
  selections.set(peer, state);
  return peer;
}

// Brand only; even a branded peer may already be retired. Never Native admission.
export function isOriginalDeviceQuerySelectionPeer(peer) { return selections.has(peer); }
export function readOriginalDeviceQuerySelectionDATA(peer) { return original(peer).data; }
export function assertOriginalDeviceQuerySelectionCurrent(peer) { original(peer); }
export async function recheckOriginalDeviceQuerySelection(peer) {
  const state = original(peer);
  try {
    // The genuine lease obtains authorization.current() itself. This must run
    // inside the caller's original sensitiveIPC/keyAccess lifecycle.run scope.
    await state.selected.recheck();
    current(state);
  } catch (cause) {
    retire(state, cause);
    throw cause;
  }
}
