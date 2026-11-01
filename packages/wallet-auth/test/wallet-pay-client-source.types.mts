import {inspectOriginalWalletPayClientScopeV1DATA as inspect,inspectOriginalWalletPayClientOperationV1DATA as operation,type WalletPayClientScopeV1,type WalletPayClientBindingV1} from '../native/original-wallet-pay-client-source-contract.mjs';
declare const scope:WalletPayClientScopeV1,binding:WalletPayClientBindingV1;
const out=inspect(scope,'a','b',1,2,1);const falseOnly:false=out.authorized;
// @ts-expect-error caller approval is not part of the closed selection
const wrong:WalletPayClientScopeV1={version:1,protectedResourceRef:'PUBLIC',bindings:[],approved:true};
// @ts-expect-error fixed route enum, no caller transport verb
operation(scope,binding,'POST',new Uint8Array(),new Uint8Array(),'a','b',1,2,1);
// @ts-expect-error DATA result never grants Source
const grant:true=out.SourceAdmission;
void falseOnly;void wrong;void grant;

// @ts-expect-error internal C++ enum spelling is not the NAPI JS wire kind
const wrongKind:WalletPayClientBindingV1={...binding,target:{...binding.target,kind:'terms'}};
void wrongKind;
