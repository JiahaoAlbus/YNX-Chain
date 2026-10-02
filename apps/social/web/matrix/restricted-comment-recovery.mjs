import {createBoundedOperation} from './bounded-operation.mjs';
const fail=()=>{throw new Error('MATRIX_COMMENT_RECOVERY_REQUIRED: original intent retained')};
const protocol='ynx-social-matrix-moment/v1';
const eventId=value=>typeof value==='string'&&/^\$[^\s\x00-\x1f]{1,254}$/.test(value);
const validAudience=value=>value?.protocol===protocol&&['contacts','group','selected','private'].includes(value.kind)&&/^[a-f0-9]{64}$/.test(value.revision)&&typeof value.owner==='string'&&value.owner.startsWith('@')&&typeof value.roomId==='string'&&value.roomId.startsWith('!')&&Array.isArray(value.members)&&value.members.length>0&&value.members.length<=256&&value.members.every(member=>typeof member==='string'&&member.startsWith('@'))&&new Set(value.members).size===value.members.length&&value.members.includes(value.owner)&&(value.kind!=='private'||value.members.length===1);
const audience=value=>JSON.stringify({protocol:value?.protocol,kind:value?.kind,revision:value?.revision,owner:value?.owner,roomId:value?.roomId,members:Array.isArray(value?.members)?[...value.members].sort():null});

// Matrix readback recovery. No publish/upload/send API is invoked here; the
// existing authority may commit the original authenticated event's index.
// The caller retains the protected record until this confirms its exact event.
export async function recoverIndexedComment(options){
  if(typeof options?.guard!=='function')fail();
  const bounded=createBoundedOperation({signal:options.signal});
  const guard=()=>{bounded.guard();options.guard()};
  try{return await bounded.wait(()=>recoverOriginal({...options,guard,wait:bounded.wait,signal:bounded.signal}))}
  finally{bounded.dispose()}
}
async function recoverOriginal({intent,expectedSender,loadIndexes,consumer,guard,validateIdentity=async()=>{},wait=action=>action(),signal=null}) {
  if(typeof guard!=='function'||typeof loadIndexes!=='function'||typeof consumer?.read!=='function')fail();
  guard();
  const original=structuredClone(intent),comment=original?.comment;
  if(original?.status!=='delivery-unknown'||!/^[A-Za-z0-9_-]{16,128}$/.test(original.transactionId)||typeof original.text!=='string'||!original.text.trim()||original.text.length>16000||comment?.parent?.protocol!==protocol||!eventId(comment.parent.eventId)||!validAudience(comment.index?.audience)||typeof expectedSender!=='string'||!expectedSender.startsWith('@')||comment.author!==expectedSender)fail();
  if(comment.parent.eventId!==comment.index.eventId||comment.parent.roomId!==comment.index.audience.roomId||comment.parent.revision!==comment.index.audience.revision||comment.parent.owner!==comment.index.audience.owner)fail();
  let after='',match=null;
  const cursors=new Set();
  // Bounded lookup fails closed without consuming or replacing the intent.
  for(let page=0;page<64;++page){
    const feed=await wait(()=>loadIndexes(after,{signal,assertCurrent:guard}));guard();
    if(!feed||!Array.isArray(feed.indexes)||feed.indexes.length>40)fail();
    for(const index of feed.indexes){
      if(index.transactionId!==original.transactionId)continue;
      if(match||!eventId(index.eventId)||index.parentEventId!==comment.parent.eventId||index.sender!==expectedSender||!validAudience(index.audience)||audience(index.audience)!==audience(comment.index.audience))fail();
      match=structuredClone(index);
    }
    if(!feed.after)break;
    if(!/^[a-f0-9]{64}$/.test(feed.after)||cursors.has(feed.after)||page===63)fail();
    cursors.add(feed.after);after=feed.after;
  }
  if(!match){
    if(typeof consumer.recover!=='function')fail();
    const receipt=await wait(()=>consumer.recover(original,{signal,assertCurrent:guard,validateIdentity}));guard();
    if(receipt?.transactionId!==original.transactionId||!eventId(receipt.eventId)||receipt.parentEventId!==comment.parent.eventId||receipt.sender!==expectedSender)fail();
    return Object.freeze({transactionId:original.transactionId,eventId:receipt.eventId,parentEventId:comment.parent.eventId,sender:expectedSender});
  }
  const decoded=await wait(()=>consumer.read(structuredClone(match),{signal,assertCurrent:guard}));guard();
  if(decoded?.eventId!==match.eventId||decoded.text!==original.text||decoded.attachment||decoded.parent!==null||decoded.protocol!==undefined&&decoded.protocol!==protocol||decoded.kind!==undefined&&decoded.kind!=='comment')fail();
  return Object.freeze({transactionId:original.transactionId,eventId:match.eventId,parentEventId:comment.parent.eventId,sender:expectedSender});
}
