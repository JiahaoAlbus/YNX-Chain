import type{OriginalHeldTaskReadChild,OriginalStrongTaskReadTransport,OriginalStrongTaskReadModuleSource}from'../../src/desktop-grant-strong-continuation-transport-private.mjs';
import{openOriginalTaskReadStrongTransport}from'../../src/desktop-grant-strong-continuation-transport-private.mjs';
declare const child:OriginalHeldTaskReadChild,transport:OriginalStrongTaskReadTransport,source:OriginalStrongTaskReadModuleSource;
const rootSelected:string=source.readOriginalTaskReadContinuationModulePath();
const original=child.readOriginalRequestDATA();
// @ts-expect-error only actual bytes can enter the fixed carrier, never JSON body text
openOriginalTaskReadStrongTransport(source,{},rootSelected,'PUBLIC-body',child);
// @ts-expect-error a boolean is not the actual protected held child
openOriginalTaskReadStrongTransport(source,{},rootSelected,new Uint8Array(),true);
// @ts-expect-error physical close is paired, not Source's undefined-only cleanup
const badVoid:Promise<void>=transport.close();
// @ts-expect-error Root-selected module getter is synchronous and cannot be a promise
const badRoot:OriginalStrongTaskReadModuleSource={assertNativeCurrent(){},readOriginalTaskReadContinuationModulePath:async()=>'/PUBLIC'};
// @ts-expect-error no caller provider or module selector option
openOriginalTaskReadStrongTransport(source,{},rootSelected,new Uint8Array(),child,{signal:undefined,provider:()=>true});
void[original,badVoid,badRoot];
