import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type {TaskPersistence,WorkspaceRecord} from "./tasks";

// Account/session-specific metadata only. Results, prompts, Grant refs and live
// Wallet proofs stay out of this bounded native secure-storage journal.
async function key(identity:string){if(!identity||identity.length>1024)throw new Error("TASK_IDENTITY_REQUIRED");return `ynx.ai.tasks.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,identity)}`}
export const nativeTaskPersistence:TaskPersistence={
 async read(identity){const raw=await SecureStore.getItemAsync(await key(identity));if(!raw)return null;if(raw.length>64<<10)throw new Error("TASK_JOURNAL_INVALID");const record=JSON.parse(raw) as WorkspaceRecord;if(!record||typeof record.selectedTask!=="string"||typeof record.runId!=="string"||!Array.isArray(record.deliveries)||record.deliveries.length>64||record.deliveries.some(d=>!d||typeof d.id!=="string"||typeof d.binding!=="string"||!["PENDING","UNKNOWN","RESPONSE_RECEIVED","REJECTED_RESPONSE","ORIGINAL_OBSERVED"].includes(d.state)))throw new Error("TASK_JOURNAL_INVALID");return record},
 async write(identity,value){const raw=JSON.stringify(value);if(raw.length>64<<10)throw new Error("TASK_JOURNAL_FULL");await SecureStore.setItemAsync(await key(identity),raw,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}
};

// A separate versioned namespace: never turn a V2 delivery into a V6 operation.
import {validateV6Journal,type V6Persistence} from "./taskV6";
export const nativeTaskV6Persistence:V6Persistence={
 async read(identity){const raw=await SecureStore.getItemAsync((await key(identity))+".v6");if(raw===null)return null;if(raw.length>128<<10)throw Error("V6_JOURNAL_INVALID");return validateV6Journal(JSON.parse(raw))},
 async write(identity,journal){validateV6Journal(journal);const raw=JSON.stringify(journal);if(raw.length>128<<10)throw Error("V6_JOURNAL_FULL");await SecureStore.setItemAsync((await key(identity))+".v6",raw,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}
};
