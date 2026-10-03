import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_MARKER_PATTERNS} from './release-content-policy.mjs';

test('complete Unicode words in translated release copy are not marker fragments',()=>{
  for(const text of ['Este método requiere argumentos codificados en ABI.','Método','meto\u0301do','méTODO','TODOé','áFIXME','FIXME界','界TODO界','xTODO','TODO1','TODO_name']){
    for(const [,pattern] of RELEASE_MARKER_PATTERNS)assert.equal(pattern.test(text),false,text);
  }
});
test('standalone unfinished markers remain blocked across casing and punctuation',()=>{
  for(const [label,pattern] of RELEASE_MARKER_PATTERNS){
    const marker=label.split(' ')[0];
    for(const text of [marker,marker.toLowerCase(),marker[0]+marker.slice(1).toLowerCase(),'// '+marker+': finish this','/* '+marker+' */','"'+marker+'"','['+marker+']','('+marker+')','\n'+marker+'\n',marker+'\u200b','🙂 '+marker]){
      assert.equal(pattern.test(text),true,label+': '+JSON.stringify(text));
    }
  }
});
test('the two disjoint marker policies remain immutable and deterministic',()=>{
  assert.ok(Object.isFrozen(RELEASE_MARKER_PATTERNS));
  for(const entry of RELEASE_MARKER_PATTERNS){assert.ok(Object.isFrozen(entry));assert.equal(entry[1].global,false)}
  assert.equal(RELEASE_MARKER_PATTERNS[0][1].test('FIXME'),false);
  assert.equal(RELEASE_MARKER_PATTERNS[1][1].test('TODO'),false);
});
