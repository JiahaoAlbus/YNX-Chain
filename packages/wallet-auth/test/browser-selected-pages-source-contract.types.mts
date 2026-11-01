import {BROWSER_SELECTED_PAGES_SOURCE_PURPOSE,inspectOriginalBrowserSelectedPagesScopeV1DATA,inspectOriginalBrowserSelectedPagesBorrowV1DATA} from '../src/browser-selected-pages-source-v1.js';
import type {BrowserSelectedPagesScopeV1,BrowserSourceAssociationV1,BrowserPageRequestExpectedV1,BrowserPageActualPeerV1,BrowserPageCurrentSelectorV1} from '../src/browser-selected-pages-source-v1.js';
declare const s:BrowserSelectedPagesScopeV1,a:BrowserSourceAssociationV1,raw:Uint8Array,expected:BrowserPageRequestExpectedV1,peer:BrowserPageActualPeerV1,current:BrowserPageCurrentSelectorV1;
const p:'browser-selected-pages-source-v1'=BROWSER_SELECTED_PAGES_SOURCE_PURPOSE;
const data=inspectOriginalBrowserSelectedPagesScopeV1DATA(s,a,'network','owner','source','instance',0,1,0);
const b=inspectOriginalBrowserSelectedPagesBorrowV1DATA(s,a,'network','owner','source','instance',0,1,0,raw,expected,peer,current);
const noGrant:false=data.authorized;const readOnly:true=b.readOnly;
// @ts-expect-error DATA cannot be used as a granted native Source.
const grant:{authorized:true}=b;
// @ts-expect-error source epoch is lossless explicit original u64 string.
const epoch:number=s.currentSelector.epoch;
// @ts-expect-error task revision must preserve complete u64 instead of Number rounding.
const badTask:BrowserPageRequestExpectedV1={...expected,task:{...expected.task,revision:1}};
// @ts-expect-error Browser Source identity does not accept AI mobile.
const badAssociation:BrowserSourceAssociationV1={...a,productId:'ai',platform:'ios'};
// @ts-expect-error request expected projection has no optional approval default.
inspectOriginalBrowserSelectedPagesBorrowV1DATA(s,a,'n','o','s','i',0,1,0,raw);
// @ts-expect-error request projection and browser target peer are separate types.
const wrongPeer:BrowserPageActualPeerV1=expected;
void [p,noGrant,readOnly,grant,epoch,badTask,badAssociation,wrongPeer];
