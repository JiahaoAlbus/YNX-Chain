import type {OriginalTaskResourceInputOwner,OriginalTaskResourceCleanupDATA,OriginalTaskResourceTransportOwner} from '../../src/desktop-grant-resource-transport-owner.mjs';
import type {OriginalTaskEffectTransportLoan} from '../../src/desktop-grant-original-continuation-private.mjs';
import {openOriginalTaskReadTransport} from '../../src/desktop-grant-resource-transport-owner.mjs';
declare const effect:OriginalTaskEffectTransportLoan;
declare const input:OriginalTaskResourceInputOwner;
declare const transport:OriginalTaskResourceTransportOwner;
const paired:Promise<OriginalTaskResourceCleanupDATA>=effect.close();
const pairedTransport:Promise<OriginalTaskResourceCleanupDATA>=transport.join();
const voidInput:Promise<void>=input.close();
// @ts-expect-error physical transport cleanup is not undefined-only Source cleanup
const wrongVoid:Promise<void>=effect.close();
// @ts-expect-error Source input void cleanup cannot substitute for paired effect loan
const wrongLoan:OriginalTaskEffectTransportLoan=input;
// @ts-expect-error physicalDone alone cannot drop independent error presence
const missingPresence:OriginalTaskResourceCleanupDATA={physicalDone:true};
// @ts-expect-error fixed finite3 does not permit arbitrary operation names
openOriginalTaskReadTransport({assertNativeCurrent(){}},{},'/PUBLIC/private.cjs','other',new Uint8Array());
void [paired,pairedTransport,voidInput,wrongVoid,wrongLoan,missingPresence];
