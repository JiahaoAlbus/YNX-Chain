import test from 'node:test';
import assert from 'node:assert/strict';
import {captureTaskSource,ownsTaskSource} from '../frontend/src/runtime/taskSource.ts';
test('late build cannot attach artifacts to another project or changed source',()=>{
 const original={id:'A',files:{'main.sol':'contract A {}'}},captured=captureTaskSource(original);
 assert.equal(ownsTaskSource({id:'B',files:{...original.files}},captured),false);
 assert.equal(ownsTaskSource({id:'A',files:{'main.sol':'contract Edited {}'}},captured),false);
 assert.equal(ownsTaskSource({id:'A',files:{...original.files,'new.sol':'contract New {}'}},captured),false);
 assert.equal(ownsTaskSource({id:'A',files:{...original.files}},captured),true);
});
test('captured execution source is independent from later mutable caller state',()=>{
 const project={id:'A',files:{'main.js':'console.log("original")'}},captured=captureTaskSource(project);
 project.files['main.js']='console.log("replaced")';project.id='B';
 assert.equal(captured.id,'A');assert.equal(captured.files['main.js'],'console.log("original")');
 assert.equal(ownsTaskSource(project,captured),false);
});
