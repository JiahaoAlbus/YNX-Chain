import{inspectPinnedTaskGrantMakeDependenciesDATA,readTaskGrantPinnedOriginalFileDATA}from'../../../apps/wallet-desktop/scripts/task-grant-dependency-paths-private.mjs';
const r=inspectPinnedTaskGrantMakeDependenciesDATA('',{source:'/PUBLIC/source',output:'/PUBLIC/out',inputPins:[]});
// @ts-expect-error filesystem comparison DATA is not Root authority
const root:true=r.RootAdmission;
// @ts-expect-error frozen selection needs exact byte/hash pins
readTaskGrantPinnedOriginalFileDATA({path:'/PUBLIC/file'});
// @ts-expect-error no arbitrary executable/provider option
inspectPinnedTaskGrantMakeDependenciesDATA('',{source:'/PUBLIC/source',output:'/PUBLIC/out',inputPins:[],provider:()=>true});
