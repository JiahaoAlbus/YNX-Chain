// Internal persistence/production fences for the sole SDK's closed V6 family.
// No codec, signature domain, success alias or V4/V5 enum changes.
export const AI_TASK_V6_BUSINESS_DECISIONS=Object.freeze(['COMMITTED','ACCEPTED','OBSERVED','DENIED','UNKNOWN']);
export const AI_TASK_V6_LOCAL_ACTIONS=Object.freeze(['task.create','task.prepare','task.propose-tool-step','task.cancel','task.complete']);
// Completion scopes/business labels are checked by the installed sole SDK
// inspectProductSessionTaskOutcomeV6DATA, not a second Auth semantic codec.
