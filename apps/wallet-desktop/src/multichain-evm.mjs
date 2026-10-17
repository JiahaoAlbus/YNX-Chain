import https from 'node:https';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import {Interface,Wallet,Transaction,keccak256,getAddress} from 'ethers';
import {rpcURL,publicAddress,multiError,validateToken} from './multichain-config.mjs';

const tokenABI=new Interface(['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)','function symbol() view returns (string)','function name() view returns (string)','function transfer(address,uint256) returns (bool)','event Transfer(address indexed from,address indexed to,uint256 value)']);
export function address(value){try{const result=getAddress(value).toLowerCase();if(result==='0x'+'0'.repeat(40))throw Error();return result}catch{throw multiError('MULTICHAIN_ADDRESS_INVALID','Enter a valid nonzero EVM address.')}}
export function quantity(value){if(typeof value!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)||BigInt(value)>=(1n<<256n))throw multiError('MULTICHAIN_RPC_INVALID','RPC returned an invalid quantity.');return BigInt(value)}
export function units(value,decimals){
  if(typeof value!=='string'||value.length>400||!Number.isInteger(decimals)||decimals<0||decimals>255||! /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))throw multiError('MULTICHAIN_AMOUNT_INVALID','Enter a positive decimal amount without rounding.');
  const [whole,fraction='']=value.split('.');if(fraction.length>decimals)throw multiError('MULTICHAIN_PRECISION','Amount has more decimals than this asset.');const result=BigInt(whole+fraction.padEnd(decimals,'0'));if(result===0n||result>=(1n<<256n))throw multiError('MULTICHAIN_AMOUNT_INVALID','Amount is outside the asset range.');return result;
}
export function displayUnits(value,decimals){const n=BigInt(value);if(n<0n||n>=(1n<<256n)||!Number.isInteger(decimals)||decimals<0||decimals>255)throw Error('Invalid asset units');if(!decimals)return n.toString();const padded=n.toString().padStart(decimals+1,'0'),tail=padded.slice(-decimals).replace(/0+$/,'');return padded.slice(0,-decimals)+(tail?'.'+tail:'')}
const hex=n=>'0x'+BigInt(n).toString(16);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
export function verifySignedRecord(raw,record){const signed=Transaction.from(raw),tx=record.transaction;if(!signed.isSigned()||signed.hash!==keccak256(raw)||signed.from?.toLowerCase()!==record.account||signed.chainId!==BigInt(tx.chainId)||signed.nonce!==Number(tx.nonce)||signed.to?.toLowerCase()!==tx.to||signed.value!==BigInt(tx.value)||signed.data!==tx.data||signed.gasLimit!==BigInt(tx.gasLimit)||signed.gasPrice!==BigInt(tx.gasPrice)||signed.type!==0)throw multiError('MULTICHAIN_SIGNED_MISMATCH','Signed bytes do not match the approved transaction.');
  if(record.asset==='native'){if(tx.to!==record.to||tx.value!==record.amount||tx.data!=='0x')throw multiError('MULTICHAIN_SIGNED_MISMATCH','Native transfer details changed.')}else{const transfer=tokenABI.parseTransaction({data:tx.data});if(tx.to!==record.asset||tx.value!=='0'||transfer?.name!=='transfer'||transfer.args[0].toLowerCase()!==record.to||transfer.args[1]!==BigInt(record.amount))throw multiError('MULTICHAIN_SIGNED_MISMATCH','Token transfer details changed.')}if(record.hash&&record.hash!==signed.hash)throw multiError('MULTICHAIN_SIGNED_MISMATCH','Recorded transaction hash changed.');return true;
}

/** Each socket uses the validated DNS result. No redirects, proxy, credential URLs or retries. */
export function publicRPCTransport({request=https.request,dnsLookup=lookup,timeout=12000}={}){
  let nextId=0;
  return async (url,method,params=[])=>{
    const target=new URL(rpcURL(url)),id=++nextId,body=JSON.stringify({jsonrpc:'2.0',id,method,params});
    return new Promise((resolve,reject)=>{
      let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)};
      const lookupPublic=(hostname,options,callback)=>dnsLookup(hostname,{all:true,verbatim:true},(error,records)=>{if(error)return callback(error);if(!records?.length||records.some(r=>!publicAddress(r.address)))return callback(multiError('MULTICHAIN_RPC_PRIVATE','RPC resolved to a non-public address.'));const family=typeof options==='number'?options:options?.family;const filtered=records.filter(r=>!family||r.family===family);if(!filtered.length)return callback(multiError('MULTICHAIN_RPC_PRIVATE','No public RPC address is available.'));if(options?.all)return callback(null,filtered);callback(null,filtered[0].address,filtered[0].family)});
      let req;const timer=setTimeout(()=>{req?.destroy();finish(multiError('MULTICHAIN_RPC_TIMEOUT','RPC outcome is unknown; do not resend a recorded transaction.'))},timeout);
      try{
        const host=target.hostname.replace(/^\[|\]$/g,'');if(isIP(host)&&!publicAddress(host))throw Error('Private RPC');
        req=request(target,{method:'POST',lookup:lookupPublic,agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
          if(response.statusCode!==200){response.resume();finish(multiError('MULTICHAIN_RPC_HTTP','RPC must return HTTP 200 without redirects.'));return}
          let text='',bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>1000000){response.destroy();finish(multiError('MULTICHAIN_RPC_INVALID','RPC response is too large.'))}else text+=chunk});
          response.on('error',()=>finish(multiError('MULTICHAIN_RPC_UNAVAILABLE','RPC response was interrupted.')));
          response.on('end',()=>{try{const result=JSON.parse(text);if(result.jsonrpc!=='2.0'||result.id!==id||Array.isArray(result)||Object.hasOwn(result,'error')===Object.hasOwn(result,'result'))throw Error();if(result.error)throw multiError('MULTICHAIN_RPC_REJECTED','RPC rejected this request.');finish(null,result.result)}catch(e){finish(e.code?e:multiError('MULTICHAIN_RPC_INVALID','RPC returned an invalid envelope.'))}});
        });
        req.on('error',()=>finish(multiError('MULTICHAIN_RPC_UNAVAILABLE','RPC request failed. Recorded sends must be checked, not repeated.')));req.end(body);
      }catch(e){finish(e)}
    });
  };
}

