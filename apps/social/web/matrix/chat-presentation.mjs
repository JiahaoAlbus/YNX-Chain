// Presentation only: no SDK session, device trust or Social permission is
// inferred here. Plaintext preview must be supplied after current-view review.
export function roomPresentation(room, {selected=false, preview=null}={}) {
  const title = typeof room.name === 'string' && room.name.trim() ? room.name.trim() : 'Conversation';
  const unread = room.getUnreadNotificationCount?.();
  const timestamp = room.getLastLiveEvent?.()?.getTs?.();
  return { title, initial: Array.from(title)[0] ?? '', selected,
    invitation: room.getMyMembership() === 'invite',
    unread: Number.isSafeInteger(unread) && unread > 0 ? unread : 0,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
    preview: typeof preview === 'string' && preview ? preview : room.getMyMembership() === 'invite' ? 'Invitation pending' : 'Encrypted conversation' };
}
export function approvedMessagePreview(record) {
  if (!record || record.verification?.shieldColour !== 0 || record.remoteConfirmed !== true) return null;
  if (record.content?.file) return 'Encrypted attachment';
  const body = record.content?.body;
  return typeof body === 'string' && body.trim() ? body.replace(/[\r\n]+/g, ' ').slice(0, 180) : null;
}
export function messagePresentation(record, self) {
  const own = record.sender === self;
  const status = !own ? '' : record.remoteConfirmed === true ? record.readByPeer === true ? 'Read' : 'Sent'
    : record.localStatus === 'not_sent' ? 'Not sent' : ['sending','encrypting'].includes(record.localStatus) ? 'Sending' : record.localStatus === 'queued' ? 'Queued' : 'Not confirmed';
  return { own, status, timestamp: Number.isFinite(record.timestamp) && record.timestamp > 0 ? record.timestamp : null };
}
export function shouldSubmitChatKey(event) {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
