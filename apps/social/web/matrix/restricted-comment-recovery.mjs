const fail=()=>{throw new Error('MATRIX_COMMENT_RECOVERY_REQUIRED: original intent retained')};
const audience=value=>JSON.stringify({protocol:value?.protocol,kind:value?.kind,revision:value?.revision,owner:value?.owner,roomId:value?.roomId,members:Array.isArray(value?.members)?[...value.members].sort():null});

// Read-only recovery. No publish/upload/send API is accepted or invoked here.
// The caller retains the protected record until this confirms its exact event.
export async function recoverIndexedComment({intent,expectedSender,loadIndexes,consumer,guard}) {
  if(typeof guard!=='function'||typeof loadIndexes!=='function'||typeof consumer?.read!=='function')fail();
  guard();
  const original=structuredClone(intent),comment=original?.comment;
  if(original?.status!=='delivery-unknown'||!/^[A-Za-z0-9_-]{16,128}$/.test(original.transactionId)||typeof original.text!=='string'||!original.text||!comment?.parent||!comment.index?.audience||typeof expectedSender!=='string'||!expectedSender.startsWith('@')||comment.author!==expectedSender)fail();
  if(comment.parent.eventId!==comment.index.eventId||comment.parent.roomId!==comment.index.audience.roomId||comment.parent.revision!==comment.index.audience.revision||comment.parent.owner!==comment.index.audience.owner)fail();
  let after='',match=null;
  const cursors=new Set();
  // Bounded lookup fails closed without consuming or replacing the intent.
  for(let page=0;page<64;++page){
    const feed=await loadIndexes(after);guard();
    if(!feed||!Array.isArray(feed.indexes)||feed.indexes.length>40)fail();
    for(const index of feed.indexes){
      if(index.transactionId!==original.transactionId)continue;
      if(match||index.parentEventId!==comment.parent.eventId||index.sender!==expectedSender||audience(index.audience)!==audience(comment.index.audience))fail();
      match=index;
    }
    if(!feed.after)break;
    if(!/^[a-f0-9]{64}$/.test(feed.after)||cursors.has(feed.after)||page===63)fail();
    cursors.add(feed.after);after=feed.after;
  }
  if(!match)fail();
  const decoded=await consumer.read(match);guard();
  if(decoded?.eventId!==match.eventId||decoded.text!==original.text||decoded.attachment||decoded.parent!==null)fail();
  return Object.freeze({transactionId:original.transactionId,eventId:match.eventId,parentEventId:comment.parent.eventId,sender:expectedSender});
}
