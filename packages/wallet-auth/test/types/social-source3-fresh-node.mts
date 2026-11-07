import {acquireOriginalSocialDeviceDirectoryPrincipalSourceV4,drainOriginalSocialDeviceDirectoryPrincipalSourceV4} from '../../src/original-social-joint-source-current-private.js';
const packet=await acquireOriginalSocialDeviceDirectoryPrincipalSourceV4();
const owner=packet.owner;const closed:boolean=owner.isClosed();void closed;
if(packet.errorPresent){const cause:unknown=packet.error;void cause;}
await drainOriginalSocialDeviceDirectoryPrincipalSourceV4(owner);
// @ts-expect-error no provider, row or peer argument
acquireOriginalSocialDeviceDirectoryPrincipalSourceV4({});
// @ts-expect-error DTO is not a typed lifecycle owner
await drainOriginalSocialDeviceDirectoryPrincipalSourceV4({});
