import type { SendMessageRequest } from "./chatCrypto";

export type PendingMessage = Readonly<{ account: string; deviceId: string; conversationId: string; request: SendMessageRequest }>;
export function readOutbox(raw: string | null): PendingMessage[] {
  if (!raw) return [];
  if (raw.length > 4 * 1024 * 1024) throw new Error("Pending message storage exceeds its limit");
  const parsed = JSON.parse(raw);
  // Preserve legacy records without attributing them to a different device.
  const entries = Array.isArray(parsed) ? parsed : [{ ...parsed, deviceId: parsed.deviceId ?? "" }];
  if (entries.length > 100) throw new Error("Too many pending messages");
  for (const entry of entries) {
    if (!entry || typeof entry.account !== "string" || typeof entry.deviceId !== "string" ||
      typeof entry.conversationId !== "string" || typeof entry.request?.messageId !== "string" ||
      !Array.isArray(entry.request.envelopes) || typeof entry.request.senderSignature !== "string") {
      throw new Error("Pending message storage is invalid; existing data was preserved");
    }
  }
  return entries;
}
function same(left: PendingMessage, right: PendingMessage) {
  return left.account === right.account && left.deviceId === right.deviceId &&
    left.conversationId === right.conversationId && left.request.messageId === right.request.messageId;
}
export function queueMessage(entries: readonly PendingMessage[], message: PendingMessage): PendingMessage[] {
  const previous = entries.find((entry) => same(entry, message));
  if (previous) {
    if (JSON.stringify(previous.request) !== JSON.stringify(message.request)) throw new Error("Pending message ID cannot be reused with different ciphertext");
    return [...entries];
  }
  const next = [...entries, message];
  readOutbox(JSON.stringify(next));
  return next;
}
export function acknowledgeQueued(entries: readonly PendingMessage[], message: PendingMessage): PendingMessage[] {
  return entries.filter((entry) => !same(entry, message));
}
export function pendingFor(entries: readonly PendingMessage[], account: string, deviceId: string, conversationId: string) {
  return entries.find((entry) => entry.account === account && entry.deviceId === deviceId && entry.conversationId === conversationId)?.request ?? null;
}
