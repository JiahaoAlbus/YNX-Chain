import type { ChatEnvelope } from "../crypto/chatCrypto";

export type ChatDevice = Readonly<{
  id: string;
  account: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
}>;

export type ChatConversation = Readonly<{
  id: string;
  members: readonly [string, string];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ChatMessage = Readonly<{
  id: string;
  conversationId: string;
  sender: string;
  senderDeviceId: string;
  algorithm: ChatEnvelope["algorithm"];
  nonce: string;
  ciphertext: string;
  ciphertextHash: string;
  createdAt: string;
  deliveredAt: Readonly<Record<string, string>>;
  readAt: Readonly<Record<string, string>>;
}>;

export type DecryptedChatMessage = ChatMessage & Readonly<{
  plaintext: string | null;
  decryptionError: string | null;
}>;

export function parseChatConversations(value: unknown): ChatConversation[] {
  const root = plainObject(value, "Chat conversation response");
  if (!Array.isArray(root.conversations)) throw new Error("Chat conversation response is malformed");
  return root.conversations.map(parseChatConversation);
}

export function parseChatConversationResult(value: unknown): ChatConversation {
  const root = plainObject(value, "Chat conversation result");
  return parseChatConversation(root.record);
}

export function parseChatDevices(value: unknown): ChatDevice[] {
  const root = plainObject(value, "Chat device response");
  if (!Array.isArray(root.devices)) throw new Error("Chat device response is malformed");
  return root.devices.map((item) => {
    const record = plainObject(item, "Chat device");
    const status = text(record.status, "Chat device status");
    if (status !== "active" && status !== "revoked") throw new Error("Chat device status is invalid");
    return Object.freeze({
      id: identifier(record.id, "Chat device ID"),
      account: ynxAddress(record.account, "Chat device account"),
      signingPublicKey: base64(record.signingPublicKey, "Chat signing public key"),
      encryptionPublicKey: base64(record.encryptionPublicKey, "Chat encryption public key"),
      status,
      createdAt: timestamp(record.createdAt, "Chat device createdAt"),
      updatedAt: timestamp(record.updatedAt, "Chat device updatedAt"),
    });
  });
}

export function parseChatMessages(value: unknown): ChatMessage[] {
  const root = plainObject(value, "Chat message response");
  if (!Array.isArray(root.messages)) throw new Error("Chat message response is malformed");
  return root.messages.map((item) => {
    const record = plainObject(item, "Chat message");
    if (record.algorithm !== "x25519-hkdf-sha256-xchacha20poly1305") throw new Error("Chat message algorithm is invalid");
    return Object.freeze({
      id: identifier(record.id, "Chat message ID"),
      conversationId: identifier(record.conversationId, "Chat conversation ID"),
      sender: ynxAddress(record.sender, "Chat sender"),
      senderDeviceId: identifier(record.senderDeviceId, "Chat sender device ID"),
      algorithm: record.algorithm,
      nonce: base64(record.nonce, "Chat nonce"),
      ciphertext: base64(record.ciphertext, "Chat ciphertext"),
      ciphertextHash: hexDigest(record.ciphertextHash, "Chat ciphertext hash"),
      createdAt: timestamp(record.createdAt, "Chat message createdAt"),
      deliveredAt: timestampMap(record.deliveredAt, "Chat deliveredAt"),
      readAt: timestampMap(record.readAt, "Chat readAt"),
    });
  });
}

function parseChatConversation(value: unknown): ChatConversation {
  const record = plainObject(value, "Chat conversation");
  if (!Array.isArray(record.members) || record.members.length !== 2) throw new Error("Chat conversation members are malformed");
  return Object.freeze({
    id: identifier(record.id, "Chat conversation ID"),
    members: Object.freeze([ynxAddress(record.members[0], "Chat member"), ynxAddress(record.members[1], "Chat member")]) as readonly [string, string],
    createdBy: ynxAddress(record.createdBy, "Chat creator"),
    createdAt: timestamp(record.createdAt, "Chat conversation createdAt"),
    updatedAt: timestamp(record.updatedAt, "Chat conversation updatedAt"),
  });
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is malformed`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function ynxAddress(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^ynx1[0-9a-z]{38}$/.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function base64(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[A-Za-z0-9+/_-]+$/.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function hexDigest(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^[0-9a-f]{64}$/.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!Number.isFinite(new Date(parsed).getTime())) throw new Error(`${label} is invalid`);
  return parsed;
}

function timestampMap(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined || value === null) return Object.freeze({});
  const record = plainObject(value, label);
  const result: Record<string, string> = {};
  for (const [account, at] of Object.entries(record)) result[ynxAddress(account, label)] = timestamp(at, label);
  return Object.freeze(result);
}
