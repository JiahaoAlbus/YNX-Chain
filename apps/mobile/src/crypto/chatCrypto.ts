import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64RawToBytes, bytesToBase64Raw } from "./encoding";
import { addressIdentity } from "./ynxSigner";

export const CHAT_ALGORITHM = "x25519-hkdf-sha256-xchacha20poly1305";
const ENCRYPTION_KEY_DOMAIN = utf8ToBytes("YNX_CHAT_ENCRYPTION_KEY_V1\n");
const ENVELOPE_INFO = utf8ToBytes("YNX-NATIVE-WALLET-E2EE-V1");

export type ChatEnvelope = Readonly<{
  algorithm: typeof CHAT_ALGORITHM;
  nonce: string;
  ciphertext: string;
}>;

export type ChatEnvelopeRecipient = Readonly<{
  account: string;
  deviceId: string;
  encryptionPublicKey: string;
}>;

export type ChatDeviceEnvelope = Readonly<{
  recipientAccount: string;
  recipientDeviceId: string;
  algorithm: typeof CHAT_ALGORITHM;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  ciphertextHash: string;
}>;

export type ChatEnvelopeSet = Readonly<{
  messageId: string;
  envelopes: readonly ChatDeviceEnvelope[];
  senderSignature: string;
}>;

export type ChatDeviceRotationRequest = Readonly<{
  idempotencyKey: string;
  newDeviceId: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  authorizationSignature: string;
  newDeviceProofSignature: string;
}>;

export function chatEncryptionPublicKey(deviceSecret: Uint8Array): string {
  return bytesToBase64Raw(x25519.getPublicKey(chatEncryptionPrivateKey(deviceSecret)));
}

export function chatDeviceRegistration(input: { account: string; deviceId: string; deviceSecret: Uint8Array; idempotencyKey: string }) {
  const secret = validDeviceSecret(input.deviceSecret);
  const request = {
    idempotencyKey: validIdentifier(input.idempotencyKey),
    account: validYNXAddress(input.account),
    deviceId: validIdentifier(input.deviceId),
    signingPublicKey: bytesToBase64Raw(ed25519.getPublicKey(secret)),
    encryptionPublicKey: chatEncryptionPublicKey(secret),
  };
  const payload = utf8ToBytes(["ynx-chat-device-register-v1", request.account, request.deviceId, request.signingPublicKey, request.encryptionPublicKey, request.idempotencyKey].join("\n"));
  return Object.freeze({ ...request, proofSignature: bytesToBase64Raw(ed25519.sign(payload, secret)) });
}

export function signChatRequest(input: { method: "GET" | "POST"; requestUri: string; timestamp: string; body?: string; deviceSecret: Uint8Array }): string {
  const secret = validDeviceSecret(input.deviceSecret);
  if (!input.requestUri.startsWith("/chat/") || input.requestUri.includes("#")) throw new Error("Chat request URI is invalid");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input.timestamp)) throw new Error("Chat timestamp is invalid");
  const body = utf8ToBytes(input.body ?? "");
  const payload = utf8ToBytes(["ynx-chat-http-v1", input.method, input.requestUri, input.timestamp, bytesToHex(sha256(body))].join("\n"));
  return bytesToBase64Raw(ed25519.sign(payload, secret));
}

export function createChatDeviceRotation(input: { account: string; authorizingDeviceId: string; replacedDeviceId: string; authorizingDeviceSecret: Uint8Array; newDeviceSecret: Uint8Array; idempotencyKey: string; newDeviceId: string }): ChatDeviceRotationRequest {
  const account = validYNXAddress(input.account);
  const authorizingDeviceId = validIdentifier(input.authorizingDeviceId);
  const replacedDeviceId = validIdentifier(input.replacedDeviceId);
  const idempotencyKey = validIdentifier(input.idempotencyKey);
  const newDeviceId = validIdentifier(input.newDeviceId);
  if (newDeviceId === replacedDeviceId) throw new Error("Replacement Chat device ID must be new");
  const authorizingSecret = validDeviceSecret(input.authorizingDeviceSecret);
  const newSecret = validDeviceSecret(input.newDeviceSecret);
  const request = {
    idempotencyKey,
    newDeviceId,
    signingPublicKey: bytesToBase64Raw(ed25519.getPublicKey(newSecret)),
    encryptionPublicKey: chatEncryptionPublicKey(newSecret),
  };
  const document = JSON.stringify({ account, authorizingDeviceId, replacedDeviceId, ...request });
  return Object.freeze({
    ...request,
    authorizationSignature: bytesToBase64Raw(ed25519.sign(utf8ToBytes(`ynx-chat-device-rotation-authorize-v1\n${document}`), authorizingSecret)),
    newDeviceProofSignature: bytesToBase64Raw(ed25519.sign(utf8ToBytes(`ynx-chat-device-rotation-new-device-v1\n${document}`), newSecret)),
  });
}