export class EVMAdapter{
  constructor({rpc=publicRPCTransport()}={}){this.rpc=rpc}
  call(network,method,params=[]){return this.rpc(network.rpcUrl,method,params)}
  async verify(network){const chain=await this.call(network,'eth_chainId'),genesis=await this.call(network,'eth_getBlockByNumber',['0x0',false]);if(hex(quantity(chain))!==network.chainId||!hash(genesis?.hash)||genesis.hash.toLowerCase()!==network.genesis)throw multiError('MULTICHAIN_NETWORK_MISMATCH','RPC chain ID or genesis does not match the saved network.');return true}
  async balance(network,account,asset){await this.verify(network);account=address(account);if(!asset)return quantity(await this.call(network,'eth_getBalance',[account,'latest'])).toString();const data=await this.call(network,'eth_call',[{to:asset.address,data:tokenABI.encodeFunctionData('balanceOf',[account])},'latest']);try{return tokenABI.decodeFunctionResult('balanceOf',data)[0].toString()}catch{throw multiError('MULTICHAIN_TOKEN_INVALID','Token balance response is invalid.')}}
  async token(network,input){const contract=address(input.address);await this.verify(network);const code=await this.call(network,'eth_getCode',[contract,'latest']);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||/^0x0+$/.test(code))throw multiError('MULTICHAIN_TOKEN_INVALID','No token contract exists at this address.');
    const metadata={};for(const key of ['decimals','symbol','name']){try{const data=await this.call(network,'eth_call',[{to:contract,data:tokenABI.encodeFunctionData(key,[])},'latest']);const result=tokenABI.decodeFunctionResult(key,data)[0];metadata[key]=key==='decimals'?Number(result):result}catch{metadata[key]=input[key]}}
    return validateToken({networkId:network.id,address:contract,...metadata});
  }
  async prepare(network,account,asset,to,amount){
    await this.verify(network);account=address(account);to=address(to);const value=units(amount,asset?.decimals??18),data=asset?tokenABI.encodeFunctionData('transfer',[to,value]):'0x';
    const request={from:account,to:asset?.address??to,value:hex(asset?0n:value),data};
    if(asset){let accepted;try{accepted=tokenABI.decodeFunctionResult('transfer',await this.call(network,'eth_call',[request,'pending']))[0]}catch{throw multiError('MULTICHAIN_TOKEN_TRANSFER_UNSUPPORTED','This token transfer cannot be safely simulated.')}if(accepted!==true)throw multiError('MULTICHAIN_TOKEN_TRANSFER_REJECTED','The token returned false for this transfer.')}
    const nonce=quantity(await this.call(network,'eth_getTransactionCount',[account,'pending'])),gasPrice=quantity(await this.call(network,'eth_gasPrice')),estimated=quantity(await this.call(network,'eth_estimateGas',[request]));
    if(nonce>BigInt(Number.MAX_SAFE_INTEGER)||gasPrice===0n||estimated<21000n||estimated>100000000n)throw multiError('MULTICHAIN_FEE_INVALID','RPC fee or nonce is outside the supported range.');
    const gasLimit=(estimated*120n+99n)/100n,fee=gasLimit*gasPrice;if(fee>=(1n<<256n))throw multiError('MULTICHAIN_FEE_INVALID','Fee is outside the supported range.');
    const native=BigInt(await this.balance(network,account,null));if(native<(asset?0n:value)+fee)throw multiError('MULTICHAIN_INSUFFICIENT_FEE','Not enough native currency for the amount and maximum fee.');
    if(asset&&BigInt(await this.balance(network,account,asset))<value)throw multiError('MULTICHAIN_INSUFFICIENT_ASSET','Not enough token balance.');
    return {amount:value.toString(),fee:fee.toString(),transaction:{chainId:network.chainId,nonce:nonce.toString(),to:request.to,value:(asset?0n:value).toString(),data:data.toLowerCase(),gasLimit:gasLimit.toString(),gasPrice:gasPrice.toString(),type:0}};
  }
  async sign(secret,record){const tx=record.transaction;const wallet=new Wallet(secret);if(wallet.address.toLowerCase()!==record.account)throw multiError('MULTICHAIN_ACCOUNT_CHANGED','The signing account changed.');const raw=await wallet.signTransaction({...tx,nonce:Number(tx.nonce)});this.verifySigned(raw,record);return {raw,hash:keccak256(raw)}}
  verifySigned(raw,record){return verifySignedRecord(raw,record)}
  async validateSend(network,record){await this.verify(network);if(quantity(await this.call(network,'eth_getTransactionCount',[record.account,'pending']))!==BigInt(record.nonce))throw multiError('MULTICHAIN_NONCE_CHANGED','Pending nonce changed. Review a new transfer without replacing the recorded one.');const fee=BigInt(record.transaction.gasLimit)*BigInt(record.transaction.gasPrice),native=BigInt(await this.balance(network,record.account,null));if(native<fee+BigInt(record.transaction.value))throw multiError('MULTICHAIN_INSUFFICIENT_FEE','Native balance changed.');if(record.asset!=='native'){if(BigInt(await this.balance(network,record.account,{address:record.asset}))<BigInt(record.amount))throw multiError('MULTICHAIN_INSUFFICIENT_ASSET','Token balance changed.');let accepted;try{accepted=tokenABI.decodeFunctionResult('transfer',await this.call(network,'eth_call',[{from:record.account,to:record.transaction.to,value:'0x0',data:record.transaction.data},'pending']))[0]}catch{throw multiError('MULTICHAIN_TOKEN_TRANSFER_UNSUPPORTED','The token transfer could not be simulated.')}if(accepted!==true)throw multiError('MULTICHAIN_TOKEN_TRANSFER_REJECTED','The token returned false for this transfer.')}}
  async broadcast(network,record){this.verifySigned(record.raw,record);const result=await this.call(network,'eth_sendRawTransaction',[record.raw]);if(!hash(result)||result.toLowerCase()!==record.hash)throw multiError('MULTICHAIN_BROADCAST_UNKNOWN','RPC did not return the recorded transaction hash.');return record.hash}
  async reconcile(network,record){
    await this.verify(network);this.verifySigned(record.raw,record);const receipt=await this.call(network,'eth_getTransactionReceipt',[record.hash]);if(receipt===null)return {state:'unknown',receipt:null};
    const tx=await this.call(network,'eth_getTransactionByHash',[record.hash]),block=await this.call(network,'eth_getBlockByNumber',[receipt.blockNumber,false]);
    const expected=record.transaction;
    if(!hash(receipt.transactionHash)||receipt.transactionHash.toLowerCase()!==record.hash||!hash(receipt.blockHash)||!hash(block?.hash)||block.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||quantity(block.number)!==quantity(receipt.blockNumber)||!Array.isArray(block.transactions)||!block.transactions.some(h=>typeof h==='string'&&h.toLowerCase()===record.hash)||tx?.hash?.toLowerCase()!==record.hash||tx.from?.toLowerCase()!==record.account||tx.to?.toLowerCase()!==expected.to||tx.input?.toLowerCase()!==expected.data||quantity(tx.nonce)!==BigInt(expected.nonce)||quantity(tx.value)!==BigInt(expected.value)||quantity(tx.gas)!==BigInt(expected.gasLimit)||quantity(tx.gasPrice)!==BigInt(expected.gasPrice)||quantity(tx.chainId)!==BigInt(expected.chainId)||tx.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase()||quantity(tx.blockNumber)!==quantity(receipt.blockNumber)||receipt.from?.toLowerCase()!==record.account||receipt.to?.toLowerCase()!==expected.to)throw multiError('MULTICHAIN_RECEIPT_UNKNOWN','RPC receipt does not match the recorded transaction and block.');
    const status=quantity(receipt.status);if(status>1n)throw multiError('MULTICHAIN_RECEIPT_UNKNOWN','Receipt status is invalid.');
    if(status===1n&&record.asset!=='native'){
      const transfers=(receipt.logs??[]).filter(log=>log.address?.toLowerCase()===record.asset&&log.transactionHash?.toLowerCase()===record.hash&&log.blockHash?.toLowerCase()===receipt.blockHash.toLowerCase()&&log.blockNumber===receipt.blockNumber&&log.removed===false).flatMap(log=>{try{const event=tokenABI.parseLog(log);return event?.name==='Transfer'?[event]:[]}catch{return []}});
      if(transfers.filter(event=>event.args.from.toLowerCase()===record.account&&event.args.to.toLowerCase()===record.to&&event.args.value===BigInt(record.amount)).length!==1)throw multiError('MULTICHAIN_TOKEN_RECEIPT_UNKNOWN','The exact token Transfer event could not be verified.');
    }
    return {state:status===1n?'included':'reverted',receipt:{hash:record.hash,blockHash:receipt.blockHash.toLowerCase(),blockNumber:quantity(receipt.blockNumber).toString(),status:Number(status),confirmationScope:'rpc-block-inclusion'}};
  }
}
