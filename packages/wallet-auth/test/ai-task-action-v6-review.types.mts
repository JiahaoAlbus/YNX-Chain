import type {OriginalAITaskV6ReviewPortPrivate,OriginalAITaskV6HeldReviewPrivate} from '../src/original-ai-task-action-v6-client-private.js';
import {openOriginalAITaskActionClientV6} from '../src/original-ai-task-action-v6-client.js';
declare const source:OriginalAITaskV6ReviewPortPrivate;declare const peer:unknown;declare const review:OriginalAITaskV6HeldReviewPrivate;const ctx=Object.freeze({signal:new AbortController().signal});
source.produceOriginalAITaskActionV6(peer,ctx,review);
// @ts-expect-error old no-review producer is not this ABI
source.produceOriginalAITaskActionV6(peer,ctx);
// @ts-expect-error no caller approval Boolean/JSON parameter
source.produceOriginalAITaskActionV6(peer,ctx,review,{approved:true});
const text:string=review.readOriginalUnsigned();
// @ts-expect-error original unsigned is canonical UTF8 string, not Record
const record:Record<string,unknown>=review.readOriginalUnsigned();
const c=await openOriginalAITaskActionClientV6();
// @ts-expect-error no Source/provider injection
openOriginalAITaskActionClientV6({source});
