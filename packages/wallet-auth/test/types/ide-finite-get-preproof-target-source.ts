import {acquireOriginalIDEFiniteGETTargetSource,acquireOriginalIDECloudGETSourceWithTargetScope,type OriginalIDEFiniteGETTargetScope} from '../../src/original-ide-finite-get-target-source-private.js';
const target=acquireOriginalIDEFiniteGETTargetSource({});const scope:OriginalIDEFiniteGETTargetScope=target.readOriginalTargetScope();target.close();target.drainOriginal();acquireOriginalIDECloudGETSourceWithTargetScope({});
// @ts-expect-error scope is opaque, never a permission DTO
const forged:OriginalIDEFiniteGETTargetScope={};
// @ts-expect-error no provider/endpoint/options argument
acquireOriginalIDEFiniteGETTargetSource({},{});
// @ts-expect-error no caller-supplied scope argument
acquireOriginalIDECloudGETSourceWithTargetScope({},scope);
// @ts-expect-error close does not accept fake completion
 target.close(true);
void forged;
