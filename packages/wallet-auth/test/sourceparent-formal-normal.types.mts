import {collectOriginalSourceParentNormalInputsDATA,inspectOriginalSourceParentNativeCallerDATA} from '../scripts/sourceparent-normal-inputs.mjs';const p=collectOriginalSourceParentNormalInputsDATA('native');const noRoot:false=p.RootAdmission;const noBIND:false=p.SourceBINDAdmission;const data:true=p.dataOnly;void noRoot;void noBIND;void data;const code=inspectOriginalSourceParentNativeCallerDATA('/normal/P09');const notLaunch:false=code.normalQualifiedLaunchReady;void notLaunch;
// @ts-expect-error finite build role, no caller provider
collectOriginalSourceParentNormalInputsDATA('WPR');
// @ts-expect-error source/intake facts do not grant actual Native admission
const grant:true=p.NativeAdmission;
