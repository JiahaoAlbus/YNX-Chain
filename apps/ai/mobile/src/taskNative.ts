import * as Crypto from 'expo-crypto';
import {openOriginalAITaskActionClientV6} from '../contracts/sdk047/original-ai-task-action-v6-mobile.mjs';
import {nativeTaskV6Persistence} from './taskStorage';
import {TaskSessionLifetime,type TaskSessionRuntime} from './taskSession';
import type {Session} from './api';
// This hash partitions LOCAL recovery metadata only. It is never passed to the
// Native opener and never establishes Agent, device, session or Grant authority.
export async function createNativeTaskSession(session:Session,origin:string):Promise<TaskSessionRuntime>{
 const identity='v6-local:'+await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify([origin,session.deviceId,session.token]));
 return new TaskSessionLifetime(identity,openOriginalAITaskActionClientV6,nativeTaskV6Persistence,()=>`taskop_${Crypto.randomUUID().replace(/-/g,'')}`);
}
