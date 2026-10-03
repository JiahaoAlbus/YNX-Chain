// This is the credential-free product consumer, not a Wallet->Matrix token
// conversion. A supplies the original, verified identity and native enrollment.
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
};
export type MatrixNativeEvent = {
  generation: number; roomId?: string; type: string; events?: MatrixEvent[];
  transactionId?: string; eventId?: string; revision?: number; values?: string[];
};
export interface NativeMatrixBridge {
  restore(binding: MatrixBinding): Promise<{ generation: number }>;
  invalidate(): void;
  suspend(): Promise<void>;
  rooms(generation: number): Promise<MatrixRoom[]>;
  directRoom(generation: number, peerUserId: string): Promise<MatrixRoom>;
  observeRoom(generation: number, roomId: string): Promise<void>;
  closeRoom(generation: number): Promise<void>;
  stageFile(generation: number, sourceUri: string): Promise<{ uri: string }>;
  sendText(generation: number, roomId: string, intentId: string, body: string): Promise<{ queued: true }>;
  sendFile(generation: number, roomId: string, intentId: string, uri: string, mime: string, caption: string): Promise<{ queued: true }>;
  readEvent(generation: number, roomId: string, eventId: string): Promise<MatrixEvent>;
  requestVerification(generation: number, peerUserId: string): Promise<void>;
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
  private pending = new Map<string, { body: string; roomId: string; status: 'unknown' | 'queued' }>();

  constructor(private readonly bridge: NativeMatrixBridge,
    private readonly current: () => Promise<MatrixBinding>,
    private readonly acceptedPeer: (personId: string) => Promise<MatrixPeer>) {}

  async restore(): Promise<void> {
    this.lock();
    const epoch = this.epoch;
    const binding = checkedMatrixBinding(await this.current());
    if (epoch !== this.epoch) throw new Error('MATRIX_STALE_AUTHORITY');
    const result = await this.bridge.restore(binding);
    const latest = checkedMatrixBinding(await this.current());
    if (epoch !== this.epoch || !sameIdentity(binding, latest)) {
      this.bridge.invalidate();
      void this.bridge.suspend();
      throw new Error('MATRIX_STALE_AUTHORITY');
    }
    this.binding = binding;
    this.generation = result.generation;
    this.subscription = this.bridge.addListener('onMatrixEvent', (event) => {
      if (event.generation !== this.generation) return;
      void this.deliver(event, epoch);
    });
  }

  private async deliver(event: MatrixNativeEvent, epoch: number) {
    try {
      await this.authority();
      if (event.roomId) await this.reviewRoom();
      if (epoch !== this.epoch || event.generation !== this.generation
        || (event.roomId && event.roomId !== this.room?.value.roomId)) return;
      for (const listener of this.listeners) listener(event);
    } catch { this.lock(); }
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
    const latest = checkedMatrixBinding(await this.current());
    if (epoch !== this.epoch || !sameIdentity(binding, latest)) throw new Error('MATRIX_STALE_AUTHORITY');
    return { binding, generation, epoch };
  }

  private async peer(personId: string, authorityId: string) {
    if (!/^sp_[a-f0-9]{32}$/.test(personId)) throw new Error('MATRIX_ORIGINAL_PERSON_REQUIRED');
    const peer = await this.acceptedPeer(personId);
    if (peer.personId !== personId || !peer.accepted || peer.blocked || peer.authorityId !== authorityId
      || !/^@[^\s:]+:[^\s]+$/.test(peer.userId)) throw new Error('MATRIX_ACCEPTED_PEER_REQUIRED');
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
    return room;
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
    this.pending.set(intentId, { body, roomId: room.roomId, status: 'unknown' });
    await this.bridge.sendText(generation, room.roomId, intentId, body);
    await this.reviewRoom();
    const intent = this.pending.get(intentId);
    if (intent) intent.status = 'queued';
    return { queued: true as const, delivered: false as const };
  }

  async file(intentId: string, uri: string, mime: string, caption: string) {
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
    const { generation, epoch } = await this.authority();
    await this.bridge.verificationAction(generation, action, revision);
    await this.authority();
    if (epoch !== this.epoch) throw new Error('MATRIX_STALE_AUTHORITY');
  }

  async requestVerification(personId: string) {
    const { binding, generation } = await this.authority();
    const peer = await this.peer(personId, binding.authorityId);
    await this.authority();
    await this.bridge.requestVerification(generation, peer.userId);
    await this.authority();
  }

  async logout() {
    const { generation } = await this.authority();
    try { await this.bridge.logout(generation); } finally { this.lock(); }
  }
}
