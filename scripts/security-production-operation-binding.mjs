/**
 * Bind a read-only operator bundle preflight to one production mutation run.
 */

export function bindProductionOperationExecution({
  preflight,
  expectedOperation,
  runtimeSourceCommit,
  changeApproval,
  alertInputPreflight,
}) {
  if (
    preflight?.schemaVersion !== 1
    || preflight.action !== "production-operation-bundle-preflight"
    || preflight.operation !== expectedOperation
    || !/^[0-9a-f]{64}$/.test(preflight.bundleSha256 ?? "")
    || preflight.runtimeSourceCommit !== runtimeSourceCommit
    || preflight.changeAuthorization?.authorizationId !== changeApproval?.authorizationId
    || preflight.alertPreflight?.credentialBinding?.credentialIdentitySha256
      !== alertInputPreflight?.credentialBinding?.credentialIdentitySha256
    || !/^[0-9a-f]{64}$/.test(preflight.receiptSha256 ?? "")
    || preflight.leaseAcquired !== false
    || preflight.alertDeliveryPerformed !== false
    || preflight.productionMutationPerformed !== false
    || preflight.ready !== true
  ) {
    throw new Error("production operator bundle preflight does not bind this execution");
  }
  return {
    schemaVersion: 1,
    operation: expectedOperation,
    bundleSha256: preflight.bundleSha256,
    preflightReceiptSha256: preflight.receiptSha256,
    runtimeSourceCommit,
    changeAuthorizationId: changeApproval.authorizationId,
    credentialIdentitySha256:
      alertInputPreflight.credentialBinding.credentialIdentitySha256,
    bound: true,
  };
}
