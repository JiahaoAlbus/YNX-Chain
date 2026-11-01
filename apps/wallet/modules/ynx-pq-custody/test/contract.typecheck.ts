import {preparePQOperation,readPQPublicStatus,type PQHeldOperation,type PQPublicOutcome} from '../index';
// @ts-expect-error caller approval is not part of DATA selection
preparePQOperation({reference:'PUBLIC',mode:'transaction',approved:true});
// @ts-expect-error birth is not registered restoration
preparePQOperation({reference:'PUBLIC',mode:'birth'});
// @ts-expect-error native opaque operations cannot be made from an ID
const forged:PQHeldOperation=17;
declare const operation:PQHeldOperation;
// @ts-expect-error no arbitrary signer payload or private bytes in bridge
operation.signOnce({privateKey:'PUBLIC-placeholder'});
// @ts-expect-error broadcast accepts no supplied permission token
operation.submitSignedOnce({approved:true});
declare const outcome:PQPublicOutcome;
// @ts-expect-error renderer never receives a signed Member to resend
outcome.member;
// @ts-expect-error renderer never receives a native custody handle
outcome.owner;
void forged;
// @ts-expect-error status accepts no caller reference or approval
readPQPublicStatus({reference:'PUBLIC',approved:true});
const status=readPQPublicStatus();
// @ts-expect-error passive status cannot be promoted to signing authority
status.canSign=true;
// @ts-expect-error Native lifecycle binding is never a public status field
status.runtimeBinding;
