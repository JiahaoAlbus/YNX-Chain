import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const DISPATCH = 'P05_PROTECTED_DISPATCH_EVENT_V1';
const CONSUMER = 'P05_PROTECTED_ACCEPTANCE_EVENT_V1';
const BINDING_KEYS = ['consumer', 'mode', 'runID', 'epoch', 'providerGeneration', 'rootPID', 'rootAuditTokenSHA256',
  'executableSHA256', 'manifestSHA256', 'bootstrapSHA256'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = data => createHash('sha256').update(data).digest('hex');
const sameBinding = (row, expected) => row && BINDING_KEYS.every(key =>
  row[key] === (key === 'rootPID' ? String(expected.rootPID) : expected[key]));
function monotonic(record) {
  const time = record?.atMonotonicNanoseconds;
  if (typeof time !== 'string' || !/^[1-9][0-9]{0,19}$/.test(time)) throw Error('Native monotonic observation missing');
  return BigInt(time);
}
async function privateFile(path, maximum, appendOnly = false) {
  if (!isAbsolute(path) || await realpath(path) !== path) throw Error('Canonical absolute private command/event path required');
  const directory = dirname(path), parent = await lstat(directory, { bigint: true });
  const uid = BigInt(process.getuid());
  const privateDirectory = stat => stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777n) === 0o700n;
  const privateRegular = stat => stat.isFile() && stat.uid === uid && stat.nlink === 1n && (stat.mode & 0o777n) === 0o600n &&
    stat.size <= BigInt(maximum) && (appendOnly || stat.size > 0n);
  const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
  if (!privateDirectory(parent)) throw Error('Private regular owner-only file required');
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    if (!privateRegular(before)) throw Error('Private regular owner-only file required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw Error('Private input truncated while reading');
      offset += bytesRead;
    }
    const after = await fd.stat({ bigint: true });
    const atPath = await lstat(path, { bigint: true });
    const currentParent = await lstat(directory, { bigint: true });
    if (!privateDirectory(currentParent) || !sameInode(parent, currentParent) ||
        ![after, atPath].every(stat => privateRegular(stat) && sameInode(before, stat) &&
          (appendOnly ? stat.size >= before.size : stat.size === before.size &&
            stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs))) {
      throw Error('Private input identity or size changed while reading');
    }
    return bytes;
  } finally { await fd.close(); }
}
function identity(record) {
  if (record.consumer !== 'BrowserRouteProtection' || !['tor', 'nym'].includes(record.mode) || !UUID.test(record.epoch ?? '')
    || !UUID.test(record.providerGeneration ?? '') || ![record.rootAuditTokenSHA256, record.executableSHA256, record.manifestSHA256, record.bootstrapSHA256].every(value => SHA.test(value ?? ''))
    || !Number.isSafeInteger(Number(record.rootPID)) || Number(record.rootPID) <= 1) throw Error('Actual Native root binding missing');
  return { ...record, rootPID: Number(record.rootPID) };
}

/** File transport for the actual flag-only Native dispatcher. This does not launch a helper,
 * fabricate a provider/ready value, signal a PID, or produce platform PASS. The parent starts
 * the exact reviewed routed LS app and appends its real JSON events to eventFile. */
