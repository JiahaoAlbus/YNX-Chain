import {CardError,CHAIN,address,amount,type CoreAuthority,type FundingIntent,type ChainReceipt} from './contracts.ts';
/** Server-side Core reads only. Never sends a transaction or asks a Wallet for access. */
export class RpcCoreAuthority implements CoreAuthority {
  private endpoint:string;
  constructor(endpoint:string){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw Error('Card Core RPC must be a fixed credential-free HTTPS endpoint');this.endpoint=url.href}
  private async rpc(method:string,params:unknown[]=[]):Promise<any>{try{const response=await fetch(this.endpoint,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('RPC HTTP failure');const result=await response.json() as any;if(result.error||!Object.hasOwn(result,'result'))throw Error('RPC response failure');return result.result}catch{throw new CardError('CARD_CORE_UNAVAILABLE',503)}}
  async verify(intent:FundingIntent,hash:string):Promise<ChainReceipt>{
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new CardError('INVALID_TRANSACTION_HASH',400);hash=hash.toLowerCase();
    if(await this.rpc('eth_chainId')!==CHAIN)throw new CardError('WRONG_TESTNET_CHAIN');
    const tx=await this.rpc('eth_getTransactionByHash',[hash]),receipt=await this.rpc('eth_getTransactionReceipt',[hash]);
    if(!tx||!receipt)throw new CardError('TESTNET_TRANSACTION_PENDING');
    if(receipt.status!=='0x1'||String(tx.hash).toLowerCase()!==hash||String(receipt.transactionHash).toLowerCase()!==hash)throw new CardError('TESTNET_TRANSACTION_FAILED');
    if(tx.chainId!==undefined&&BigInt(tx.chainId)!==BigInt(CHAIN))throw new CardError('WRONG_TESTNET_CHAIN');
    if(address(tx.from)!==intent.sender||address(tx.to)!==intent.recipient||address(receipt.from)!==intent.sender||address(receipt.to)!==intent.recipient||BigInt(tx.value)!==amount(intent.amountWei))throw new CardError('TOPUP_TRANSACTION_MISMATCH');
    if(!/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)||!/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)||tx.blockNumber!==receipt.blockNumber||tx.blockHash!==receipt.blockHash)throw new CardError('INVALID_CHAIN_RECEIPT');
    const block=await this.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),head=BigInt(await this.rpc('eth_blockNumber'));
    if(!block||block.hash!==receipt.blockHash||block.number!==receipt.blockNumber)throw new CardError('NON_CANONICAL_TRANSACTION');
    const confirmations=head-BigInt(receipt.blockNumber)+1n;
    if(confirmations<BigInt(intent.minConfirmations)||confirmations>BigInt(Number.MAX_SAFE_INTEGER))throw new CardError('TESTNET_CONFIRMATIONS_PENDING');
    const blockMillis=Number(BigInt(block.timestamp))*1000;
    if(!Number.isSafeInteger(blockMillis)||blockMillis<Date.parse(intent.createdAt)||blockMillis>Date.parse(intent.expiresAt))throw new CardError('TOPUP_INTENT_TIME_MISMATCH');
    const again=await this.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);if(again?.hash!==block.hash)throw new CardError('NON_CANONICAL_TRANSACTION');
    return {chainId:CHAIN,txHash:hash,from:intent.sender,to:intent.recipient,amountWei:intent.amountWei,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,confirmations:Number(confirmations),blockTime:new Date(blockMillis).toISOString()};
  }
}
