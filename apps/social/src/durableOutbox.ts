import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { readOutbox, type PendingMessage } from "./messageOutbox";

type Storage = { read(slot: string): string | null; write(slot: string, value: string): void; remove(slot: string): void };
type Snapshot = { version: 1; generation: number; payload: string; checksum: string };
const slots = ["a", "b"] as const;
function checksum(generation: number, payload: string) {
  return bytesToHex(sha256(utf8ToBytes(`ynx-social-outbox-v2\n${generation}\n${payload}`)));
}
function parse(raw: string | null): Snapshot | null {
  if (raw === null || raw.length > 8 * 1024 * 1024) return null;
  try {
    const value = JSON.parse(raw) as Snapshot;
    if (value.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1 ||
      typeof value.payload !== "string" || value.checksum !== checksum(value.generation, value.payload)) return null;
    readOutbox(value.payload);
    return value;
  } catch { return null; }
}

/** Two alternating complete snapshots tolerate a torn replacement write.
 * Checksums detect corruption, not malicious edits; no disk fsync guarantee is implied.
 */
export class DurableOutbox {
  constructor(private readonly storage: Storage) {}
  private current() {
    const raw = slots.map((slot) => this.storage.read(slot));
    const valid = raw.map((value, index) => ({ value: parse(value), slot: slots[index]! }))
      .filter((item): item is { value: Snapshot; slot: "a" | "b" } => item.value !== null)
      .sort((left, right) => right.value.generation - left.value.generation);
    if (valid.length === 0 && raw.some((value) => value !== null)) {
      throw new Error("Pending message snapshots are damaged. Existing files were preserved.");
    }
    return valid[0] ?? null;
  }
  read(): PendingMessage[] {
    const current = this.current();
    return readOutbox(current ? current.value.payload : this.storage.read("legacy"));
  }
  update(change: (entries: PendingMessage[]) => PendingMessage[]): PendingMessage[] {
    const current = this.current();
    const entries = readOutbox(current ? current.value.payload : this.storage.read("legacy"));
    const next = change(entries), payload = JSON.stringify(next);
    readOutbox(payload);
    const generation = (current?.value.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) throw new Error("Pending message generation limit reached");
    const slot = current?.slot === "a" ? "b" : "a";
    this.storage.write(slot, JSON.stringify({ version: 1, generation, payload, checksum: checksum(generation, payload) }));
    return next;
  }
  clear() {
    // Commit an empty state to both slots before removing the legacy carrier.
    // Interrupted cleanup must not resurrect acknowledged messages.
    this.update(() => []);
    this.update(() => []);
    this.storage.remove("legacy");
  }
}
