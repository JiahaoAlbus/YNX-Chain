#!/usr/bin/env node
import { lstatSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalJSON } from "../src/canonical.js";
import { gatewayStateDigest } from "../src/gateway-http.js";
import { StrategyMandateStore } from "../src/mandate-lifecycle.js";

const [sourceArg, destinationArg, cutoffArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg || !cutoffArg) fail("usage: migrate-session-account-public-key.mjs SOURCE DESTINATION CUTOFF_ISO");
const source = resolve(sourceArg), destination = resolve(destinationArg), cutoff = strictTime(cutoffArg);
if (source === destination) fail("source and destination must differ");
const stat = lstatSync(source);
if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) fail("source must be one private regular file");
const envelope = JSON.parse(readFileSync(source, "utf8"));
if ((envelope?.schemaVersion !== 1 && envelope?.schemaVersion !== 2) || typeof envelope.stateDigest !== "string" || !envelope.snapshot || (envelope.schemaVersion === 2 && !/^[0-9a-f]{64}$/.test(envelope.registrySha256))) fail("unsupported Gateway state envelope");
if (gatewayStateDigest(envelope.snapshot) !== envelope.stateDigest) fail("source Gateway state digest is invalid");
const sessionStore = envelope.snapshot.sessionStore, sessions = sessionStore?.sessions;
if (!Array.isArray(sessions)) fail("source session store is invalid");
const expiries = sessions.map(item => strictTime(item?.expiresAt));
if (expiries.some(value => value > cutoff)) fail("an existing Product Session is not expired at the migration cutoff");
const migratedSnapshot = {
  ...envelope.snapshot,
  sessionStore: {
    ...sessionStore,
    consumedNonces: [],
    consumedRequestDigests: [],
    consumedChallenges: [],
    sessions: [],
  },
  consumedProductProofs: [],
  mandateStore: new StrategyMandateStore().snapshot(),
};
const migrated = { ...(envelope.schemaVersion === 2 ? { registrySha256: envelope.registrySha256 } : {}), schemaVersion: envelope.schemaVersion, stateDigest: gatewayStateDigest(migratedSnapshot), snapshot: migratedSnapshot };
const temporary = `${destination}.${process.pid}.tmp`;
const fd = openSync(temporary, "wx", 0o600);closeSync(fd);
try { writeFileSync(temporary, canonicalJSON(migrated), { mode: 0o600 });renameSync(temporary, destination); }
catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
process.stdout.write(`${canonicalJSON({cutoff,expiredSessionsInvalidated:sessions.length,maxExpiredAt:expiries.sort().at(-1)??null,oldStateDigest:envelope.stateDigest,newStateDigest:migrated.stateDigest,sessionCount:0,proofCount:0,mandateCount:0,destinationDirectory:dirname(destination).split("/").at(-1)})}\n`);

function strictTime(value){if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)||new Date(value).toISOString()!==value)fail("invalid cutoff or session expiry");return value}
function fail(message){process.stderr.write(`${message}\n`);process.exit(2)}
