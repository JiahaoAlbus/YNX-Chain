import path from 'node:path';
// Finite normal CLI choices only; no ENV/provider or builder override selection.
export function parseMacNativeComponentSelection(arch,options){
 let c6Input=null,controlMatchedInput=null;const remaining=[];
 for(const option of options){
  if(option.startsWith('--native49-c6-component-input=')){
   if(c6Input!==null)throw Error('UNSUPPORTED_MAC_BUILD_OPTION');
   c6Input=option.slice('--native49-c6-component-input='.length);
   if(arch!=='arm64'||!path.isAbsolute(c6Input)||path.normalize(c6Input)!==c6Input||c6Input.includes('\0'))throw Error('C6_ABSOLUTE_ARM64_INPUT_REQUIRED');
  }else if(option.startsWith('--wallet-control-matched-component-input=')){
   if(controlMatchedInput!==null)throw Error('UNSUPPORTED_MAC_BUILD_OPTION');
   controlMatchedInput=option.slice('--wallet-control-matched-component-input='.length);
   if(arch!=='arm64'||!path.isAbsolute(controlMatchedInput)||path.resolve(controlMatchedInput)!==controlMatchedInput||controlMatchedInput.includes('\0'))throw Error('WALLET_CONTROL_MATCHED_ABSOLUTE_ARM64_INPUT_REQUIRED');
  }else remaining.push(option);
 }
 if(c6Input!==null&&controlMatchedInput!==null)throw Error('MAC_NATIVE_COMPONENT_SELECTION_CONFLICT');
 return {c6Input,controlMatchedInput,remaining};
}
