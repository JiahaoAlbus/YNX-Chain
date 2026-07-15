import { accountIdentity, addressIdentity, deviceIdentifier, deviceIdentity, signOwnershipChallenge, signSquareRequest, squareDeviceRegistration, zeroize } from "../crypto/ynxSigner";
import { chatDeviceRegistration, createChatDeviceRotation, createChatEnvelopeSet, decryptChatDeviceEnvelope, decryptChatMessage, signChatRequest, verifyChatEnvelopeSetSignature } from "../crypto/chatCrypto";
import { authorizeLocalKeyUse, type LocalKeyAuthorizer } from "../security/localAuthorization";
import { parsePaySettlement, type PaySettlement } from "./pay";
import { parseChatConversationResult, parseChatConversations, parseChatDevices, parseChatMessages, type ChatConversation, type ChatDevice, type ChatMessage, type DecryptedChatMessage } from "./chat";

const CLIENT = "ynx-mobile-v1";
const BINDING = "ynx-mobile://com.ynxweb4.mobile";

type Session = { token: string; expiresAt: string };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class YNXMobileAppClient {
  readonly account: string;
  readonly deviceId: string;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly authorize: LocalKeyAuthorizer;
  private accountSecret: Uint8Array;
  private deviceSecret: Uint8Array;
  private session: Session | null = null;
  private registeredSquare = false;
  private registeredChat = false;

  constructor(input: { accountSecret: Uint8Array; deviceSecret: Uint8Array; baseURL?: string; fetchImpl?: FetchLike; now?: () => Date; timeoutMs?: number; authorize?: LocalKeyAuthorizer }) {
    if (input.accountSecret.length !== 32 || input.deviceSecret.length !== 32) throw new Error("YNX mobile client requires two 32-byte secrets");
    this.accountSecret = input.accountSecret.slice();
    this.deviceSecret = input.deviceSecret.slice();
    this.account = accountIdentity(this.accountSecret).account;
    this.deviceId = deviceIdentifier(this.deviceSecret);
    this.baseURL = validBaseURL(input.baseURL ?? "https://api.ynxweb4.com");
    this.fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = input.now ?? (() => new Date());
    this.timeoutMs = input.timeoutMs ?? 8000;
    this.authorize = input.authorize ?? authorizeLocalKeyUse;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 10 || this.timeoutMs > 30000) throw new Error("YNX mobile request timeout must be between 10 and 30000 milliseconds");
  }

  get connected(): boolean {
    if (this.session === null) return false;
    if (new Date(this.session.expiresAt).getTime() > this.now().getTime()) return true;
    this.session = null;
    return false;
  }

  async connect(options: { registerSquare?: boolean; registerChat?: boolean } = {}): Promise<void> {
    await this.authorize("ownership-proof");
    const device = deviceIdentity(this.deviceSecret);
    const challenge = await this.request("/app/session/challenges", {
      account: this.account,
      deviceId: this.deviceId,
      deviceSigningPublicKey: device.deviceSigningPublicKey,
    });
    if (!isPlainObject(challenge) || challenge.account !== this.account || typeof challenge.challengeId !== "string" || typeof challenge.signBytes !== "string" || !isPlainObject(challenge.signDocument) || challenge.signDocument.account !== this.account || challenge.signDocument.deviceId !== this.deviceId || challenge.signDocument.deviceSigningPublicKey !== device.deviceSigningPublicKey || challenge.signDocument.origin !== BINDING || challenge.signDocument.chainId !== 6423) {
      throw new Error("Gateway native ownership challenge binding mismatch");
    }
    const proof = signOwnershipChallenge({ accountSecret: this.accountSecret, deviceSecret: this.deviceSecret, signBytes: challenge.signBytes });
    const session = await this.request(`/app/session/challenges/${encodeURIComponent(challenge.challengeId)}/verify`, proof);
    if (!isPlainObject(session) || session.account !== this.account || session.deviceId !== this.deviceId || typeof session.token !== "string" || session.token.length < 32 || typeof session.expiresAt !== "string" || new Date(session.expiresAt).getTime() <= this.now().getTime()) {
      throw new Error("Gateway native session binding mismatch");
    }
    this.session = { token: session.token, expiresAt: session.expiresAt };
    if (options.registerSquare !== false) try {
      await this.request("/app/square/devices", squareDeviceRegistration({
        account: this.account,
        deviceId: this.deviceId,
        deviceSecret: this.deviceSecret,
        idempotencyKey: registrationKey(this.account, this.deviceId, device.deviceSigningPublicKey),
      }), this.sessionHeaders());
      this.registeredSquare = true;
    } catch (error) {
      this.session = null;
      throw error;
    }
    if (options.registerChat !== false) try {
      const registration = chatDeviceRegistration({
        account: this.account,
        deviceId: this.deviceId,
        deviceSecret: this.deviceSecret,
        idempotencyKey: `chat-${registrationKey(this.account, this.deviceId, device.deviceSigningPublicKey)}`,
      });
      await this.request("/app/chat/devices", registration, this.sessionHeaders());
      this.registeredChat = true;
    } catch (error) {
      this.session = null;
      throw error;
    }
  }

  async listChatConversations(): Promise<ChatConversation[]> {
    return parseChatConversations(await this.signedChatRequest("GET", "/chat/conversations"));
  }

  async createChatConversation(peer: string, idempotencyKey: string): Promise<ChatConversation> {
    if (!this.connected) throw new Error("Native YNX session is disconnected or expired");
    const peerAccount = addressIdentity(peer).ynxAddress;
    if (peerAccount === this.account) throw new Error("Chat recipient must be a different YNX account");
    return parseChatConversationResult(await this.signedChatRequest("POST", "/chat/conversations", { idempotencyKey, members: [this.account, peerAccount] }));
  }

  async listChatDevices(account: string): Promise<ChatDevice[]> {
    const normalized = addressIdentity(account).ynxAddress;
    return parseChatDevices(await this.signedChatRequest("GET", `/chat/accounts/${normalized}/devices`));
  }

  async listChatMessages(conversation: ChatConversation): Promise<DecryptedChatMessage[]> {
    const peer = chatPeer(conversation, this.account);
    const [peerDevices, ownDevices, rawMessages] = await Promise.all([
      this.listChatDevices(peer),
      this.listChatDevices(this.account),
      this.signedChatRequest("GET", `/chat/conversations/${conversation.id}/messages`),
    ]);
    return parseChatMessages(rawMessages).map((message) => this.decryptMessage(message, [...peerDevices, ...ownDevices]));
  }

  async sendChatMessage(conversation: ChatConversation, plaintext: string, messageId: string, entropy: Uint8Array): Promise<void> {
    const peer = chatPeer(conversation, this.account);
    const [peerDevices, ownDevices] = await Promise.all([this.listChatDevices(peer), this.listChatDevices(this.account)]);
    const devices = [...peerDevices, ...ownDevices].filter((device) => device.status === "active");
    if (!devices.some((device) => device.account === peer)) throw new Error("Chat recipient has no active device");
    if (!devices.some((device) => device.account === this.account && device.id === this.deviceId)) throw new Error("Current Chat device is no longer active");
    const envelopeSet = createChatEnvelopeSet({
      deviceSecret: this.deviceSecret,
      senderAccount: this.account,
      senderDeviceId: this.deviceId,
      conversationId: conversation.id,
      messageId,
      plaintext,
      recipients: devices.map((device) => ({ account: device.account, deviceId: device.id, encryptionPublicKey: device.encryptionPublicKey })),
      entropy,
    });
    await this.signedChatRequest("POST", `/chat/conversations/${conversation.id}/messages`, envelopeSet);
  }

  async acknowledgeChatMessage(conversationId: string, messageId: string, state: "delivered" | "read"): Promise<void> {
    await this.signedChatRequest("POST", `/chat/conversations/${conversationId}/messages/${messageId}/${state}`);
  }

  async rotateCurrentChatDevice(newDeviceSecret: Uint8Array, idempotencyKey: string): Promise<string> {
    if (!this.connected) throw new Error("Native YNX session is disconnected or expired");
    await this.authorize("device-rotation");
    const newDeviceId = deviceIdentifier(newDeviceSecret);
    const request = createChatDeviceRotation({ account: this.account, authorizingDeviceId: this.deviceId, replacedDeviceId: this.deviceId, authorizingDeviceSecret: this.deviceSecret, newDeviceSecret, idempotencyKey, newDeviceId });
    const value = await this.signedChatRequest("POST", `/chat/devices/${this.deviceId}/rotate`, request);
    if (!isPlainObject(value) || !isPlainObject(value.record) || value.record.account !== this.account || value.record.authorizingDeviceId !== this.deviceId || value.record.replacedDeviceId !== this.deviceId || value.record.newDeviceId !== newDeviceId || typeof value.record.id !== "string") {
      throw new Error("Chat device rotation response binding mismatch");
    }
    this.registeredChat = false;
    return newDeviceId;
  }

  async settlePayInvoice(invoiceID: string, transactionHash: string, idempotencyKey: string): Promise<PaySettlement> {
    if (!this.connected) throw new Error("Native YNX session is disconnected or expired");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(invoiceID)) throw new Error("Pay invoice ID is invalid");
    if (!/^0x[0-9a-f]{64}$/.test(transactionHash)) throw new Error("Canonical lowercase YNX transaction hash is required");
    if (idempotencyKey.trim().length < 1 || idempotencyKey.length > 128) throw new Error("Pay settlement idempotency key is invalid");
    return parsePaySettlement(await this.request(`/app/pay/invoices/${encodeURIComponent(invoiceID)}/settle`, { transactionHash, idempotencyKey }, this.sessionHeaders()));
  }

  async createPost(content: string, idempotencyKey: string): Promise<unknown> {
    if (!this.connected) throw new Error("Native YNX session is disconnected or expired");
    if (content.trim().length === 0 || content.length > 2000) throw new Error("Post content must contain 1 to 2000 characters");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(idempotencyKey)) throw new Error("Post idempotency key is invalid");
    await this.authorize("signed-post");
    const body = JSON.stringify({ idempotencyKey, content });
    const timestamp = this.now().toISOString();
    return this.request("/app/square/posts", body, {
      ...this.sessionHeaders(),
      "X-YNX-Timestamp": timestamp,
      "X-YNX-Device-Signature": signSquareRequest({ method: "POST", requestUri: "/square/posts", timestamp, body, deviceSecret: this.deviceSecret }),
    }, true);
  }

  async disconnect(revokeDevice = false): Promise<void> {
    if (!this.session) return;
    try {
      if (revokeDevice && this.connected) {
        await this.authorize("device-revocation");
        const failures: unknown[] = [];
        const timestamp = this.now().toISOString();
        if (this.registeredSquare) try {
          await this.request(`/app/square/devices/${encodeURIComponent(this.deviceId)}/revoke`, "", {
            ...this.sessionHeaders(),
            "X-YNX-Timestamp": timestamp,
            "X-YNX-Device-Signature": signSquareRequest({ method: "POST", requestUri: `/square/devices/${this.deviceId}/revoke`, timestamp, body: "", deviceSecret: this.deviceSecret }),
          }, true);
        } catch (error) { failures.push(error); }
        if (this.registeredChat) try { await this.signedChatRequest("POST", `/chat/devices/${this.deviceId}/revoke`); } catch (error) { failures.push(error); }
        if (failures.length > 0) throw failures[0];
      }
    } finally {
      try {
        await this.request("/app/session/revoke", undefined, this.sessionHeaders());
      } finally {
        this.session = null;
      }
    }
  }

  async lockAndRevokeSession(): Promise<void> {
    const headers = this.session ? this.sessionHeaders() : null;
    this.session = null;
    zeroize(this.accountSecret, this.deviceSecret);
    if (headers) await this.request("/app/session/revoke", undefined, headers);
  }

  lock(): void {
    this.session = null;
    zeroize(this.accountSecret, this.deviceSecret);
  }

  private sessionHeaders(): Record<string, string> {
    if (!this.session) throw new Error("Native YNX session is unavailable");
    return { "X-YNX-App-Session": this.session.token, "X-YNX-Device-ID": this.deviceId };
  }

  private async signedChatRequest(method: "GET" | "POST", requestUri: string, value?: unknown): Promise<unknown> {
    if (!this.connected) throw new Error("Native YNX session is disconnected or expired");
    const body = value === undefined ? "" : JSON.stringify(value);
    const timestamp = this.now().toISOString();
    return this.request(`/app${requestUri}`, method === "GET" ? undefined : body, {
      ...this.sessionHeaders(),
      "X-YNX-Timestamp": timestamp,
      "X-YNX-Device-Signature": signChatRequest({ method, requestUri, timestamp, body, deviceSecret: this.deviceSecret }),
    }, true, method);
  }

  private decryptMessage(message: ChatMessage, devices: ChatDevice[]): DecryptedChatMessage {
    if (message.protocolVersion === 2) {
      const senderDevice = devices.find((device) => device.id === message.senderDeviceId && device.account === message.sender);
      const envelope = message.envelopes.find((candidate) => candidate.recipientAccount === this.account && candidate.recipientDeviceId === this.deviceId);
      if (!senderDevice || !envelope || !message.senderSignature) return Object.freeze({ ...message, plaintext: null, decryptionError: "Message is not available for this device" });
      try {
        if (!verifyChatEnvelopeSetSignature({ conversationId: message.conversationId, messageId: message.id, senderAccount: message.sender, senderDeviceId: message.senderDeviceId, envelopes: message.envelopes, senderSignature: message.senderSignature, senderSigningPublicKey: senderDevice.signingPublicKey })) throw new Error("sender signature failed");
        const plaintext = decryptChatDeviceEnvelope({ deviceSecret: this.deviceSecret, conversationId: message.conversationId, messageId: message.id, senderDeviceId: message.senderDeviceId, envelope });
        return Object.freeze({ ...message, plaintext, decryptionError: null });
      } catch {
        return Object.freeze({ ...message, plaintext: null, decryptionError: "Message could not be authenticated on this device" });
      }
    }
    const legacyEnvelope = message.algorithm && message.nonce && message.ciphertext ? { algorithm: message.algorithm, nonce: message.nonce, ciphertext: message.ciphertext } : null;
    const candidates = devices.filter((device) => device.account !== this.account && device.id === message.senderDeviceId);
    if (legacyEnvelope) for (const device of candidates) try {
      const plaintext = decryptChatMessage({ deviceSecret: this.deviceSecret, peerPublicKey: device.encryptionPublicKey, conversationId: message.conversationId, messageId: message.id, envelope: legacyEnvelope });
      return Object.freeze({ ...message, plaintext, decryptionError: null });
    } catch { /* Try another historical sender key if present. */ }
    return Object.freeze({ ...message, plaintext: null, decryptionError: "Message could not be authenticated on this device" });
  }

  private async request(path: string, value?: unknown, headers: Record<string, string> = {}, serialized = false, method: "GET" | "POST" = "POST"): Promise<unknown> {
    const body = value === undefined ? undefined : serialized ? String(value) : JSON.stringify(value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        method,
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-YNX-Client": CLIENT, ...headers },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`YNX application endpoint returned invalid JSON (${response.status})`); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.session = null;
      throw new Error(isPlainObject(data) && typeof data.error === "string" ? data.error : `YNX application endpoint failed (${response.status})`);
    }
    return data;
  }
}

function chatPeer(conversation: ChatConversation, account: string): string {
  if (!conversation.members.includes(account)) throw new Error("Chat conversation does not include the local YNX account");
  const peer = conversation.members.find((member) => member !== account);
  if (!peer) throw new Error("Chat conversation has no peer account");
  return peer;
}

function registrationKey(account: string, deviceId: string, publicKey: string): string {
  let hash = 2166136261;
  for (const character of `${account}\n${deviceId}\n${publicKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `register-${hash.toString(16).padStart(8, "0")}-${deviceId.slice(-12)}`;
}

function validBaseURL(value: string): string {
  const normalized = value.replace(/\/$/, "");
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(normalized) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(normalized)) throw new Error("YNX application URL must be exact HTTPS or loopback HTTP");
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
