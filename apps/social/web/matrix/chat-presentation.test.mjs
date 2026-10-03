import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedMessagePreview, messagePresentation, roomPresentation, shouldSubmitChatKey } from './chat-presentation.mjs';

test('real SDK metadata is used without fabricated names, times or unread badges', () => {
  const room = {name:'Ada @original:remote.test',getMyMembership:()=> 'join',getUnreadNotificationCount:()=>4,getLastLiveEvent:()=>({getTs:()=>1234})};
  assert.deepEqual(roomPresentation(room), {title:room.name,initial:'A',selected:false,invitation:false,unread:4,timestamp:1234,preview:'Encrypted conversation'});
  assert.equal(roomPresentation({...room,getUnreadNotificationCount:()=>-3,getLastLiveEvent:()=>undefined}).unread,0);
  assert.equal(roomPresentation({...room,getMyMembership:()=> 'invite'}).preview,'Invitation pending');
});
test('unreviewed, local, sender-warning or attachment plaintext never enters previews', () => {
  const record={verification:{shieldColour:0},remoteConfirmed:true,content:{body:'Original\nmessage'}};
  assert.equal(approvedMessagePreview(record),'Original message');
  for(const value of [null,{...record,verification:null},{...record,verification:{shieldColour:1}},{...record,remoteConfirmed:false}])assert.equal(approvedMessagePreview(value),null);
  assert.equal(approvedMessagePreview({...record,content:{body:'private filename',file:{}}}),'Encrypted attachment');
});
test('local echoes and server acceptance cannot be labeled delivered or read', () => {
  const record={sender:'@self:example.test',remoteConfirmed:false,localStatus:'queued'};
  assert.equal(messagePresentation(record,record.sender).status,'Queued');
  assert.equal(messagePresentation({...record,remoteConfirmed:true},record.sender).status,'Sent');
  assert.equal(messagePresentation({...record,remoteConfirmed:true,readByPeer:true},record.sender).status,'Read');
  assert.equal(messagePresentation({...record,remoteConfirmed:false,readByPeer:true},record.sender).status,'Queued');
});
test('explicit Ctrl/Cmd Enter only, never composition, Shift or normal Enter', () => {
  const key={key:'Enter',ctrlKey:true,metaKey:false,shiftKey:false,isComposing:false,keyCode:13};
  assert.equal(shouldSubmitChatKey(key),true);
  for(const changed of [{isComposing:true},{keyCode:229},{shiftKey:true},{ctrlKey:false},{key:'a'}])assert.equal(shouldSubmitChatKey({...key,...changed}),false);
  assert.equal(shouldSubmitChatKey({...key,ctrlKey:false,metaKey:true}),true);
});