export class NativeProtectedControlBridge {
  constructor({ commandFile, eventFile, runID, mode, manifestSHA256, expectedRootPID, expectedExecutableSHA256, timeoutMilliseconds = 30000 }) {
    if (dirname(commandFile) !== dirname(eventFile) || !['tor', 'nym'].includes(mode) || !SHA.test(manifestSHA256 ?? '')
      || !/^[a-z0-9-]{1,40}$/.test(runID ?? '') || !Number.isSafeInteger(expectedRootPID) || expectedRootPID <= 1 || !SHA.test(expectedExecutableSHA256 ?? '')
      || !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 100 || timeoutMilliseconds > 600000) throw Error('Exact reviewed Native control binding required');
    Object.assign(this, { commandFile, eventFile, runID, mode, manifestSHA256, expectedRootPID, expectedExecutableSHA256, timeoutMilliseconds });
    this.records = []; this.eventPrefix = { length: 0, sha256: digest(Buffer.alloc(0)) };
    this.sequence = undefined; this.current = undefined; this.busy = false;
    this.routeLossBlock = undefined;
    this.baseline = undefined;
    this.userRetryRequest = undefined;
    this.poisoned = false;
    this.closed = false;
  }
  async readEvents() {
    const bytes = await privateFile(this.eventFile, 4 * 1024 * 1024, true);
    const complete = bytes.subarray(0, bytes.lastIndexOf(10) + 1); // Ignore incomplete last append.
    if (complete.length < this.eventPrefix.length ||
        digest(complete.subarray(0, this.eventPrefix.length)) !== this.eventPrefix.sha256) {
      throw Error('Native event journal prefix changed; UNKNOWN preserved');
    }
    const fresh = new TextDecoder('utf-8', { fatal: true }).decode(complete.subarray(this.eventPrefix.length));
    const lines = fresh.split('\n'); lines.pop();
    if (this.records.length + lines.length > 8192) throw Error('Native event journal oversized; UNKNOWN preserved');
    const receivedAt = Date.now();
    const records = lines.map(line => {
      if (Buffer.byteLength(line) > 16384) throw Error('Native event record exceeds bound');
      const value = JSON.parse(line);
      if (![CONSUMER, DISPATCH].includes(value.schema) || value.runID !== this.runID) throw Error('Foreign Native event in private run journal');
      return { ...value, receivedAt };
    });
    this.records.push(...records);
    this.eventPrefix = { length: complete.length, sha256: digest(complete) };
    return this.records;
  }
  async waitFor(predicate, from = 0) {
    const end = Date.now() + this.timeoutMilliseconds;
    while (Date.now() < end) {
      const records = await this.readEvents();
      const failure = records.slice(from).find(value => ['command-failed', 'cleanup-unknown', 'deadline'].includes(value.kind));
      if (failure) { this.poisoned = true; const error = Error(`Native ${failure.kind}: ${failure.effectState ?? 'UNKNOWN'}`); error.nativeEvidence = failure; throw error; }
      const found = records.slice(from).find(predicate); if (found) return found;
      await delay(25);
    }
    this.poisoned = true; const error = Error('Native control readback timeout; no automatic retry'); error.nativeEvidence = this.records.slice(from); throw error;
  }
  async binding() {
    // Initial open is an explicit prewritten command, not an automatic phase or route fallback.
    if (this.sequence === undefined) {
      const value = JSON.parse(await privateFile(this.commandFile, 4096));
      if (value.schema !== 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1' || value.runID !== this.runID || value.sequence !== 1 || value.operation !== 'open') throw Error('Exact initial explicit open command required');
      this.sequence = 1;
    }
    const record = await this.waitFor(value => value.kind === 'consumer-attached');
    const bound = identity(record);
    if (bound.mode !== this.mode || bound.manifestSHA256 !== this.manifestSHA256 || bound.rootPID !== this.expectedRootPID || bound.executableSHA256 !== this.expectedExecutableSHA256) throw Error('Actual Native process/mode/manifest differs');
    this.current = bound; return bound;
  }
  async command(operation, { retainUntilReadback = false } = {}) {
    if (this.closed) throw Error('Native command channel is closed');
    if (this.poisoned || this.busy || this.sequence === undefined) throw Error('Native command is unbound or another action is UNKNOWN');
    this.busy = true;
    const sequence = ++this.sequence;
    const bytes = Buffer.from(JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1', runID: this.runID, sequence, operation }) + '\n');
    const commandSHA256 = digest(bytes), temporary = join(dirname(this.commandFile), `.command-${randomUUID()}`);
    try {
      await privateFile(this.commandFile, 4096);
      const fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
      const index = (await this.readEvents()).length;
      await rename(temporary, this.commandFile); // One mutation; on timeout never resend this command.
      await this.waitFor(value => value.kind === 'command-accepted' && value.commandSHA256 === commandSHA256 && Number(value.sequence) === sequence, index);
      return { index, commandSHA256, sequence };
    } catch (error) { this.poisoned = true; error.commandEffect = { operation, sequence, commandSHA256, state: 'UNKNOWN-no-automatic-retry' }; throw error; }
    finally {
      try {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } catch (error) {
        if (!this.poisoned) { this.poisoned = true; throw error; }
      } finally {
        if (this.poisoned || !retainUntilReadback) this.busy = false;
      }
    }
  }
  async explicitPhase(phase) {
    if (phase === 'baseline') {
      return this.readBoundOperation(phase, 'phase-dispatched', (value, accepted) => {
        if (value.schema !== CONSUMER || value.phase !== phase || !sameBinding(value, this.current) ||
            monotonic(value) < monotonic(accepted)) throw Error('Native baseline readback does not match the bound phase');
        this.baseline = { binding: this.current, acceptedAt: monotonic(accepted), index: this.records.indexOf(accepted) + 1 };
        return value;
      });
    }
    if (phase === 'user-retry') {
      if (this.poisoned || this.busy) throw Error('Native command is unbound or another action is UNKNOWN');
      const request = this.userRetryRequest;
      if (!request || request.binding !== this.current) throw Error('Native user retry requires a bound explicit request');
      this.userRetryRequest = undefined;
      return this.readBoundOperation(phase, 'explicit-user-retry', (value, accepted, between, sent) => {
        const dispatched = between.find(row => row.kind === 'phase-dispatched' && row.phase === phase &&
          row.schema === CONSUMER && sameBinding(row, request.binding));
        if (!dispatched || value.schema !== DISPATCH || !sameBinding(value, request.binding) ||
            monotonic(accepted) < request.at || monotonic(dispatched) < monotonic(accepted) ||
            monotonic(value) < monotonic(dispatched) || value.commandSHA256 !== sent.commandSHA256 ||
            value.actionReceiptSHA256 !== request.sha || value.humanClickClaimed !== 'false') {
          throw Error('Native explicit user retry readback does not match the bound phase and commands');
        }
        return dispatched;
      });
    }
    if (phase !== 'fault-retry') throw Error('Unknown Native phase');
    const original = this.current;
    return this.readBoundOperation(phase, 'fault-retry-refused', (result, accepted, between, sent) => {
      const refusal = between.find(row => row.schema === CONSUMER && row.kind === 'phase-refused' &&
        row.phase === phase && sameBinding(row, original));
      if (!refusal || result.schema !== DISPATCH || !sameBinding(result, original) ||
          result.commandSHA256 !== sent.commandSHA256 ||
          monotonic(refusal) < monotonic(accepted) || monotonic(result) < monotonic(refusal)) {
        throw Error('Native fault retry refusal does not match the bound command and consumer');
      }
      return result;
    });
  }
  async waitForInFlight({ wssMinimumFrames, downloadMinimumBytes, downloadMustBeUncommitted }) {
    if (!downloadMustBeUncommitted) throw Error('Uncommitted native download evidence required');
    const baseline = this.baseline;
    if (!baseline || baseline.binding !== this.current) throw Error('Native in-flight readback requires the current baseline');
    let selected;
    try {
      await this.waitFor(() => {
        const rows = this.records.slice(baseline.index).filter(row =>
          row.schema === CONSUMER && sameBinding(row, baseline.binding) && monotonic(row) >= baseline.acceptedAt);
        const started = rows.findIndex(row => row.kind === 'instrument' && row.messageKind === 'phase-started' && row.phase === 'baseline');
        if (started < 0 || rows.some(row => row.kind === 'blocked')) return false;
        const frames = new Set(), downloads = new Map(), ended = new Set();
        const startedAt = monotonic(rows[started]);
        for (const row of rows.slice(started + 1)) {
          if (monotonic(row) < startedAt) continue;
          if (row.kind === 'instrument' && row.messageKind === 'wss' && row.phase === 'baseline' && row.probeID === 'baseline-long-wss') {
            if (['closed', 'rejected', 'body-mismatch'].includes(row.status)) return false;
            const sequence = Number(row.frameSequence);
            if (row.status === 'body-match' && SHA.test(row.sha256 ?? '') && Number.isInteger(sequence) &&
                sequence >= 1 && sequence <= 128 && String(sequence) === row.frameSequence) frames.add(sequence);
          }
          const id = row.downloadID;
          if (!UUID.test(id ?? '') || ended.has(id)) continue;
          if (['download-committed', 'download-failed'].includes(row.kind)) {
            ended.add(id); downloads.delete(id);
          } else if (row.kind === 'download-accepted' && row.committed === 'false' && !downloads.has(id)) {
            downloads.set(id, { acceptedAt: monotonic(row), destinationAt: null, bytes: 0 });
          } else if (downloads.has(id) && row.committed === 'false') {
            const download = downloads.get(id), at = monotonic(row);
            if (row.kind === 'download-destination' && download.destinationAt === null && at >= download.acceptedAt &&
                /^(0|[1-9][0-9]*)$/.test(row.generation ?? '')) download.destinationAt = at;
            if (row.kind === 'download-progress' && download.destinationAt !== null && at >= download.destinationAt) {
              const bytes = Number(row.bytes);
              if (Number.isSafeInteger(bytes) && bytes >= 0 && String(bytes) === row.bytes) download.bytes = Math.max(download.bytes, bytes);
            }
          }
        }
        let wssFrames = 0;
        while (frames.has(wssFrames + 1)) wssFrames++;
        const stream = [...downloads].find(([, value]) => value.bytes >= downloadMinimumBytes);
        if (wssFrames >= wssMinimumFrames && stream) selected = { wssFrames, downloadBytes: stream[1].bytes, downloadCommitted: false, downloadID: stream[0] };
        return Boolean(selected);
      }, baseline.index);
    } catch (error) {
      this.poisoned = true;
      throw error;
    }
    return selected;
  }
  async applyReviewedFault(fault) {
    if (fault !== 'route-loss') throw Error(`No mature public owned callee configured for ${fault}; no fabricated action receipt`);
    const { index, commandSHA256, sequence } = await this.command(fault, { retainUntilReadback: true });
    try {
      const bound = row => sameBinding(row, this.current);
      const dispatched = row => row.schema === DISPATCH && bound(row);
      const forCommand = row => dispatched(row) && row.fault === fault && row.commandSHA256 === commandSHA256;
      const applied = await this.waitFor(row => dispatched(row) && row.kind === 'fault-applied-observed' && row.fault === fault &&
        row.observation === 'owned-children-reaped-and-native-blocked' && row.osPacketDrop === 'NOT_OBSERVED', index);
      const observed = this.records.slice(index, this.records.indexOf(applied));
      const accepted = observed.find(row => dispatched(row) && row.kind === 'command-accepted' &&
        row.operation === fault && row.commandSHA256 === commandSHA256 && row.sequence === String(sequence));
      const intent = observed.find(row => forCommand(row) && row.kind === 'fault-commit-intent' &&
        row.faultApplied === 'false' && SHA.test(row.commitIntentSHA256 ?? ''));
      const done = observed.find(row => forCommand(row) && row.kind === 'fault-action-returned' &&
        row.effectState === 'requires-closure-readback');
      const afterIntent = intent ? observed.slice(observed.indexOf(intent) + 1) : [];
      const block = afterIntent.find(row => row.schema === CONSUMER && bound(row) && row.kind === 'blocked' &&
        row.nativeWebViewRemoved === 'true' && monotonic(row) >= monotonic(intent));
      if (!accepted || !intent || !done || !block ||
          observed.indexOf(accepted) >= observed.indexOf(intent) || observed.indexOf(intent) >= observed.indexOf(done) ||
          monotonic(accepted) > monotonic(intent) || monotonic(intent) > monotonic(done) ||
          monotonic(done) > monotonic(applied) || monotonic(block) > monotonic(applied)) {
        throw Error('Native route-loss commit, block and physical action order is unconfirmed');
      }
      if (!SHA.test(done.actionReceiptSHA256 ?? '') || typeof done.ownedExitReceiptJSON !== 'string' ||
          digest(Buffer.from(done.ownedExitReceiptJSON)) !== done.actionReceiptSHA256) throw Error('Native route-loss owned-exit receipt hash mismatch');
      const receipts = JSON.parse(done.ownedExitReceiptJSON);
      if (!sameBinding(receipts?.rootBinding, this.current) || receipts.commandSHA256 !== commandSHA256 ||
          !Array.isArray(receipts.ownedExits) || !receipts.ownedExits.length ||
          receipts.ownedExits.some(row => typeof row?.pid !== 'string' || !/^[1-9][0-9]{0,9}$/.test(row.pid) ||
            Number(row.pid) <= 1 || Number(row.pid) > 2147483647 || row.childReaped !== 'true' ||
            row.cleanupChildPID !== row.pid || row.helperCleanupConfirmed !== 'true') ||
          new Set(receipts.ownedExits.map(row => row.pid)).size !== receipts.ownedExits.length) {
        throw Error('Native route-loss original child and helper closure are unconfirmed');
      }
      this.routeLossBlock = block;
      return { fault, runID: this.runID, actionReceiptSHA256: done.actionReceiptSHA256,
        at: intent.receivedAt, atMonotonicNanoseconds: intent.atMonotonicNanoseconds, ownedExits: receipts.ownedExits };
    } catch (error) {
      this.poisoned = true;
      throw error;
    } finally { this.busy = false; }
  }
  async waitForBlocked() {
    const event = this.routeLossBlock;
    if (!event || !sameBinding(event, this.current)) throw Error('No matching original fault block');
    return { runID: this.runID, epoch: event.epoch, state: 'blocked',
      at: event.receivedAt, atMonotonicNanoseconds: event.atMonotonicNanoseconds };
  }
  async rebuildOriginalRouteQuiet() {
    const original = this.current;
    const closed = await this.readBoundOperation('close', 'whole-window-closed', (row, accepted) => {
      if (row.schema !== DISPATCH || !sameBinding(row, original) || monotonic(row) < monotonic(accepted) ||
          row.closedEpoch !== original.epoch || row.remoteState !== 'closed-deny-only' || row.localWebViewRetained !== 'false' ||
          row.ownedChildrenReaped !== 'true' || row.ownedHelpersCleanupConfirmed !== 'true' || row.osCrashNoLeakProof !== 'NOT_RUN') {
        throw Error('Native original closure readback does not match the bound run');
      }
      return row;
    });
    return this.readBoundOperation('rebuild-quiet', 'route-rebuilt-quiet', (rebuilt, accepted, between) => {
      const attached = between.find(row => row.schema === CONSUMER && row.kind === 'consumer-attached');
      if (!attached || attached.epoch === original.epoch || !UUID.test(attached.epoch ?? '') ||
          !sameBinding(attached, { ...original, epoch: attached.epoch }) ||
          rebuilt.schema !== DISPATCH || !sameBinding(rebuilt, attached) ||
          monotonic(accepted) < monotonic(closed) || monotonic(attached) < monotonic(accepted) ||
          monotonic(rebuilt) < monotonic(attached) || rebuilt.targetDispatchState !== 'idle-no-phase' ||
          rebuilt.controlState !== 'connected' || rebuilt.noAutomaticRequest !== 'true') {
        throw Error('Native fresh quiet rebuild readback does not match the bound run');
      }
      const next = identity(attached);
      this.current = next;
      return { mode: next.mode, state: 'connected-no-target-phase', targetDispatchState: 'idle-no-phase',
        epoch: next.epoch, providerGeneration: next.providerGeneration, at: rebuilt.receivedAt };
    });
  }
  async explicitUserRequest() {
    return this.readBoundOperation('request-user-retry', 'explicit-request-acknowledged', (value, accepted, between, sent) => {
      if (value.schema !== DISPATCH || !sameBinding(value, this.current) || monotonic(value) < monotonic(accepted) ||
          value.actionReceiptSHA256 !== sent.commandSHA256 || value.humanClickClaimed !== 'false' ||
          value.targetRequestDispatched !== 'false') throw Error('Native explicit user request readback does not match the bound command');
      this.userRetryRequest = { binding: this.current, at: monotonic(value), sha: sent.commandSHA256 };
      return { actionReceiptSHA256: value.actionReceiptSHA256, at: value.receivedAt, humanClickClaimed: false };
    });
  }
  async readBoundOperation(operation, kind, verify) {
    const original = this.current;
    const sent = await this.command(operation, { retainUntilReadback: true });
    try {
      const observed = await this.waitFor(row => row.kind === kind, sent.index);
      const before = this.records.slice(sent.index, this.records.indexOf(observed));
      const accepted = before.find(row => row.schema === DISPATCH && row.kind === 'command-accepted' && row.operation === operation &&
        row.commandSHA256 === sent.commandSHA256 && row.sequence === String(sent.sequence) && sameBinding(row, original));
      if (!accepted) throw Error(`Native ${operation} command acceptance does not match the bound run`);
      return verify(observed, accepted, before.slice(before.indexOf(accepted) + 1), sent);
    } catch (error) {
      this.poisoned = true;
      throw error;
    } finally { this.busy = false; }
  }
  async finishEvidence() {
    const original = this.current;
    return this.readBoundOperation('finish', 'finished', (value, accepted) => {
      if (value.schema !== DISPATCH || !sameBinding(value, original) || monotonic(value) < monotonic(accepted) ||
          value.targetVerdict !== 'INCOMPLETE' || value.productionRouteAdmission !== 'false') {
        throw Error('Native finish readback does not match the bound terminal receipt');
      }
      this.closed = true;
      // The dispatcher authenticates its terminal lifecycle, not independent network evidence.
      return { nativeRecords: this.records, targetVerdict: 'INCOMPLETE', productionRouteAdmission: false, actualOSCrashIsolation: 'NOT_RUN',
        independentNetworkCoverage: { dns: 'NOT_SUPPLIED', stunIPv4: 'NOT_SUPPLIED', stunIPv6: 'NOT_SUPPLIED', kernelFlowCutoff: 'NOT_TESTED' } };
    });
  }
}
