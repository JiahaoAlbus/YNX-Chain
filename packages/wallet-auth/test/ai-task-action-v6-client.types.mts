import {openOriginalAITaskActionClientV6} from '../src/original-ai-task-action-v6-client.js';
const c=await openOriginalAITaskActionClientV6();
// @ts-expect-error no source/provider injection
openOriginalAITaskActionClientV6({provider:()=>null});
// @ts-expect-error arbitrary JSON is never a retained packet
c.send({});
// @ts-expect-error original recovery evidence cannot become a new effect
c.send(await c.lookupOriginal('PUBLIC-old',Object.freeze({signal:new AbortController().signal})));
const evidence=c.readRecovery(await c.lookupOriginal('PUBLIC-old',Object.freeze({signal:new AbortController().signal})));
const admission:false=evidence.NativeAdmission;
