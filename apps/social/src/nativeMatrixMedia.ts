/** Native lease DTOs contain no ciphertext key/IV/hash, bearer or original store.
 * This controller is not a replacement Matrix downloader or a delivery receipt.
 */
export type MatrixMediaLease = Readonly<{
  leaseId: string; roomId: string; eventId: string; filename: string;
  mimeType: string; bytes: number; uri: string; imagePreview: boolean;
}>;

export type MatrixMediaPort = Readonly<{
  open(roomId: string, eventId: string): Promise<MatrixMediaLease>;
  release(leaseId: string): Promise<void>;
}>;

export class MatrixMediaPreview {
  private epoch = 0;
  private visible?: MatrixMediaLease;
  constructor(private readonly port: MatrixMediaPort,
    private readonly currentAndAccepted: (roomId: string) => Promise<void>,
    private readonly maximumBytes = 32 * 1024 * 1024) {}

  async open(roomId: string, eventId: string): Promise<MatrixMediaLease> {
    const attempt = ++this.epoch;
    const previous = this.visible; this.visible = undefined;
    if (previous) await this.port.release(previous.leaseId);
    await this.currentAndAccepted(roomId);
    if (attempt !== this.epoch) throw new Error('MATRIX_MEDIA_RETIRED');
    const lease = await this.port.open(roomId, eventId);
    let retained = false;
    try {
      await this.currentAndAccepted(roomId);
      if (attempt !== this.epoch) throw new Error('MATRIX_MEDIA_RETIRED');
      if (!lease || !/^[0-9a-f-]{36}$/i.test(lease.leaseId) || lease.roomId !== roomId || lease.eventId !== eventId ||
        !roomId.startsWith('!') || !eventId.startsWith('$') || typeof lease.filename !== 'string' || lease.filename.includes('\0') ||
        !Number.isSafeInteger(lease.bytes) || lease.bytes <= 0 || lease.bytes > this.maximumBytes ||
        !/^file:\/\/\//.test(lease.uri) || /[\0\r\n]/.test(lease.uri) ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(lease.mimeType) ||
        lease.imagePreview !== ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(lease.mimeType)) {
        throw new Error('MATRIX_MEDIA_LEASE_INVALID');
      }
      this.visible = Object.freeze({ ...lease }); retained = true;
      return this.visible;
    } finally {
      if (!retained && lease?.leaseId) await this.port.release(lease.leaseId);
    }
  }

  snapshot(): MatrixMediaLease | undefined { return this.visible; }

  async close(): Promise<void> {
    ++this.epoch;
    const original = this.visible; this.visible = undefined;
    if (original) await this.port.release(original.leaseId);
  }
}
