import {inspectProductSessionTaskSelectedPagesV6DATA,type ProductSessionTaskActionV6Unsigned,type ProductSessionTaskPageReferenceV6} from '../src/product-session-task-action-v6.js';
import {inspectOriginalAITaskActionV6SelectedPagesRequestDATA} from '../native/original-ai-task-action-v6-source-contract.mjs';
declare const raw:Uint8Array;declare const unsigned:ProductSessionTaskActionV6Unsigned;
const p=inspectProductSessionTaskSelectedPagesV6DATA(raw,unsigned);const noGrant:false=p.SourceAdmission;const noModel:false=p.modelAuthorized;
const n=inspectOriginalAITaskActionV6SelectedPagesRequestDATA(raw,unsigned);const noNative:false=n.NativeAdmission;
const reference:ProductSessionTaskPageReferenceV6={selectionId:'original-selection',version:'a'.repeat(128)};
// @ts-expect-error no URL/page input replaces original reference
const url:ProductSessionTaskPageReferenceV6={selectionId:'s',version:'v',url:'https://example.com'};
// @ts-expect-error no caller flag establishes current
const current:true=p.current;
// @ts-expect-error immutable reference array
p.selectedPages?.push(reference);
void [noGrant,noModel,noNative,url,current];
