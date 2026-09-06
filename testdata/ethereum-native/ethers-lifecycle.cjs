// Offline synthetic-wallet QA. This script refuses non-loopback targets.
const ethers = require(process.env.YNX_ETHERS_MODULE || 'ethers');
const endpoint = new URL(process.argv[2]);
if (!['127.0.0.1','localhost'].includes(endpoint.hostname)) throw new Error('local test target required');
const provider = new ethers.JsonRpcProvider(endpoint.href, undefined, {pollingInterval:50});
const wallet = new ethers.Wallet('0x'+'46'.repeat(32),provider);
const recipient='0x3535353535353535353535353535353535353535';
(async()=>{
  const before=await provider.getBalance(wallet.address,'pending');
  const network=await provider.getNetwork();
  const fee=await provider.getFeeData();
  if (network.chainId!==6423n || fee.gasPrice!==40000000000000n || fee.maxFeePerGas!==null) throw new Error('fee/network mismatch');
  const tx=await wallet.sendTransaction({to:recipient,value:ethers.parseEther('2'),type:0});
  const receipt=await tx.wait(1,10000);
  const readback=await provider.getTransaction(tx.hash);
  // Disable provider cache for the final authoritative balance comparison.
  const after=BigInt(await provider.send('eth_getBalance',[wallet.address,'pending']));
  const received=BigInt(await provider.send('eth_getBalance',[recipient,'pending']));
  if (receipt.status!==1 || receipt.gasUsed!==25000n || receipt.fee!==ethers.parseEther('1') || before-after!==ethers.parseEther('3') || received!==ethers.parseEther('2') || readback.nonce!==0 || readback.hash!==tx.hash) throw new Error('receipt/balance/nonce mismatch');
  const padded=await wallet.sendTransaction({to:recipient,value:ethers.parseEther('2'),type:0,nonce:1,gasLimit:30000n,gasPrice:fee.gasPrice});
  const paddedReceipt=await padded.wait(1,10000);
  const paddedAfter=BigInt(await provider.send('eth_getBalance',[wallet.address,'pending']));
  const paddedCredit=BigInt(await provider.send('eth_getBalance',[recipient,'pending']));
  if(padded.gasLimit!==30000n||paddedReceipt.gasUsed!==25000n||paddedReceipt.gasPrice!==40000000000000n||paddedReceipt.fee!==ethers.parseEther('1')||after-paddedAfter!==ethers.parseEther('3')||paddedCredit-received!==ethers.parseEther('2'))throw new Error('padded gas receipt/balance mismatch');
  console.log(JSON.stringify({ethers:ethers.version,localOnly:true,chainId:network.chainId.toString(),hash:tx.hash,gasPrice:fee.gasPrice.toString(),gasUsed:receipt.gasUsed.toString(),actualFeeWei:receipt.fee.toString(),senderDebitWei:(before-after).toString(),recipientCreditWei:received.toString(),receiptStatus:receipt.status,nonce:readback.nonce,blockNumber:receipt.blockNumber,paddedGas:{hash:padded.hash,gasLimit:padded.gasLimit.toString(),maximumFeeWei:(padded.gasLimit*fee.gasPrice).toString(),gasUsed:paddedReceipt.gasUsed.toString(),effectiveGasPrice:paddedReceipt.gasPrice.toString(),actualFeeWei:paddedReceipt.fee.toString(),senderDebitWei:(after-paddedAfter).toString(),recipientCreditWei:(paddedCredit-received).toString(),receiptStatus:paddedReceipt.status,nativeNonceAfter:2}}));
  provider.destroy();
})().catch(e=>{provider.destroy();console.error(e);process.exitCode=1});
