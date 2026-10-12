import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {reviewedSelection,reviewedReplacement,savedSelectionReview,SELECTION_KIND} from '../src/reviewed-selection.mjs';
const require=createRequire(import.meta.url),{digest,validateChanges}=require('../../../native/ynx-tools/src/guards.cjs');
const id='12345678-1234-1234-1234-123456789012',uri='file:///project/main.ts',source='before\nconst chosen = 1;\nafter\n';
const capture={uri,version:3,fullTextDigest:digest(source),selectedText:'const chosen = 1;',sessionId:id};
const documents=(text=source,version=3)=>new Map([[uri,{version,getText:()=>text}]]);
test('reviewed selection produces a native preview preserving all surrounding text',()=>{
 const selection=reviewedSelection(JSON.stringify(capture),id), edit=reviewedReplacement(JSON.stringify({summary:'Change value',replacement:'const chosen = 2;'}),selection);
 const changes=validateChanges(edit.bundle,documents(),id);assert.equal(changes[0].text,'before\nconst chosen = 2;\nafter\n');
 assert.equal(edit.bundle.changes[0].uri,uri);assert.equal(edit.bundle.changes[0].version,3);assert.equal(edit.bundle.changes[0].text,undefined);
 assert.throws(()=>validateChanges(edit.bundle,documents(source,4),id),/changed/);
 assert.throws(()=>validateChanges(edit.bundle,documents(source+'changed'),id),/changed/);
 assert.throws(()=>validateChanges(edit.bundle,documents(),'other'),/reviewed/);
});
test('only reviewed capture metadata determines the edit target and unsupported captures fail closed',()=>{
 for(const value of [{...capture,sessionId:'other'},{...capture,selectedText:''},{...capture,fullTextDigest:'bad'},{...capture,extra:true}])assert.throws(()=>reviewedSelection(JSON.stringify(value),id),{code:'tools_selection_invalid'});
 assert.throws(()=>reviewedSelection('plain selected text',id),{code:'tools_selection_invalid'});
 const selection=reviewedSelection(JSON.stringify(capture),id);
 for(const value of ['plain answer',JSON.stringify({summary:'Injected path',replacement:'change',uri:'file:///other'}),JSON.stringify({summary:'',replacement:'change'})])assert.throws(()=>reviewedReplacement(value,selection),{code:'tools_edit_output_invalid'});
});
test('missing or duplicated selection never guesses a replacement and full document output stays bounded',()=>{
 const bundle=text=>({protocol:'ynx-reviewed-text/v1',sessionId:id,changes:[{uri,version:3,fullTextDigest:digest(text),replacements:[{find:'chosen',replace:'new'}]}]});
 assert.throws(()=>validateChanges(bundle('not present'),documents('not present'),id),/missing/);
 assert.throws(()=>validateChanges(bundle('chosen chosen'),documents('chosen chosen'),id),/more than once/);
 const change=bundle('chosen');change.changes[0].text='arbitrary overwrite';assert.throws(()=>validateChanges(change,documents('chosen'),id),/one exact/);
 const huge=bundle('chosen');huge.changes[0].replacements[0].replace='界'.repeat(90000);assert.throws(()=>validateChanges(huge,documents('chosen'),id),/boundary/);
});
test('saved completed edit reopens without model replay; old runtime review is not rebound to another session',()=>{
 const text=JSON.stringify({summary:'Change',replacement:'new'}),context=JSON.stringify({kind:SELECTION_KIND,context:JSON.stringify(capture)});
 assert.equal(savedSelectionReview(context,text,id).bundle.sessionId,id);assert.equal(savedSelectionReview(context,text,'other'),null);
  assert.equal(savedSelectionReview('ordinary pasted context',text,id),null);
  assert.equal(savedSelectionReview(context,'opaque legacy plan text',id),null);
});

test('capture digest must be a string instead of an array coercible to the same hash',()=>{
 for(const fullTextDigest of [[capture.fullTextDigest],{toString:capture.fullTextDigest}]){
  assert.throws(()=>reviewedSelection(JSON.stringify({...capture,fullTextDigest}),id),{code:'tools_selection_invalid'});
 }
});
