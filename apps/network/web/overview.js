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
