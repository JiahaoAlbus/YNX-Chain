import test from 'node:test';
import assert from 'node:assert/strict';
import {CARD_OPERATION_RECOVERY_CONTRACT,cardOperationRecoveryContract} from './cardOperationRecoveryContract';
import {CardBusinessClient} from './cardBusinessClient';
import {cardOperationAvailabilityText} from './cardOperationAvailabilityCopy';
import {locales} from './i18n';
test('only the exact original-key feature marker is recognized; old and malformed versions stay read-only',()=>{
 for(const value of [null,[],{}, {features:true},{features:[]},{features:{operationReadback:true}},{features:{operationReadback:'other'}}])assert.equal(cardOperationRecoveryContract(value),undefined);
 assert.equal(cardOperationRecoveryContract({features:{operationReadback:CARD_OPERATION_RECOVERY_CONTRACT}}),CARD_OPERATION_RECOVERY_CONTRACT);
});
test('a business client does not infer recovery support from a configured source or private identity',()=>{
 const input={expectedSourceCommit:'a'.repeat(40),identity:()=>null,createIntrospectionProof:async()=>{throw Error('no approval')}};
 assert.equal(new CardBusinessClient(input).supportsOperationRecovery,false);
 assert.equal(new CardBusinessClient({...input,operationRecoveryContract:CARD_OPERATION_RECOVERY_CONTRACT}).supportsOperationRecovery,true);
});
test('the recovery-unavailable message is current-locale, preserves requests and never implies approval',()=>{
 for(const locale of locales){const text=cardOperationAvailabilityText(locale);assert.ok(text.length>30);if(locale==='en')assert.doesNotMatch(text,/[\u3400-\u9fff]/)}
 assert.match(cardOperationAvailabilityText('en'),/Saved records remain readable/);assert.match(cardOperationAvailabilityText('en'),/Do not resend with a new key/);
});
