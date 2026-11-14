import { NormalProductCalls, ProductInventoryObservation } from './nativeProductPorts';
import { nativeBindingAdapter } from './bindingNativeAdapter';
import { accountBindingInput } from './accountBinding';
import { accountEntryCapabilities, type AccountEntryCapability } from './accountEntry';
import { selectVeilMatrixReader } from '../veilMatrixTransport';
import { validateProductCommand, type VeilProductCommand } from './productModel';
import { LocalOwnerObservationGate, readLoadedOwner, type VeilLocalOwnerRead } from './localOwner';
import type { LocalOwnerModule } from './localOwnerModule';
import { ownCallContext, ownProductCommandDraft, type VeilCallContext, type VeilExecuteReply, type VeilSnapshotReply } from './productBoundary';

/** Product-facing boundary for the new core, not an authority supplier.
 * The normal Android module supplies public local-owner observation only.
 * Do not resolve the retired Matrix module, infer enrollment from a Boolean,
 * or manufacture successful account/message data to populate the product.
 */
export type VeilProductGap =
  | 'AUTHORIZED_PRODUCT_PROJECTION_UNAVAILABLE'
  | 'NATIVE_PRODUCT_EXPORT_UNAVAILABLE'
  | 'ISSUER_PRODUCT_BINDING_UNAVAILABLE'
  | 'STORE_PRODUCT_BINDING_UNAVAILABLE'
  | 'RESTORE_PRODUCT_BINDING_UNAVAILABLE';

export type VeilProductOperation =
  | 'signIn' | 'openConversation' | 'sendMessage' | 'receiveMessage' | 'reply'
  | 'selectAttachment' | 'requestContact' | 'acceptContact'
  | 'publishMoment' | 'approveDevice' | 'recoverDevice' | 'enableLocalAi';

export type VeilProductAvailability = Readonly<{
  status: 'UNAVAILABLE';
  gaps: readonly VeilProductGap[];
}>;

const availability: VeilProductAvailability = Object.freeze({
  status: 'UNAVAILABLE',
  gaps: Object.freeze([
    'NATIVE_PRODUCT_EXPORT_UNAVAILABLE',
    'ISSUER_PRODUCT_BINDING_UNAVAILABLE',
    'STORE_PRODUCT_BINDING_UNAVAILABLE',
    'RESTORE_PRODUCT_BINDING_UNAVAILABLE',
  ] as const),
});

export class VeilProductUnavailableError extends Error {
  readonly code = 'VEIL_PRODUCT_UNAVAILABLE';
  constructor(readonly operation: VeilProductOperation) {
    super('VEIL_PRODUCT_UNAVAILABLE');
    this.name = 'VeilProductUnavailableError';
  }
}

export interface VeilProductNativeConsumer {
  readAvailability(): Promise<VeilProductAvailability>;
  readAccountEntryCapabilities(): readonly AccountEntryCapability[];
  readAccountBindingInput(): typeof accountBindingInput;
  advanceAccountBindingContext(): Promise<void>;
  readSnapshot(context: VeilCallContext): Promise<VeilSnapshotReply>;
  execute(command: VeilProductCommand, context: VeilCallContext): Promise<VeilExecuteReply>;
  subscribeInvalidation(listener: () => void): (() => void) | null;
  receiveOpaqueEvent(eventType: string, rawContent: string): Promise<never>;
}

let normalModule: Promise<import('./nativeProductPorts').ProductPortModule | null> | null = null;
const loadNormalModule = () => normalModule ??= import('./nativeProductPortsModule').then(value => value.loadProductPortModule()).catch(() => null);
const productPorts = new ProductInventoryObservation(loadNormalModule);
const normalProduct = new NormalProductCalls(loadNormalModule);
const ownerReadGate = new LocalOwnerObservationGate();
let ownerModule: Promise<LocalOwnerModule | null> | null = null;
async function readNormalLocalOwner(): Promise<VeilLocalOwnerRead> {
  return ownerReadGate.observe(() => readLoadedOwner(() => {
    ownerModule ??= import('./localOwnerModule').then(value => value.loadLocalOwnerModule()).catch(() => null);
    return ownerModule;
  }));
}

// Observations never authorize operations. Normal calls reach the same native
// owner; only its genuine business producer can supply authorized views.
// There is no UI provider installer or legacy fallback.
export const veilProductNativeConsumer: VeilProductNativeConsumer = Object.freeze({
  async readAvailability() { return availability; },
  readAccountEntryCapabilities() { return accountEntryCapabilities; },
  readAccountBindingInput() { return accountBindingInput; },
  advanceAccountBindingContext() { return nativeBindingAdapter.advanceContext(); },
  async readSnapshot(context: VeilCallContext): Promise<VeilSnapshotReply> {
    const ownedContext = ownCallContext(context);
    const nativeReply = await normalProduct.read(ownedContext);
    if (nativeReply && nativeReply.snapshot.kind !== 'UNAVAILABLE') return nativeReply;
    const replyContext = nativeReply?.context ?? ownedContext;
    const inventory = await productPorts.read();
    const localOwner = await readNormalLocalOwner();
    const observed = inventory.status === 'INVENTORY_ONLY' || inventory.status === 'DEVICE_OBSERVED' || inventory.status === 'SESSION_OBSERVED';
    const gaps = observed ? Object.freeze(['AUTHORIZED_PRODUCT_PROJECTION_UNAVAILABLE', ...availability.gaps.filter(gap => gap !== 'NATIVE_PRODUCT_EXPORT_UNAVAILABLE')]) : availability.gaps;
    return Object.freeze({ context: replyContext, snapshot: Object.freeze({
      kind: 'UNAVAILABLE', gaps, localOwner,
      ...(inventory.status === 'DEVICE_OBSERVED' || inventory.status === 'SESSION_OBSERVED' ? { deviceObservation: inventory.acceptedDevice } : {}),
      ...(inventory.status === 'SESSION_OBSERVED' ? { sessionObservation: inventory.protectedSession } : {}),
    }) });
  },
  async execute(command: VeilProductCommand, context: VeilCallContext): Promise<VeilExecuteReply> {
    const ownedContext = ownCallContext(context);
    const ownedCommand = ownProductCommandDraft(command);
    if (ownedContext.action !== ownedCommand.type) throw new Error('VEIL_PRODUCT_CONTEXT_INVALID');
    const invalid = validateProductCommand(ownedCommand);
    if (invalid) return Object.freeze({ context: ownedContext, result: Object.freeze(invalid) });
    // The native owner, not JS observation/status, selects actual admission.
    // Only local pre-dispatch input errors are definite; native failures remain UNKNOWN.
    return normalProduct.execute(ownedCommand, ownedContext);
  },
  subscribeInvalidation(listener: () => void): (() => void) | null {
    return productPorts.subscribe(listener);
  },
  async receiveOpaqueEvent(eventType: string, rawContent: string): Promise<never> {
    // Main's checked normal transport is the only descriptor parser. A valid
    // opaque descriptor is not native authentication or authorized plaintext.
    // Until a genuine product export exists, receive cannot manufacture a row.
    const selected = selectVeilMatrixReader(eventType, rawContent);
    if (selected.reader === 'not-encrypted') throw new Error('VEIL_PRODUCT_EVENT_NOT_ENCRYPTED');
    throw new VeilProductUnavailableError('receiveMessage');
  },
});

export function sensitiveOperationDisabled(value: VeilProductAvailability | null): boolean {
  return value === null || value.status === 'UNAVAILABLE';
}
