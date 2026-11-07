// Offline synthetic-wallet QA. This script refuses non-loopback targets.
const ethers = require(process.env.YNX_ETHERS_MODULE || 'ethers');
const {performance} = require('node:perf_hooks');

// Observe only this already-submitted hash. A completed local snapshot is not
// BFT finality. Never turn UNKNOWN into a second send, signature, or nonce.
async function waitForLocallyDurableReceipt(provider, tx, timeoutMs) {
  if (!/^0x[0-9a-f]{64}$/.test(tx.hash) || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) throw new Error('invalid original receipt wait');
  const deadline = performance.now() + timeoutMs;
  const remaining = () => {
    const ms = Math.ceil(deadline - performance.now());
    if (ms <= 0) throw new Error('original receipt deadline exceeded');
    return ms;
  };
  async function bounded(call) {
    let timer;
    try {
      const ms = remaining();
      return await Promise.race([
        call(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('original receipt deadline exceeded')), ms); })
      ]);
    } finally { clearTimeout(timer); }
  }
  const network = await bounded(() => provider.getNetwork());
  if (network.chainId !== 6423n) throw new Error('receipt wait network mismatch');
  const quantity = value => {
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) throw new Error('invalid local checkpoint height');
    return BigInt(value);
  };
  const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
  let proof;
  for (;;) {
    proof = await bounded(() => provider.send('ynx_getTransactionDurability', [tx.hash]));
    if (!proof || proof.version !== 'ynx-local-durability-v1' || proof.scope !== 'local-snapshot' || proof.transactionHash !== tx.hash || !['pending_durable','uncertain','durable'].includes(proof.status)) throw new Error('invalid original local durability observation');
    if (proof.status === 'durable' || proof.status === 'pending_durable') {
      quantity(proof.checkpointBlockNumber);
      if (!hash(proof.checkpointBlockHash) || !hash(proof.snapshotIntegrity)) throw new Error('invalid original local checkpoint');
    }
    if (proof.status === 'durable') {
      if (quantity(proof.blockNumber) === 0n || quantity(proof.blockNumber) > quantity(proof.checkpointBlockNumber) || !hash(proof.blockHash)) throw new Error('invalid original local inclusion');
      break;
    }
    await bounded(() => new Promise(resolve => setTimeout(resolve, Math.min(50, remaining()))));
  }
  // The same 10s budget includes observation and the original ethers check.
  // A later error still propagates; no retry of a receipt or broadcast error.
  const receipt = await bounded(() => tx.wait(1, remaining()));
  if (!receipt || receipt.hash !== tx.hash || receipt.blockHash !== proof.blockHash || BigInt(receipt.blockNumber) !== quantity(proof.blockNumber)) throw new Error('original receipt differs from durable inclusion');
  return receipt;
}

module.exports = {waitForLocallyDurableReceipt};
async function main() {
  const endpoint = new URL(process.argv[2]);
  if (!['127.0.0.1','localhost'].includes(endpoint.hostname)) throw new Error('local test target required');
  const provider = new ethers.JsonRpcProvider(endpoint.href, undefined, {pollingInterval:50});
  const wallet = new ethers.Wallet('0x'+'46'.repeat(32),provider);
  const recipient='0x3535353535353535353535353535353535353535';
  try {
  const before=await provider.getBalance(wallet.address,'pending');
  const network=await provider.getNetwork();
  const fee=await provider.getFeeData();
  if (network.chainId!==6423n || fee.gasPrice!==40000000000000n || fee.maxFeePerGas!==null) throw new Error('fee/network mismatch');
  const tx=await wallet.sendTransaction({to:recipient,value:ethers.parseEther('2'),type:0});
  const receipt=await waitForLocallyDurableReceipt(provider,tx,10000);
  const readback=await provider.getTransaction(tx.hash);
  // Disable provider cache for the final authoritative balance comparison.
  const after=BigInt(await provider.send('eth_getBalance',[wallet.address,'pending']));
  const received=BigInt(await provider.send('eth_getBalance',[recipient,'pending']));
  if (receipt.status!==1 || receipt.gasUsed!==25000n || receipt.fee!==ethers.parseEther('1') || before-after!==ethers.parseEther('3') || received!==ethers.parseEther('2') || readback.nonce!==0 || readback.hash!==tx.hash) throw new Error('receipt/balance/nonce mismatch');
  const padded=await wallet.sendTransaction({to:recipient,value:ethers.parseEther('2'),type:0,nonce:1,gasLimit:30000n,gasPrice:fee.gasPrice});
  const paddedReceipt=await waitForLocallyDurableReceipt(provider,padded,10000);
  const paddedAfter=BigInt(await provider.send('eth_getBalance',[wallet.address,'pending']));
  const paddedCredit=BigInt(await provider.send('eth_getBalance',[recipient,'pending']));
  if(padded.gasLimit!==30000n||paddedReceipt.gasUsed!==25000n||paddedReceipt.gasPrice!==40000000000000n||paddedReceipt.fee!==ethers.parseEther('1')||after-paddedAfter!==ethers.parseEther('3')||paddedCredit-received!==ethers.parseEther('2'))throw new Error('padded gas receipt/balance mismatch');
  console.log(JSON.stringify({ethers:ethers.version,localOnly:true,chainId:network.chainId.toString(),hash:tx.hash,gasPrice:fee.gasPrice.toString(),gasUsed:receipt.gasUsed.toString(),actualFeeWei:receipt.fee.toString(),senderDebitWei:(before-after).toString(),recipientCreditWei:received.toString(),receiptStatus:receipt.status,nonce:readback.nonce,blockNumber:receipt.blockNumber,paddedGas:{hash:padded.hash,gasLimit:padded.gasLimit.toString(),maximumFeeWei:(padded.gasLimit*fee.gasPrice).toString(),gasUsed:paddedReceipt.gasUsed.toString(),effectiveGasPrice:paddedReceipt.gasPrice.toString(),actualFeeWei:paddedReceipt.fee.toString(),senderDebitWei:(after-paddedAfter).toString(),recipientCreditWei:(paddedCredit-received).toString(),receiptStatus:paddedReceipt.status,nativeNonceAfter:2}}));
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1});
