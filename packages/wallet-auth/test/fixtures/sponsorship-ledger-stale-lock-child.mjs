import { randomUUID } from "node:crypto";
import { openSync, closeSync, constants, fsyncSync, writeFileSync } from "node:fs";

const [, , statePath, readyPath] = process.argv;
const lockPath = `${statePath}.lock`;
const descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
writeFileSync(descriptor, `${JSON.stringify({ acquiredAt: new Date().toISOString(), pid: process.pid, schemaVersion: 1, token: randomUUID() })}\n`);
fsyncSync(descriptor);
closeSync(descriptor);
writeFileSync(readyPath, "", { mode: 0o600 });
setInterval(() => {}, 60_000);
