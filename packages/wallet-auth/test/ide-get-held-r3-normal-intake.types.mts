import{acquireOriginalIDEHeldSessionReadForOriginalGET,type OriginalIDEGETHeldAcquisition}from'../src/ide-get-held-session-root.js';declare const ctx:Readonly<{signal:AbortSignal}>;const out:Promise<OriginalIDEGETHeldAcquisition>=acquireOriginalIDEHeldSessionReadForOriginalGET(ctx);
// @ts-expect-error SAME original context is required
acquireOriginalIDEHeldSessionReadForOriginalGET();
// @ts-expect-error no Source or target provider parameter
acquireOriginalIDEHeldSessionReadForOriginalGET(ctx,{});
async function use(){const r=await out;if(!r.failed){const f:false=r.cleanupOnly;const n:null=r.error;r.owner.readRetainedProofObservationDATA(ctx);}else{const f:true=r.errorPresent;const unknownCause:unknown=r.error;}}
