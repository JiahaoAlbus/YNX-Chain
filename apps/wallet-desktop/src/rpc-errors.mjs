const HASH = /^0x[0-9a-f]{64}$/;
function projectionData(error) {
  const data = error.data, quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,127})$/.test(value);
  if (error.code !== -32004 || data?.status !== "native_block_projection_unsupported" || !quantity(data.blockNumber) || !HASH.test(data.blockHash ?? "") || !quantity(data.feeEquivalentGas) || data.projectionGasLimit !== "0x1c9c380" || data.gasSemantics !== "native fixed-fee accounting; no EVM block gas scheduling" || data.nativeBlockPath !== `/blocks/${BigInt(data.blockNumber).toString()}`) return {};
  return { status: data.status, blockNumber: data.blockNumber, blockHash: data.blockHash, feeEquivalentGas: data.feeEquivalentGas, projectionGasLimit: data.projectionGasLimit, gasSemantics: data.gasSemantics, nativeBlockPath: data.nativeBlockPath };
}
export function rpcResponseError(error, { method, id, origin, httpSuccess = false } = {}) {
  if (!error || !Number.isInteger(error.code) || typeof error.message !== "string") return Object.assign(new Error("The network returned an invalid RPC error."), { code: 4900, data: { code: "RPC_INVALID_RESPONSE" } });
  const uncertain = error.code === -32002 && error.data?.status === "transaction_durability_uncertain";
  const code = uncertain ? "TRANSACTION_DURABILITY_UNCERTAIN" : ({ [-32601]: "RPC_METHOD_UNAVAILABLE", [-32602]: "RPC_INVALID_PARAMS", [-32003]: "RPC_TRANSACTION_REJECTED", [-32004]: "RPC_TRANSACTION_UNSUPPORTED" })[error.code] ?? "RPC_REQUEST_FAILED";
  return Object.assign(new Error(error.message.slice(0, 400)), { code: error.code, data: { code, rpcCode: error.code, rpcResponse: true, rpcMethod: method, rpcRequestId: id, rpcOrigin: origin, rpcHttpSuccess: httpSuccess, rpcDefiniteRejection: httpSuccess && error.code === -32003 && error.data === undefined, ...(typeof error.data?.status === "string" ? { status: error.data.status.slice(0, 80) } : {}), ...projectionData(error), ...(HASH.test(error.data?.transactionHash ?? "") ? { transactionHash: error.data.transactionHash } : {}), ...(uncertain ? { outcomeUnknown: true } : {}) } });
}
