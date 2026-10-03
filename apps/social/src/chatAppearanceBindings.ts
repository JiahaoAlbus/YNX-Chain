import { checkedChatSlot } from './chatAppearance';

// Presentation-only slots. These identifiers NEVER authorize a room or account.
function checkedIdentifier(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
    throw new Error('CHAT_APPEARANCE_INVALID_IDENTIFIER');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('CHAT_APPEARANCE_INVALID_IDENTIFIER');
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('CHAT_APPEARANCE_INVALID_IDENTIFIER');
    }
  }
  return value;
}

export async function deriveChatAppearanceSlots(account: string | null, room: string | null,
  hash: (value: string) => Promise<string>): Promise<{ slot: string; roomSlot: string | null }> {
  // Validate BOTH captured identifiers before hashing or opening preferences.
  if (account !== null) checkedIdentifier(account);
  if (room !== null) checkedIdentifier(room);
  const slot = account === null ? 'guest' : checkedChatSlot('a_' + await hash(account));
  const roomSlot = room === null ? null : checkedChatSlot('r_' + await hash(room), true);
  return { slot, roomSlot };
}
