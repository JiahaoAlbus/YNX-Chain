import {ProductSessionGatewayFetchAdapter} from '../src/index.js';
import type {ProductSessionDeviceV4TransportInput,ProductSessionDeviceV4TransportResult} from '../src/index.js';
declare const gateway:ProductSessionGatewayFetchAdapter;
const input:ProductSessionDeviceV4TransportInput={originalBody:'{}',abortContext:Object.freeze({signal:new AbortController().signal})};
const result:Promise<ProductSessionDeviceV4TransportResult>=gateway.pairDeviceV4(input);
gateway.challengeDeviceV4(input);gateway.completeDeviceV4(input);
result.then(value=>{const source:false=value.sourceAdmission;const native:false=value.nativeAdmission;void source;void native;
  // @ts-expect-error A transport receipt does not make a connected session.
  const connected:true=value.connected;void connected;
});
// @ts-expect-error Native/HTTP callers cannot substitute a signal string.
gateway.pairDeviceV4({originalBody:'{}',abortContext:{signal:'spoof'}});
// @ts-expect-error Original serialized bytes are required, not a DTO.
gateway.completeDeviceV4({originalBody:{},abortContext:input.abortContext});
// @ts-expect-error These routes do not expose management operations.
gateway.revokeDeviceV4(input);
