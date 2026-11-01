(function () {
  'use strict';

  // Read-only display projection of the helper's existing DTOs. A returned
  // value is a single RPC report or helper self-diagnostic, never a verifier,
  // node-start result, browser OS identity, Wallet permission or funds proof.
  const MAX_VALIDATORS = 4096;
  const UINT64_MAX = '18446744073709551615';
  const owns = (value, key) => object(value) && Object.prototype.hasOwnProperty.call(value, key);
  const field = (value, key) => owns(value, key) ? value[key] : undefined;
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function text(value, limit = 256) {
    return typeof value === 'string' && value.length > 0 && value.length <= limit &&
      !/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) ? value : null;
  }
  function uint(value, max = UINT64_MAX) {
    // JSON.parse has already rounded an unsafe Number. Never convert it back
    // into a string which would misleadingly look like the original integer.
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) return null;
      value = String(value);
    }
    if (typeof value !== 'string' || value.length > max.length || !/^(0|[1-9][0-9]*)$/.test(value) ||
      value.length === max.length && value > max) return null;
    return value;
  }
  function power(value) { return uint(value, '9'.repeat(128)); }
  function boolean(value) { return typeof value === 'boolean' ? value : null; }
  function token(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : null; }
  function hash(value) { return typeof value === 'string' && /^(?:0x)?[0-9a-fA-F]{64}$/.test(value) ? value : null; }
  function timestamp(value) {
    if (typeof value !== 'string' || value.length > 40) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) return null;
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      m[7] !== 'Z' && (Number(m[7].slice(1, 3)) > 23 || Number(m[7].slice(4)) > 59) || !Number.isFinite(Date.parse(value))) return null;
    return value; // Preserve original fractional precision; do not estimate age.
  }
  function source(value) {
    if (!text(value, 2048)) return null;
    try {
      const u = new URL(value);
      return ['https:', 'http:'].includes(u.protocol) && u.hostname && !u.username && !u.password && !u.hash && !u.search ? value : null;
    } catch { return null; }
  }
  function code(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null; }
  function report(reports, name, accepted) {
    if (!accepted) return { meta: { status: 'unavailable', code: 'RPC_REPORT_NOT_SUPPLIED' }, data: null };
    const item = field(reports, name);
    if (field(item, 'status') !== 'reported') return { meta: { status: 'unavailable', code: code(field(item, 'code')) || 'REPORT_NOT_SUPPLIED' }, data: null };
    const data = field(item, 'data');
    return object(data) ? { meta: { status: 'reported', code: null }, data } :
      { meta: { status: 'unavailable', code: 'INVALID_REPORT_DATA' }, data: null };
  }
  function statusView(data) {
    if (!data) return null;
    return {
      network: text(field(data, 'network')), chainId: uint(field(data, 'chainId')), height: uint(field(data, 'height')),
      latestBlockHash: hash(field(data, 'latestBlockHash')), latestBlockTime: timestamp(field(data, 'latestBlockTime')),
      validatorCount: uint(field(data, 'validatorCount')), readyValidatorCount: uint(field(data, 'readyValidatorCount')),
      pendingTxCount: uint(field(data, 'pendingTxCount')), catchingUp: boolean(field(data, 'catchingUp'))
    };
  }
  function blockView(data) {
    if (!data) return null;
    const transactions = field(data, 'transactions');
    return {
      height: uint(field(data, 'height')), hash: hash(field(data, 'hash')), parentHash: hash(field(data, 'parentHash')),
      time: timestamp(field(data, 'time')), validator: token(field(data, 'validator')),
      transactionCount: Array.isArray(transactions) ? String(transactions.length) : null
    };
  }
  function validatorsView(data) {
    const rows = field(data, 'validators');
    if (!Array.isArray(rows)) return null;
    const result = { count: String(rows.length), items: [], votingPowerTotal: null, distribution: null,
      distributionReason: null, truncated: rows.length > MAX_VALIDATORS };
    const seen = new Set();
    let complete = true;
    for (const row of rows.slice(0, MAX_VALIDATORS)) {
      const item = { address: token(field(row, 'address')), moniker: text(field(row, 'moniker')),
        votingPower: power(field(row, 'votingPower')), active: boolean(field(row, 'active')) };
      if (!item.address || seen.has(item.address) || item.votingPower === null) complete = false;
      seen.add(item.address); result.items.push(item);
    }
    if (result.truncated) result.distributionReason = 'VALIDATOR_LIMIT';
    else if (!complete) result.distributionReason = 'INCOMPLETE_VOTING_POWER';
    else if (typeof BigInt !== 'function') result.distributionReason = 'BIGINT_UNAVAILABLE';
    else {
      const total = result.items.reduce((sum, row) => sum + BigInt(row.votingPower), BigInt(0));
      result.votingPowerTotal = total.toString();
      if (total === BigInt(0)) result.distributionReason = 'ZERO_VOTING_POWER';
      else result.distribution = result.items.map(row => ({ address: row.address, moniker: row.moniker,
        votingPower: row.votingPower, shareBps: Number(BigInt(row.votingPower) * BigInt(10000) / total) }));
    }
    return result;
  }
  function allowedFields(value, keys) {
    return object(value) && Object.keys(value).every(key => keys.includes(key));
  }
  function activityCount(value) {
    // This native DTO explicitly transports counts as decimal strings. Even a
    // safe Number is a different wire shape; an absent count is never zero.
    return typeof value === 'string' ? uint(value) : null;
  }
  function activityNode(value) {
    const keys = ['code', 'stage', 'mode', 'processOwned', 'capacityComplete', 'usedBytes', 'limitBytes', 'freeBytes'];
    if (!allowedFields(value, keys)) return null;
    const model = {
      code: code(field(value, 'code')), stage: text(field(value, 'stage')), mode: text(field(value, 'mode')),
      processOwned: boolean(field(value, 'processOwned')), capacityComplete: boolean(field(value, 'capacityComplete')),
      usedBytes: activityCount(field(value, 'usedBytes')), limitBytes: activityCount(field(value, 'limitBytes')),
      freeBytes: activityCount(field(value, 'freeBytes'))
    };
    if (!['UNSUPPORTED', 'NOT_SUPPLIED', 'UNAVAILABLE'].includes(model.code) || model.processOwned === null || model.capacityComplete === null) return null;
    if (model.capacityComplete && [model.usedBytes, model.limitBytes, model.freeBytes].includes(null)) model.capacityComplete = null;
    return model;
  }
  function activityParticipation(value) {
    const keys = ['code', 'configured', 'walletPublisherConfigured', 'stopped', 'entries', 'unknownEntries'];
    if (!allowedFields(value, keys)) return null;
    const model = {
      code: code(field(value, 'code')), configured: boolean(field(value, 'configured')),
      walletPublisherConfigured: boolean(field(value, 'walletPublisherConfigured')), stopped: boolean(field(value, 'stopped')),
      entries: activityCount(field(value, 'entries')), unknownEntries: activityCount(field(value, 'unknownEntries'))
    };
    return ['NOT_SUPPLIED', 'UNAVAILABLE', 'REVOKED', 'UNSUPPORTED', 'CONFIGURED'].includes(model.code) &&
      model.configured !== null && model.walletPublisherConfigured !== null && model.stopped !== null ? model : null;
  }
  function activityResourceSource(value) {
    const keys = ['code', 'nativeLinked', 'current', 'partialAcquired', 'cleanupPending', 'physicalComplete', 'firstCauseCode', 'productionEnabled'];
    if (!allowedFields(value, keys) || field(value, 'productionEnabled') !== false) return null;
    const model = {code: code(field(value, 'code')), nativeLinked: boolean(field(value, 'nativeLinked')), current: boolean(field(value, 'current')), partialAcquired: boolean(field(value, 'partialAcquired')), cleanupPending: boolean(field(value, 'cleanupPending')), physicalComplete: boolean(field(value, 'physicalComplete')), productionEnabled: false};
    if (!['NOT_SUPPLIED', 'NOT_ADMITTED', 'CURRENT', 'RETIRED'].includes(model.code) || Object.values(model).includes(null) ||
        model.current !== (model.code === 'CURRENT') || model.current && (!model.nativeLinked || model.cleanupPending || model.physicalComplete) ||
        model.cleanupPending && model.physicalComplete || !model.nativeLinked && (model.partialAcquired || model.code !== 'NOT_SUPPLIED')) return null;
    if (field(value, 'firstCauseCode') !== undefined) {
      const cause = field(value, 'firstCauseCode');
      if (typeof cause !== 'string' || !/^(NOT_SUPPLIED|RETIRED|CANCELED|DEADLINE|SOURCE_ERROR|NETWORK_RESOURCE_NATIVE(_CLAIM)?_[0-9]{1,10})$/.test(cause)) return null;
      model.firstCauseCode = cause;
    }
    return model;
  }
  function activityResource(value) {
    const counts = ['osMeasuredChildren', 'osUserMicros', 'osSystemMicros', 'osPeakRSSBytes'];
    const keys = ['code', 'state', 'activeWorkers', 'verifiedJobs', 'verifiedBytes', 'rewards', 'productionEnabled', 'source', 'containmentMode', ...counts];
    if (!allowedFields(value, keys) || field(value, 'rewards') !== 'NOT_AUTHORIZED' || field(value, 'productionEnabled') !== false) return null;
    const model = {
      code: code(field(value, 'code')), state: field(value, 'state') === undefined ? null : field(value, 'state'), activeWorkers: activityCount(field(value, 'activeWorkers')),
      verifiedJobs: activityCount(field(value, 'verifiedJobs')), verifiedBytes: activityCount(field(value, 'verifiedBytes')),
      rewards: 'NOT_AUTHORIZED', productionEnabled: false
    };
    const unavailableState = model.state === null && model.code === 'UNAVAILABLE';
    const disabledContradiction = model.code === 'DISABLED' &&
      (model.state === 'running' || model.activeWorkers !== null && model.activeWorkers !== '0');
    if (!['UNAVAILABLE', 'DISABLED', 'CONTROLLED_SANDBOX', 'UNKNOWN'].includes(model.code) ||
      !['disabled', 'stopped', 'running'].includes(model.state) && !unavailableState || disabledContradiction) return null;
    for (const key of counts) {
      if (field(value, key) !== undefined) {
        model[key] = activityCount(field(value, key));
        if (model[key] === null) return null;
      }
    }
    if (field(value, 'containmentMode') !== undefined) {
      model.containmentMode = text(field(value, 'containmentMode'));
      if (!model.containmentMode) return null;
    }
    if (field(value, 'source') !== undefined) {
      model.source = activityResourceSource(field(value, 'source'));
      if (!model.source) return null;
    }
    return model;
  }
  function activityView(value) {
    // Only this versioned status DTO is recognized. No omitted/true authority
    // flags or extra grant claims can be normalized into a benign display.
    if (!object(value) || Object.keys(value).some(key => !['version', 'authority', 'productionGrant', 'node', 'participation', 'resource'].includes(key)) ||
      field(value, 'version') !== 'YNX-NETWORK-LOCAL-ACTIVITY/v1' || field(value, 'authority') !== false ||
      field(value, 'productionGrant') !== false) return null;
    return {
      version: 'YNX-NETWORK-LOCAL-ACTIVITY/v1', authority: false, productionGrant: false,
      node: activityNode(field(value, 'node')), participation: activityParticipation(field(value, 'participation')),
      resource: activityResource(field(value, 'resource'))
    };
  }
  function nativeView(input) {
    const native = field(input, 'native'), peer = field(native, 'peer'), result = field(native, 'result'), status = field(result, 'status');
    // This is the existing helper's status self-call only. Do not consume
    // unrelated native payloads, RPC nodeIdentity, permission claims or meters.
    if (field(input, 'browserIdentityVerified') !== false || field(native, 'version') !== 'YNX-NETWORK-LOCAL-IPC/v1' ||
      field(native, 'code') !== 'OK' || field(peer, 'nativeIPCVerified') !== true || field(peer, 'browserIdentityVerified') !== false ||
      !object(status)) return null;
    const control = field(status, 'nodeControl'), resource = field(status, 'resourceContribution');
    return {
      scope: 'helper-self-diagnostic', service: text(field(status, 'service')),
      nodeControl: control === 'unavailable' ? control : null,
      resourceContribution: ['disabled', 'unavailable'].includes(resource) ? resource : null,
      participation: null,
      activity: activityView(field(status, 'activity')),
      peer: { uid: uint(field(peer, 'uid'), '4294967295'), pid: uint(field(peer, 'pid'), '2147483647'),
        credentialSource: token(field(peer, 'credentialSource')), nativeIPCVerified: true },
      browserIdentityVerified: false, authority: false
    };
  }
  function project(nodeReport, nativeStatus) {
    const accepted = field(nodeReport, 'classification') === 'RPC_ONLY';
    const reports = field(nodeReport, 'reports');
    const status = report(reports, 'status', accepted), block = report(reports, 'latestBlock', accepted), validators = report(reports, 'validators', accepted);
    const statusModel = statusView(status.data);
    let blockModel = blockView(block.data);
    // A latest-block row belongs to the one reported status height which the
    // helper queried. Inconsistent/unsafe numbers never become a recent series.
    if (blockModel && (statusModel?.height === null || !statusModel || blockModel.height === null || blockModel.height !== statusModel.height)) {
      blockModel = null; block.meta = { status: 'unavailable', code: 'BLOCK_HEIGHT_NOT_BOUND' };
    }
    return {
      classification: 'RPC_ONLY', authority: false, source: accepted ? source(field(nodeReport, 'source')) : null,
      reports: { status: status.meta, latestBlock: block.meta, validators: validators.meta },
      status: statusModel, latestBlock: blockModel, validators: validatorsView(validators.data), native: nativeView(nativeStatus)
    };
  }
  if (typeof window !== 'undefined') window.NetworkOverview = Object.freeze({ project });
}());
