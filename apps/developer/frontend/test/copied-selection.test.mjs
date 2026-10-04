import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCopiedSelection, selectionFilename} from '../src/codeoss/copiedSelection.ts';
import {reviewedSelection} from '../../services/codeoss-service/src/reviewed-selection.mjs';
const sessionId='12345678-1234-1234-1234-123456789012';
const capture={uri:'file:///project/%E5%90%88%E7%BA%A6.ts',version:0,fullTextDigest:'a'.repeat(64),selectedText:'用户选择的代码',sessionId};
test('copied selection keeps exact editor metadata and agrees with server formatting checks',()=>{
 const text=JSON.stringify(capture),parsed=parseCopiedSelection(text,sessionId);
 assert.deepEqual(parsed,reviewedSelection(text,sessionId));assert.equal(selectionFilename(parsed),'合约.ts');
});
test('malformed or foreign copied input does not disclose clipboard contents',()=>{
 for(const value of ['private-unrelated-clipboard',JSON.stringify({...capture,sessionId:'foreign'}),JSON.stringify({...capture,extra:'private'}),JSON.stringify({...capture,fullTextDigest:[capture.fullTextDigest]}),JSON.stringify({...capture,uri:'https://example.invalid/private'}),JSON.stringify({...capture,version:-1})]){
  assert.throws(()=>parseCopiedSelection(value,sessionId),error=>error.message.includes('this editor session')&&!error.message.includes('private'));
 }
});
test('selection boundaries count UTF8 bytes and reject oversized clipboard before display',()=>{
 const exact={...capture,selectedText:'中'.repeat(21845)+'a'};
 assert.deepEqual(parseCopiedSelection(JSON.stringify(exact),sessionId),reviewedSelection(JSON.stringify(exact),sessionId));
 assert.throws(()=>parseCopiedSelection(JSON.stringify({...exact,selectedText:exact.selectedText+'b'}),sessionId));
 assert.throws(()=>parseCopiedSelection(' '.repeat(512*1024+1),sessionId));
});
