import type{OriginalTaskEffectContinuation,RegisteredOriginalTaskEffectExecutor,OriginalTaskEffectRequestDATA}from'../../src/desktop-grant-original-continuation-private.d.mts';
declare const executor:RegisteredOriginalTaskEffectExecutor;declare const req:OriginalTaskEffectRequestDATA;declare const cap:OriginalTaskEffectContinuation;executor.executeOriginalTaskEffect({},req,cap);
// @ts-expect-error same private third operand required
executor.executeOriginalTaskEffect({},req);
// @ts-expect-error JSON fields cannot reconstruct runtime cap
executor.executeOriginalTaskEffect({},req,{operationId:'copied'});
// @ts-expect-error readonly branded cap cannot be a wire string
const raw:string=cap;void raw;
// @ts-expect-error OWN_RESERVED is not a public receipt state
const state:Awaited<ReturnType<RegisteredOriginalTaskEffectExecutor['executeOriginalTaskEffect']>>={owner:null,errorPresent:false,result:{operationId:'x',state:'OWN_RESERVED',original:'json'}};void state;
