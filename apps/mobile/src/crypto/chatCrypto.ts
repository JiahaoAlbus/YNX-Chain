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
