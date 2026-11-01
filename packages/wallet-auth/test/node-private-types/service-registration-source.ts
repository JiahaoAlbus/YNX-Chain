import {readOriginalIDECurrentServiceRegistration} from '../../src/original-ide-admission-parent-delivery.js';
import type {OriginalIDEProjectAuthorityRef,OriginalIDECurrentServiceRegistrationData} from '../../src/auth-native-contract.js';
declare const owner:OriginalIDEProjectAuthorityRef;const data:OriginalIDECurrentServiceRegistrationData=readOriginalIDECurrentServiceRegistration(owner,'project');
const scopes:readonly string[]=data.serviceRegistration.scopes;const revision:string=data.serviceRegistration.revision;const revoked:false=data.serviceRegistration.revoked;void[scopes,revision,revoked];
// @ts-expect-error Fixed exact two-argument callee, no endpoint/provider argument.
readOriginalIDECurrentServiceRegistration(owner,'project','https://caller.invalid');
// @ts-expect-error Structural JSON cannot create the original same-env owner.
readOriginalIDECurrentServiceRegistration({},'project');
// @ts-expect-error Source supplies a frozen, read-only scopes array.
data.serviceRegistration.scopes.push('new-permission');
// @ts-expect-error DATA is never a Native read/sign authorization receipt.
const grant:true=data.authorized;
void grant;
