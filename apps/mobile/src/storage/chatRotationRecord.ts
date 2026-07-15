const VERSION = 1;

export type PendingChatRotation = Readonly<{
  account: string;
  authorizingDeviceId: string;
  newDeviceSecret: Uint8Array;
  idempotencyKey: string;
}>;

export function encodePendingChatRotation(value: PendingChatRotation): string {
  validate(value);
  return JSON.stringify({
    version: VERSION,
    account: value.account,
    authorizingDeviceId: value.authorizingDeviceId,
    newDeviceSecret: hex(value.newDeviceSecret),
    idempotencyKey: value.idempotencyKey,
  });
}

export function decodePendingChatRotation(serialized: string): PendingChatRotation {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error("Pending Chat rotation record is unreadable"); }
  if (!plain(value) || Object.keys(value).sort().join(",") !== "account,authorizingDeviceId,idempotencyKey,newDeviceSecret,version" || value.version !== VERSION || typeof value.account !== "string" || typeof value.authorizingDeviceId !== "string" || typeof value.newDeviceSecret !== "string" || typeof value.idempotencyKey !== "string") {
    throw new Error("Pending Chat rotation record is malformed");
  }
  const record = Object.freeze({ account: value.account, authorizingDeviceId: value.authorizingDeviceId, newDeviceSecret: unhex(value.newDeviceSecret), idempotencyKey: value.idempotencyKey });
  validate(record);
  return record;
}

function validate(value: PendingChatRotation): void {
  if (!/^ynx1[0-9a-z]{38}$/.test(value.account)) throw new Error("Pending Chat rotation account is invalid");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value.authorizingDeviceId)) throw new Error("Pending Chat rotation authorizer is invalid");
  if (!(value.newDeviceSecret instanceof Uint8Array) || value.newDeviceSecret.length !== 32) throw new Error("Pending Chat rotation secret is invalid");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(value.idempotencyKey)) throw new Error("Pending Chat rotation idempotency key is invalid");
}

function hex(value: Uint8Array): string { return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function unhex(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Pending Chat rotation secret is invalid");
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}
function plain(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
