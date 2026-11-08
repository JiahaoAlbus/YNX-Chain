import{composeOriginalTaskGrantRecipeDATA,createOriginalTaskGrantGatePayloadDATA}from'../../../apps/wallet-desktop/scripts/wallet-task-grant-matching-native-profile.mjs';
const p=composeOriginalTaskGrantRecipeDATA('/PUBLIC/fresh');
// @ts-expect-error fixed pipeline accepts output root only, never a caller-selected plan/provider
composeOriginalTaskGrantRecipeDATA('/PUBLIC/fresh',{provider:()=>true});
// @ts-expect-error build plan is DATA, not Native admission
const granted:true=p.NativeAdmission;
// @ts-expect-error immutable fixed command list cannot be replaced with arbitrary argv
p.commands=[];
// @ts-expect-error actual image buffer is required, not a success boolean
createOriginalTaskGrantGatePayloadDATA(p,true);
void granted;
