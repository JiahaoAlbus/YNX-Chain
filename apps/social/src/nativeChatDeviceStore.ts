import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { parseStoredChatDevice, type StoredChatDevice } from './scopedSessionBridge';

export interface ProtectedChatDeviceStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const currentKey = 'ynx.social.device.v1';
const sessionKey = 'ynx.social.session.v1';
export const chatDeviceAccountStorageKey = (account: string) =>
  `ynx.social.device.account.${bytesToHex(sha256(utf8ToBytes(account)))}`;

// Original protected-store keys and device format, not another identity store.
// Serialize this app's switches; do not treat it as cross-process storage CAS
// or as an authoritative account/Wallet permission decision.
export function createNativeChatDeviceStore(
  storage: ProtectedChatDeviceStorage,
  create: (account: string) => StoredChatDevice,
) {
  let pending: Promise<void> = Promise.resolve();

  const confirmWrite = async (key: string, value: string) => {
    await storage.set(key, value);
    if (await storage.get(key) !== value) {
      throw new Error('Protected Social device storage readback failed; existing keys were preserved');
    }
  };

  const select = async (account: string): Promise<StoredChatDevice> => {
    if (!account || account.length > 256) throw new Error('Social device account is invalid');
    const initial = await storage.get(currentKey);
    const sessionRaw = await storage.get(sessionKey);
    const previousAccount = sessionRaw
      ? (JSON.parse(sessionRaw) as { session?: { account?: string } }).session?.account
      : undefined;
    if (initial !== null) {
      const current = parseStoredChatDevice(initial);
      const owner = current.account ?? previousAccount;
      if (!owner || typeof owner !== 'string') {
        throw new Error('Existing Social device ownership requires recovery; keys were preserved');
      }
      const retained: StoredChatDevice = { ...current, account: owner };
      const archivedKey = chatDeviceAccountStorageKey(owner);
      const archive = await storage.get(archivedKey);
      if (archive !== null && JSON.stringify(parseStoredChatDevice(archive)) !== JSON.stringify(retained)) {
        throw new Error('Existing Social device archive conflicts; both device records were preserved');
      }
      if (archive === null) await confirmWrite(archivedKey, JSON.stringify(retained));
      if (await storage.get(currentKey) !== initial) {
        throw new Error('Active Social device changed during retention; retry from the current account');
      }
      if (owner === account) return retained;
    }

    const targetKey = chatDeviceAccountStorageKey(account);
    let targetRaw = await storage.get(targetKey);
    let device: StoredChatDevice;
    if (targetRaw !== null) {
      device = parseStoredChatDevice(targetRaw);
      if (device.account !== account) throw new Error('Archived Social device account mismatch');
    } else {
      device = create(account);
      if (device.account !== account) throw new Error('New Social device account mismatch');
      targetRaw = JSON.stringify(device);
      // Validate the unchanged device schema before touching protected storage.
      parseStoredChatDevice(targetRaw);
      if (await storage.get(targetKey) !== null) {
        throw new Error('Social device archive changed during creation; keys were preserved');
      }
      await confirmWrite(targetKey, targetRaw);
    }
    if (await storage.get(currentKey) !== initial) {
      throw new Error('Active Social device changed during selection; existing records were preserved');
    }
    await confirmWrite(currentKey, JSON.stringify(device));
    return device;
  };

  return {
    select(account: string): Promise<StoredChatDevice> {
      const operation = pending.then(() => select(account));
      // A failed operation does not poison later explicit recovery attempts.
      pending = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
