import {openOriginalAITaskActionClientV6 as open} from '../src/original-ai-task-action-v6-mobile.mjs';import type {OriginalAITaskActionV6Client,OriginalAITaskActionV6Intent} from '../src/original-ai-task-action-v6-client.js';import {captureOriginalAITaskV6MobileIntentDATA as capture} from '../src/original-ai-task-action-v6-mobile-snapshot-private.mjs';
declare const intent:OriginalAITaskActionV6Intent;const c:OriginalAITaskActionV6Client=await open();const p=c.prepare(intent);await c.prove(p);await c.send(p);c.read(p);const r=await c.lookupOriginal(intent.operationId,intent.abortContext);c.readRecovery(r);await c.close();const d=capture(intent);const s:string=d.snapshotString;
// @ts-expect-error no Source brand from DATA
const source:{qualified:true}=d;
// @ts-expect-error readonly DATA
d.snapshotString='';
// @ts-expect-error no public context constructor/provider
open({source:true});
// @ts-expect-error public prove still no reviewer argument
c.prove(p,{});
