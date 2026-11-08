import type{OriginalStrongTaskReadTransport}from'../../src/desktop-grant-strong-continuation-transport-private.mjs';
declare const owner:OriginalStrongTaskReadTransport;
const selected:boolean=owner.lifetime().carrierCloseSelected;
// @ts-expect-error private close selection is observational, not a setter or authority
owner.lifetime().carrierCloseSelected=true;
// @ts-expect-error close remains paired, not a boolean or void
const closed:Promise<boolean>=owner.close();
void[selected,closed];
