import{acquireOriginalPaySource,isOriginalPaySource,type OriginalPayNativeInput,type OriginalPayNativeSource}from'../src/pq-native-pay-source.js';declare const i:OriginalPayNativeInput;const raw:unknown=acquireOriginalPaySource(i);
// @ts-expect-error acquisition transfers custody but does not brand/admit Source
const assumed:OriginalPayNativeSource=acquireOriginalPaySource(i);
if(isOriginalPaySource(raw)){const checked:OriginalPayNativeSource=raw;void checked;}void assumed;
