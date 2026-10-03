// This is the credential-free product consumer, not a Wallet->Matrix token
// conversion. A supplies the original, verified identity and native enrollment.
import { checkedOriginals, checkedOriginalObservation, type MatrixPendingIntent } from './nativeMatrixRecovery';
export type MatrixBinding = Readonly<{
  account: string; homeserverUrl: string; userId: string; deviceId: string;
  authorityId: string; expiresAtMs: number;
}>;
export type MatrixPeer = Readonly<{
  personId: string; userId: string; accepted: boolean; blocked: boolean; authorityId: string;
}>;
export type MatrixRoom = {
  roomId: string; name: string; encrypted: boolean; joined: boolean; members: string[];
};
export type MatrixEvent = {
  eventId: string | null; transactionId: string | null; sender: string;
  own: boolean; remote: boolean; kind: string; body: string | null;
  intentId?: string | null;
};
export type MatrixNativeEvent = {
  generation: number; roomId?: string; type: string; events?: MatrixEvent[];
  transactionId?: string; eventId?: string; revision?: number; values?: string[];
  peerUserId?: string;
  verificationAttempt?: number;
};
export interface NativeMatrixBridge {
  restore(binding: MatrixBinding): Promise<{ generation: number }>;
  invalidate(): void;
  suspend(): Promise<void>;
  rooms(generation: number): Promise<MatrixRoom[]>;
  directRoom(generation: number, peerUserId: string): Promise<MatrixRoom>;
  observeRoom(generation: number, roomId: string): Promise<void>;
  closeRoom(generation: number): Promise<void>;
  pendingIntents(generation: number, roomId: string): Promise<MatrixPendingIntent[]>;
  stageFile(generation: number, sourceUri: string): Promise<{ uri: string }>;
  sendText(generation: number, roomId: string, intentId: string, body: string): Promise<{ queued: true }>;
  sendFile(generation: number, roomId: string, intentId: string, uri: string, mime: string, caption: string): Promise<{ queued: true }>;
  readEvent(generation: number, roomId: string, eventId: string): Promise<MatrixEvent>;
  requestVerification(generation: number, peerUserId: string): Promise<{ attempt: number }>;
  verificationAction(generation: number, action: 'accept' | 'start' | 'approve' | 'reject' | 'cancel', revision: number): Promise<void>;
  logout(generation: number): Promise<void>;
  addListener(event: 'onMatrixEvent', listener: (event: MatrixNativeEvent) => void): { remove(): void };
}

export function checkedMatrixBinding(value: MatrixBinding, now = Date.now()): MatrixBinding {
  if (!/^ynx1[a-z0-9]+$/.test(value.account) || !/^@[^\s:]+:[^\s]+$/.test(value.userId)
    || !value.deviceId || value.deviceId.length > 128 || !value.authorityId
    || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= now) throw new Error('MATRIX_CURRENT_AUTHORITY_REQUIRED');
  const url = new URL(value.homeserverUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || url.origin !== value.homeserverUrl.replace(/\/$/, '')) throw new Error('MATRIX_VERIFIED_HTTPS_HS_REQUIRED');
  return Object.freeze({ ...value });
}

const sameIdentity = (a: MatrixBinding, b: MatrixBinding) => a.account === b.account
  && a.homeserverUrl === b.homeserverUrl && a.userId === b.userId
  && a.deviceId === b.deviceId && a.authorityId === b.authorityId;

// No bearer token, refresh token, DB key, callback or crypto object crosses this
// interface. A-owned canonical authority is re-read around every native await.
export class NativeMatrixConsumer {
  private binding?: MatrixBinding;
  private generation?: number;
  private epoch = 0;
  private room?: { value: MatrixRoom; personId: string };
  private listeners = new Set<(event: MatrixNativeEvent) => void>();
  private subscription?: { remove(): void };
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private expiryDeadline = 0;
  private verificationPeer?: { personId: string; userId: string; attempt?: number };
  private verificationRevision?: number;
  private pending = new Map<string, { body: string; roomId: string; status: 'unknown' | 'queued' }>();

  constructor(private readonly bridge: NativeMatrixBridge,
    private readonly current: () => Promise<MatrixBinding>,
    private readonly acceptedPeer: (personId: string) => Promise<MatrixPeer>) {}