export function encryptChatMessage(input: { deviceSecret: Uint8Array; recipientPublicKey: string; conversationId: string; messageId: string; plaintext: string; nonce: Uint8Array }): ChatEnvelope {
  if (input.plaintext.trim().length === 0 || input.plaintext.length > 16000) throw new Error("Chat message must contain 1 to 16000 characters");
  if (input.nonce.length !== 24) throw new Error("Chat message nonce must contain 24 random bytes");
  const key = envelopeKey(chatEncryptionPrivateKey(input.deviceSecret), decodeEncryptionPublicKey(input.recipientPublicKey));
  const aad = messageAAD(input.conversationId, input.messageId);
  const ciphertext = xchacha20poly1305(key, input.nonce, aad).encrypt(utf8ToBytes(input.plaintext));
  key.fill(0);
  return Object.freeze({ algorithm: CHAT_ALGORITHM, nonce: bytesToBase64Raw(input.nonce), ciphertext: bytesToBase64Raw(ciphertext) });
}

export function decryptChatMessage(input: { deviceSecret: Uint8Array; peerPublicKey: string; conversationId: string; messageId: string; envelope: ChatEnvelope }): string {
  if (input.envelope.algorithm !== CHAT_ALGORITHM) throw new Error("Unsupported YNX Chat encryption algorithm");
  const nonce = base64RawToBytes(input.envelope.nonce, "Chat nonce");
  if (nonce.length !== 24) throw new Error("Chat nonce must encode 24 bytes");
  const ciphertext = base64RawToBytes(input.envelope.ciphertext, "Chat ciphertext");
  if (ciphertext.length < 16) throw new Error("Chat ciphertext is malformed");
  const key = envelopeKey(chatEncryptionPrivateKey(input.deviceSecret), decodeEncryptionPublicKey(input.peerPublicKey));
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, nonce, messageAAD(input.conversationId, input.messageId)).decrypt(ciphertext);
  } catch {
    throw new Error("YNX Chat message authentication failed");
  } finally {
    key.fill(0);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export function createChatEnvelopeSet(input: { deviceSecret: Uint8Array; senderAccount: string; senderDeviceId: string; conversationId: string; messageId: string; plaintext: string; recipients: readonly ChatEnvelopeRecipient[]; entropy: Uint8Array }): ChatEnvelopeSet {
  const senderSecret = validDeviceSecret(input.deviceSecret);
  const senderAccount = validYNXAddress(input.senderAccount);
  const senderDeviceId = validIdentifier(input.senderDeviceId);
  const conversationId = validIdentifier(input.conversationId);
  const messageId = validIdentifier(input.messageId);
  if (input.plaintext.trim().length === 0 || input.plaintext.length > 16000) throw new Error("Chat message must contain 1 to 16000 characters");
  if (!(input.entropy instanceof Uint8Array) || input.entropy.length !== 32) throw new Error("Chat message entropy must contain 32 random bytes");
  if (input.recipients.length < 1 || input.recipients.length > 32) throw new Error("Chat message requires 1 to 32 active device recipients");

  const ephemeralPrivate = input.entropy.slice();
  const ephemeralPublicKey = bytesToBase64Raw(x25519.getPublicKey(ephemeralPrivate));
  const seen = new Set<string>();
  const envelopes = input.recipients.map((recipient) => {
    const recipientAccount = validYNXAddress(recipient.account);
    const recipientDeviceId = validIdentifier(recipient.deviceId);
    if (seen.has(recipientDeviceId)) throw new Error("Chat message contains a duplicate recipient device");
    seen.add(recipientDeviceId);
    const nonce = sha256(concatBytes(utf8ToBytes("YNX_CHAT_ENVELOPE_NONCE_V2\n"), input.entropy, utf8ToBytes(`\n${recipientAccount}\n${recipientDeviceId}`))).slice(0, 24);
    const aad = messageEnvelopeAAD({ conversationId, messageId, senderDeviceId, recipientAccount, recipientDeviceId, ephemeralPublicKey });
    const key = envelopeKey(ephemeralPrivate.slice(), decodeEncryptionPublicKey(recipient.encryptionPublicKey));
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(utf8ToBytes(input.plaintext));
    key.fill(0);
    return Object.freeze({
      recipientAccount,
      recipientDeviceId,
      algorithm: CHAT_ALGORITHM,
      ephemeralPublicKey,
      nonce: bytesToBase64Raw(nonce),
      ciphertext: bytesToBase64Raw(ciphertext),
      ciphertextHash: bytesToHex(sha256(ciphertext)),
    });
  }).sort(compareDeviceEnvelope);
  ephemeralPrivate.fill(0);

  const unsigned = { messageId, envelopes };
  const senderSignature = bytesToBase64Raw(ed25519.sign(chatMessageSignaturePayload({ conversationId, messageId, senderAccount, senderDeviceId, envelopes }), senderSecret));
  return Object.freeze({ ...unsigned, envelopes: Object.freeze(envelopes), senderSignature });
}

export function verifyChatEnvelopeSetSignature(input: { conversationId: string; messageId: string; senderAccount: string; senderDeviceId: string; envelopes: readonly ChatDeviceEnvelope[]; senderSignature: string; senderSigningPublicKey: string }): boolean {
  const publicKey = base64RawToBytes(input.senderSigningPublicKey, "Chat sender signing public key");
  if (publicKey.length !== 32) throw new Error("Chat sender signing public key must encode 32 bytes");
  const signature = base64RawToBytes(input.senderSignature, "Chat sender signature");
  if (signature.length !== 64) return false;
  return ed25519.verify(signature, chatMessageSignaturePayload(input), publicKey);
}

export function decryptChatDeviceEnvelope(input: { deviceSecret: Uint8Array; conversationId: string; messageId: string; senderDeviceId: string; envelope: ChatDeviceEnvelope }): string {
  if (input.envelope.algorithm !== CHAT_ALGORITHM) throw new Error("Unsupported YNX Chat encryption algorithm");
  const nonce = base64RawToBytes(input.envelope.nonce, "Chat nonce");
  if (nonce.length !== 24) throw new Error("Chat nonce must encode 24 bytes");
  const ciphertext = base64RawToBytes(input.envelope.ciphertext, "Chat ciphertext");
  if (ciphertext.length < 16 || bytesToHex(sha256(ciphertext)) !== input.envelope.ciphertextHash) throw new Error("Chat ciphertext integrity check failed");
  const key = envelopeKey(chatEncryptionPrivateKey(input.deviceSecret), decodeEncryptionPublicKey(input.envelope.ephemeralPublicKey));
  const aad = messageEnvelopeAAD({
    conversationId: input.conversationId,
    messageId: input.messageId,
    senderDeviceId: input.senderDeviceId,
    recipientAccount: input.envelope.recipientAccount,
    recipientDeviceId: input.envelope.recipientDeviceId,
    ephemeralPublicKey: input.envelope.ephemeralPublicKey,
  });
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(key, nonce, aad).decrypt(ciphertext));
  } catch {
    throw new Error("YNX Chat message authentication failed");
  } finally {
    key.fill(0);
  }
}

