import {encodeIdentityEventV1DATA,decodeIdentityEventV1DATA,encodeIdentityRoleAuthorizationV1DATA,decodeIdentityRoleAuthorizationV1DATA} from '../src/identity-event.js';
declare const event:Parameters<typeof encodeIdentityEventV1DATA>[0];
const wire:Uint8Array=encodeIdentityEventV1DATA(event);
const decoded=decodeIdentityEventV1DATA(wire);
const action:'register'|'rotate'|'suspend'|'revoke'|'recover'=decoded.action;void action;
declare const role:Parameters<typeof encodeIdentityRoleAuthorizationV1DATA>[0];
const roleWire:Uint8Array=encodeIdentityRoleAuthorizationV1DATA(role);
const result=decodeIdentityRoleAuthorizationV1DATA(roleWire);
const epoch:string=result.expectedEpoch;void epoch;
// @ts-expect-error DATA is not a protected AND authorization result.
const granted:true=result.authorized;void granted;
// @ts-expect-error Epoch values never use floating-point numbers.
encodeIdentityEventV1DATA({...event,fromEpoch:1});
// @ts-expect-error Roles are a closed set, not arbitrary purposes.
encodeIdentityRoleAuthorizationV1DATA({...role,role:'asset-signer'});
