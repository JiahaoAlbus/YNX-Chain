'use strict';
// Public failure categories only. Never forward a supplier's message, stack,
// paths, receipt, authority selection or arbitrary error code to the renderer.
const messages = Object.freeze({
  WALLET_SERVICE_ADMISSION_NOT_SUPPLIED: 'Wallet service admission is not supplied.',
  WALLET_ONLINE_ADMISSION_PAUSED: 'Wallet online connection is paused.',
  WALLET_SERVICE_ADMISSION_DENIED: 'Wallet service admission was rejected.',
  WALLET_SERVICE_ADMISSION_UNAVAILABLE: 'Wallet service admission communication is unavailable.',
});
const known = code => typeof code === 'string' && Object.hasOwn(messages, code);
const failure = code => {
  const safe = known(code) ? code : 'WALLET_SERVICE_ADMISSION_UNAVAILABLE';
  return Object.assign(Error(messages[safe]), { code: safe });
};
const ownCode = error => {
  try { return Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch { return undefined; }
};
const supplierCode = error => {
  const code = ownCode(error);
  return code === 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED' || code === 'WALLET_ONLINE_ADMISSION_PAUSED'
    ? code : 'WALLET_SERVICE_ADMISSION_DENIED';
};
const exact = (value, keys) => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === keys;
function assertAdmissionResult(value) {
  if (exact(value, 'ok') && value.ok === true) return undefined;
  if (exact(value, 'code,ok') && value.ok === false && known(value.code)) throw failure(value.code);
  throw failure('WALLET_SERVICE_ADMISSION_UNAVAILABLE');
}
function createAdmissionRpc(admission) {
  return Object.freeze({ async assertCurrent(value) {
    try {
      const result = await admission.assertCurrent(value);
      if (result !== undefined) throw failure('WALLET_SERVICE_ADMISSION_DENIED');
      return { ok: true };
    } catch (error) {
      const code = ownCode(error);
      return { ok: false, code: known(code) ? code : 'WALLET_SERVICE_ADMISSION_UNAVAILABLE' };
    }
  } });
}
function createAdmissionProxy(rpc) {
  return Object.freeze({ async assertCurrent(value) {
    let result;
    try { result = await rpc.assertCurrent(value); }
    catch { throw failure('WALLET_SERVICE_ADMISSION_UNAVAILABLE'); }
    return assertAdmissionResult(result);
  } });
}
module.exports = { failure, supplierCode, known, assertAdmissionResult, createAdmissionRpc, createAdmissionProxy };