function chatEncryptionPrivateKey(deviceSecret: Uint8Array): Uint8Array {
  return sha256(concatBytes(ENCRYPTION_KEY_DOMAIN, validDeviceSecret(deviceSecret)));
}

function envelopeKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(privateKey, publicKey);
  privateKey.fill(0);
  const key = hkdf(sha256, shared, undefined, ENVELOPE_INFO, 32);
  shared.fill(0);
  return key;
}

function messageAAD(conversationId: string, messageId: string): Uint8Array {
  return utf8ToBytes(`ynx-chat-v1|${validIdentifier(conversationId)}|${validIdentifier(messageId)}`);
}

function messageEnvelopeAAD(input: { conversationId: string; messageId: string; senderDeviceId: string; recipientAccount: string; recipientDeviceId: string; ephemeralPublicKey: string }): Uint8Array {
  return utf8ToBytes(["ynx-chat-envelope-v2", validIdentifier(input.conversationId), validIdentifier(input.messageId), validIdentifier(input.senderDeviceId), validYNXAddress(input.recipientAccount), validIdentifier(input.recipientDeviceId), CHAT_ALGORITHM, input.ephemeralPublicKey].join("\n"));
}

function chatMessageSignaturePayload(input: { conversationId: string; messageId: string; senderAccount: string; senderDeviceId: string; envelopes: readonly ChatDeviceEnvelope[] }): Uint8Array {
  const envelopes = input.envelopes.map((envelope) => ({
    recipientAccount: validYNXAddress(envelope.recipientAccount),
    recipientDeviceId: validIdentifier(envelope.recipientDeviceId),
    algorithm: envelope.algorithm,
    ephemeralPublicKey: envelope.ephemeralPublicKey,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  })).sort(compareDeviceEnvelope);
  return concatBytes(utf8ToBytes("ynx-chat-message-v2\n"), utf8ToBytes(JSON.stringify({ protocolVersion: 2, conversationId: validIdentifier(input.conversationId), messageId: validIdentifier(input.messageId), sender: validYNXAddress(input.senderAccount), senderDeviceId: validIdentifier(input.senderDeviceId), envelopes })));
}

function compareDeviceEnvelope(left: { recipientAccount: string; recipientDeviceId: string }, right: { recipientAccount: string; recipientDeviceId: string }): number {
  if (left.recipientAccount !== right.recipientAccount) return left.recipientAccount < right.recipientAccount ? -1 : 1;
  if (left.recipientDeviceId === right.recipientDeviceId) return 0;
  return left.recipientDeviceId < right.recipientDeviceId ? -1 : 1;
}

function decodeEncryptionPublicKey(value: string): Uint8Array {
  const decoded = base64RawToBytes(value, "Chat encryption public key");
  if (decoded.length !== 32) throw new Error("Chat encryption public key must encode 32 bytes");
  return decoded;
}

function validDeviceSecret(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error("Device secret must be a 32-byte Ed25519 seed");
  return value;
}

function validIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) throw new Error("Chat identifier is invalid");
  return value;
}

function validYNXAddress(value: string): string {
  const identity = addressIdentity(value);
  if (identity.ynxAddress !== value) throw new Error("Chat account must be a canonical lowercase ynx1 address");
  return identity.ynxAddress;
}
