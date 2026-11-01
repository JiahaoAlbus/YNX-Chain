import{acquireOriginalPaySource,isOriginalPaySource,type OriginalPayNativeInput,type OriginalPayNativeSource}from'../src/pq-native-pay-source.js';declare const input:OriginalPayNativeInput;const raw:unknown=acquireOriginalPaySource(input);if(!isOriginalPaySource(raw))throw Error('PUBLIC source not recognized after custody');const owner:OriginalPayNativeSource=raw;declare const v:unknown;if(isOriginalPaySource(v)){const same:OriginalPayNativeSource=v;void same;}
// @ts-expect-error no public module/provider selector
acquireOriginalPaySource({...input,provider:()=>true});
// @ts-expect-error original normal ABI is one exact input
acquireOriginalPaySource(input,{});
const packet=owner.readOriginalPacketOutcome();void packet;
