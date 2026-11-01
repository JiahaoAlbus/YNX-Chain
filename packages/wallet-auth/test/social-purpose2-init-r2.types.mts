import {SOCIAL_ORDINARY_MESSAGE_OPERATIONS_R2_DATA as operations} from '../src/social-platform-policy-v3.js';
const init:1=operations.initializeStorage;
const mask:63=operations.allowedMask;
const revision:'SDK-SOCIAL-ORDINARY-PURPOSE2-INIT-R2-20261101'=operations.contractRevision;
// @ts-expect-error old62 cannot include the new explicit purpose2 init bit.
const oldMask:62=operations.allowedMask;
// @ts-expect-error these DATA constants contain no Root/current/storage grant.
const approved:true=operations.RootAdmission;
void [init,mask,revision,oldMask,approved];
