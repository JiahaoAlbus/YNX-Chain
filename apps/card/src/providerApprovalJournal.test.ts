import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalJournalKey,readApprovalJournal,rememberApproval,savedApproval} from './providerApprovalJournal';
test('refresh preserves exact submit and callback operation IDs independently for each application',()=>{
  let journal=readApprovalJournal(null,'owner-a');
  journal=rememberApproval(journal,{owner:'owner-a',applicationId:'app-a',operationId:'create-a',resultOperationId:'result-a'});
  journal=rememberApproval(journal,{owner:'owner-a',applicationId:'app-b',operationId:'create-b',resultOperationId:'result-b'});
  const restored=readApprovalJournal(JSON.stringify(journal),'owner-a');
  assert.equal(savedApproval(restored,'app-a')?.operationId,'create-a');
  assert.equal(savedApproval(restored)?.resultOperationId,'result-b');
  assert.equal(savedApproval(restored,'foreign'),null);
});
test('another owner or corrupt continuation cannot restore an operation',()=>{
  const journal=rememberApproval(readApprovalJournal(null,'owner-a'),{owner:'owner-a',applicationId:'app-a',operationId:'create-a',resultOperationId:'result-a'});
  assert.notEqual(approvalJournalKey('owner-a'),approvalJournalKey('owner-b'));
  assert.throws(()=>readApprovalJournal(JSON.stringify(journal),'owner-b'),/JOURNAL_INVALID/);
  assert.throws(()=>readApprovalJournal('{broken','owner-a'),/JOURNAL_INVALID/);
  assert.throws(()=>rememberApproval(journal,{owner:'owner-b',applicationId:'app-a',operationId:'create-a',resultOperationId:'result-a'}),/JOURNAL_INVALID/);
});
