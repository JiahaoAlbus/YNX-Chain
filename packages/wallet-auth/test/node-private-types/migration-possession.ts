import {verifyPQMigrationPossessionData} from '../../src/pq-wallet-authorization.js';import type {PQRegistrationIntent} from '../../src/pq-wallet-authorization.js';
declare const wire:Uint8Array,intent:PQRegistrationIntent;
const r=verifyPQMigrationPossessionData(wire,intent);const data:true=r.dataOnly;void data;
// @ts-expect-error This pure DATA result is never Source admission.
const grant:true=r.SourceAdmission;
// @ts-expect-error The normalized E15 is immutable.
r.intent.pkA='';
// @ts-expect-error No third provider/callback input is accepted.
verifyPQMigrationPossessionData(wire,intent,()=>{});
// @ts-expect-error All nine original E15 fields are required.
verifyPQMigrationPossessionData(wire,{chainId:'00'});
void grant;