  async restore(): Promise<void> {
    this.lock();
    const epoch = this.epoch;
    try {
    const binding = checkedMatrixBinding(await this.current());
    if (epoch !== this.epoch) throw new Error('MATRIX_STALE_AUTHORITY');
    const result = await this.bridge.restore(binding);
    const latest = checkedMatrixBinding(await this.current());
    if (epoch !== this.epoch || !sameIdentity(binding, latest)) {
      throw new Error('MATRIX_STALE_AUTHORITY');
    }
    this.binding = binding;
    this.generation = result.generation;
    this.scheduleExpiry(Math.min(binding.expiresAtMs, latest.expiresAtMs));
    this.subscription = this.bridge.addListener('onMatrixEvent', (event) => {
      if (event.generation !== this.generation) return;
      void this.deliver(event, epoch);
    });
    } catch (error) {
      if (epoch === this.epoch) this.lock(); // Never invalidate a newer restore.
      throw error;
    }
  }

  private scheduleExpiry(deadline: number) {
    if (this.expiryDeadline && this.expiryDeadline <= deadline) return;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryDeadline = deadline;
    const epoch = this.epoch;
    const tick = () => {
      if (epoch !== this.epoch) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) { this.lock(); return; }
      this.expiryTimer = setTimeout(tick, Math.min(remaining, 0x7fffffff));
      if (typeof this.expiryTimer === 'object' && typeof this.expiryTimer.unref === 'function') this.expiryTimer.unref();
    };
    tick();
  }

  private async deliver(event: MatrixNativeEvent, epoch: number) {
    try {
      await this.authority();
      if (event.type === 'sas' || event.type.startsWith('verification-')) {
        const target = this.verificationPeer;
        if (!target || event.peerUserId !== target.userId) throw new Error('MATRIX_VERIFICATION_PEER_MISMATCH');
        if (typeof event.verificationAttempt !== 'number' || !Number.isSafeInteger(event.verificationAttempt)
          || event.verificationAttempt <= 0) throw new Error('MATRIX_VERIFICATION_FLOW_REQUIRED');
        if (target.attempt !== undefined && target.attempt !== event.verificationAttempt) return;
        target.attempt = event.verificationAttempt;
        const auth = await this.authority();
        const peer = await this.peer(target.personId, auth.binding.authorityId);
        if (peer.userId !== target.userId || this.verificationPeer !== target) throw new Error('MATRIX_STALE_PEER');
        if (event.type === 'verification-request') this.verificationRevision = undefined;
        if (event.type === 'sas') {
          if (typeof event.revision !== 'number' || !Number.isSafeInteger(event.revision) || event.revision <= 0
            || !event.values || ![3, 7].includes(event.values.length)
            || event.values.some(value => typeof value !== 'string' || !value || value.length > 128)) throw new Error('MATRIX_CURRENT_SAS_REQUIRED');
          this.verificationRevision = event.revision;
        }
      }
      if (event.roomId) await this.reviewRoom();
      if (epoch !== this.epoch || event.generation !== this.generation
        || (event.roomId && event.roomId !== this.room?.value.roomId)) return;
      for (const listener of this.listeners) listener(event);
      if (['verification-finished', 'verification-cancelled', 'verification-failed'].includes(event.type)) {
        this.verificationPeer = undefined; this.verificationRevision = undefined;
      }
    } catch { if (epoch === this.epoch) this.lock(); }
  }

  listen(listener: (event: MatrixNativeEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  lock() {
    this.epoch++;
    this.subscription?.remove();
    this.subscription = undefined;
    this.binding = undefined;
    this.generation = undefined;
    this.room = undefined;
    this.verificationPeer = undefined;
    this.verificationRevision = undefined;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined; this.expiryDeadline = 0;
    this.pending.clear(); // Native journal remains authoritative, never deleted.
    this.bridge.invalidate();
    void this.bridge.suspend().catch(() => {});
    for (const listener of this.listeners) listener({ generation: -1, type: 'locked' });
  }

  private async authority() {
    const binding = this.binding;
    const generation = this.generation;
    const epoch = this.epoch;
    if (!binding || generation === undefined) throw new Error('MATRIX_NATIVE_SESSION_REQUIRED');
    try {
      const latest = checkedMatrixBinding(await this.current());
      if (epoch !== this.epoch || !sameIdentity(binding, latest)) throw new Error('MATRIX_STALE_AUTHORITY');
      this.scheduleExpiry(Math.min(binding.expiresAtMs, latest.expiresAtMs));
    } catch (error) { if (epoch === this.epoch) this.lock(); throw error; }
    return { binding, generation, epoch };
  }

  private async peer(personId: string, authorityId: string) {
    if (!/^sp_[a-f0-9]{32}$/.test(personId)) throw new Error('MATRIX_ORIGINAL_PERSON_REQUIRED');
    const epoch = this.epoch;
    let peer: MatrixPeer;
    try { peer = await this.acceptedPeer(personId); }
    catch (error) { if (epoch === this.epoch) this.lock(); throw error; }
    if (peer.personId !== personId || !peer.accepted || peer.blocked || peer.authorityId !== authorityId
      || !/^@[^\s:]+:[^\s]+$/.test(peer.userId)) {
      if (epoch === this.epoch) this.lock();
      throw new Error('MATRIX_ACCEPTED_PEER_REQUIRED');
    }
    return peer;
  }

  private validRoom(room: MatrixRoom, self: string, peer: string) {
    const members = [...new Set(room.members)];
    if (!room.encrypted || !room.joined || !members.includes(self)
      || members.some(id => id !== self && id !== peer)) throw new Error('MATRIX_PRIVATE_ROOM_POLICY_MISMATCH');
  }

  async rooms() {
    const { generation, epoch } = await this.authority();
    const rooms = await this.bridge.rooms(generation);
    await this.authority();
    if (epoch !== this.epoch) throw new Error('MATRIX_STALE_AUTHORITY');
    return rooms;
  }

  async open(personId: string) {
    const { binding, generation, epoch } = await this.authority();
    const peer = await this.peer(personId, binding.authorityId);
    await this.authority();
    const room = await this.bridge.directRoom(generation, peer.userId);
    const next = await this.peer(personId, binding.authorityId);
    await this.authority();
    if (epoch !== this.epoch || peer.userId !== next.userId) throw new Error('MATRIX_STALE_PEER');
    this.validRoom(room, binding.userId, peer.userId);
    this.room = { value: room, personId };
    await this.bridge.observeRoom(generation, room.roomId);
    await this.reviewRoom();
    await this.originals();
    return room;
  }

  async originals(): Promise<readonly MatrixPendingIntent[]> {
    const { room, generation } = await this.reviewRoom();
    const entries = await this.bridge.pendingIntents(generation, room.roomId);
    await this.reviewRoom();
    const originals = checkedOriginals(entries, room.roomId);
    for (const entry of originals) if (entry.kind === 'text' && entry.body !== null) {
      const previous = this.pending.get(entry.intentId);
      if (previous && (previous.body !== entry.body || previous.roomId !== entry.roomId)) {
        this.lock(); throw new Error('MATRIX_INTENT_COLLISION');
      }
      this.pending.set(entry.intentId, { body: entry.body, roomId: entry.roomId, status: entry.state === 'unknown' ? 'unknown' : 'queued' });
    }
    return originals;
  }

  async inspectOriginal(intentId: string) {
    const original = (await this.originals()).find(entry => entry.intentId === intentId);
    if (!original?.eventId) throw new Error('MATRIX_ORIGINAL_EVENT_NOT_OBSERVED');
    const { binding } = await this.reviewRoom();
    const event = await this.readback(original.eventId);
    await this.reviewRoom();
    return checkedOriginalObservation(original, event, binding.userId);
  }

  private async reviewRoom() {
    const currentRoom = this.room;
    if (!currentRoom) throw new Error('MATRIX_REVIEWED_ROOM_REQUIRED');
    const auth = await this.authority();
    const peer = await this.peer(currentRoom.personId, auth.binding.authorityId);
    const rooms = await this.bridge.rooms(auth.generation);
    const room = rooms.find(r => r.roomId === currentRoom.value.roomId);
    await this.authority();
    if (!room || this.room !== currentRoom || auth.epoch !== this.epoch) throw new Error('MATRIX_STALE_ROOM');
    this.validRoom(room, auth.binding.userId, peer.userId);
    return { ...auth, room };
  }

  async send(intentId: string, body: string) {
    if (!/^native-matrix-[a-f0-9]{32}$/.test(intentId) || !body.trim() || body.length > 16000) throw new Error('MATRIX_REVIEWED_SEND_REQUIRED');
    const { room, generation } = await this.reviewRoom();
    const original = this.pending.get(intentId);
    if (original) {
      if (original.body !== body || original.roomId !== room.roomId) throw new Error('MATRIX_INTENT_COLLISION');
      throw new Error('MATRIX_ORIGINAL_SEND_NEEDS_RECONCILIATION');
    }
    if ((await this.originals()).length) throw new Error('MATRIX_ORIGINAL_SEND_NEEDS_RECONCILIATION');
    this.pending.set(intentId, { body, roomId: room.roomId, status: 'unknown' });
    await this.bridge.sendText(generation, room.roomId, intentId, body);
    await this.reviewRoom();
    const intent = this.pending.get(intentId);
    if (intent) intent.status = 'queued';
    return { queued: true as const, delivered: false as const };
  }

  async file(intentId: string, uri: string, mime: string, caption: string) {
    if (!/^native-matrix-[a-f0-9]{32}$/.test(intentId) || !uri.startsWith('file://') || !mime || mime.length > 128
      || caption.length > 16000) throw new Error('MATRIX_REVIEWED_SEND_REQUIRED');
    if ((await this.originals()).length) throw new Error('MATRIX_ORIGINAL_SEND_NEEDS_RECONCILIATION');
    const { room, generation } = await this.reviewRoom();
    await this.bridge.sendFile(generation, room.roomId, intentId, uri, mime, caption);
    await this.reviewRoom();
    return { queued: true as const, delivered: false as const };
  }

  async stageFile(sourceUri: string) {
    const { generation } = await this.reviewRoom();
    const result = await this.bridge.stageFile(generation, sourceUri);
    await this.reviewRoom();
    return result.uri;
  }

  async readback(eventId: string) {
    const { room, generation } = await this.reviewRoom();
    const event = await this.bridge.readEvent(generation, room.roomId, eventId);
    await this.reviewRoom();
    if (event.eventId !== eventId || !event.remote) throw new Error('MATRIX_AUTHENTICATED_EVENT_READBACK_REQUIRED');
    return event;
  }

  async verification(action: 'accept' | 'start' | 'approve' | 'reject' | 'cancel', revision: number) {
    const target = this.verificationPeer;
    if (!target) throw new Error('MATRIX_VERIFICATION_FLOW_REQUIRED');
    const { generation, epoch, binding } = await this.authority();
    const peer = await this.peer(target.personId, binding.authorityId);
    if (peer.userId !== target.userId || this.verificationPeer !== target) throw new Error('MATRIX_STALE_PEER');
    if (action === 'approve' && (this.verificationRevision === undefined || revision !== this.verificationRevision)) throw new Error('MATRIX_CURRENT_SAS_REQUIRED');
    if (['approve', 'reject', 'cancel'].includes(action)) this.verificationRevision = undefined;
    await this.authority();
    await this.bridge.verificationAction(generation, action, revision);
    const latest = await this.peer(target.personId, binding.authorityId);
    if (latest.userId !== target.userId) throw new Error('MATRIX_STALE_PEER');
    await this.authority();
    if (epoch !== this.epoch) throw new Error('MATRIX_STALE_AUTHORITY');
  }

  async requestVerification(personId: string) {
    if (this.verificationPeer) throw new Error('MATRIX_VERIFICATION_FLOW_ALREADY_ACTIVE');
    const { binding, generation, epoch } = await this.authority();
    const peer = await this.peer(personId, binding.authorityId);
    await this.authority();
    const target = { personId, userId: peer.userId, attempt: undefined as number | undefined };
    this.verificationPeer = target;
    this.verificationRevision = undefined;
    try {
      const result = await this.bridge.requestVerification(generation, peer.userId);
      if (epoch !== this.epoch || this.verificationPeer !== target) throw new Error('MATRIX_STALE_AUTHORITY');
      if (!Number.isSafeInteger(result.attempt) || result.attempt <= 0
        || (target.attempt !== undefined && target.attempt !== result.attempt)) throw new Error('MATRIX_VERIFICATION_FLOW_REQUIRED');
      target.attempt = result.attempt;
    } catch (error) { if (this.verificationPeer === target) this.verificationPeer = undefined; throw error; }
    await this.authority();
  }

  async logout() {
    const { generation } = await this.authority();
    try { await this.bridge.logout(generation); } finally { this.lock(); }
  }
}
