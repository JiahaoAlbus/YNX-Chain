import {Interface,Transaction,keccak256} from 'ethers';
import {EVMAdapter,quantity,address} from '../../multichain-evm.mjs';
import {exactObject,multiError,validateNetwork} from '../../multichain-config.mjs';
import {ROUTE,encodeApprove,encodeBurn,encodeMint,decodeAndValidateMessage} from './cctp-wire.mjs';
import {validateCctpBinding} from './cctp-flow.mjs';

const erc20=new Interface(['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const messages=new Interface(['event MessageSent(bytes message)','event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)','function receiveMessage(bytes,bytes) returns(bool)']);
const zero='0x'+'0'.repeat(40);
const hex=n=>'0x'+BigInt(n).toString(16);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const fail=(code,message)=>{throw multiError('CCTP_'+code,message)};
const lower=v=>typeof v==='string'?v.toLowerCase():v;
const uint=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<(1n<<256n);

/** Closed protocol calldata, called only by the original main-process service. */
export function describeCctpAction(cctp){
  exactObject(cctp,['version','intentId','step','binding','proof']);
  if(cctp.version!==1||typeof cctp.intentId!=='string'||!/^[0-9a-f-]{36}$/.test(cctp.intentId)||!['approve','burn','mint'].includes(cctp.step))fail('ACTION_INVALID','Invalid CCTP action.');
  const b=validateCctpBinding(cctp.binding),mint=cctp.step==='mint';
  let data,to;
  if(cctp.step==='approve'){to=ROUTE.source.usdc;data=encodeApprove(b.amountUnits)}
  if(cctp.step==='burn'){to=ROUTE.source.tokenMessenger;data=encodeBurn(b)}
  if(mint){if(!cctp.proof)fail('ATTESTATION_REQUIRED','The original attestation is required.');to=ROUTE.destination.messageTransmitter;data=encodeMint(cctp.proof);decodeAndValidateMessage(cctp.proof.message,{...b,destinationBlockNumber:'0'});}
  if(!mint&&cctp.proof!==null)fail('ACTION_INVALID','Only mint accepts a bound attestation.');
  const network=mint?b.destinationNetwork:b.sourceNetwork;
  const {id,family,...input}=network,validated=validateNetwork(input);
  if(id!==validated.id||family!=='evm')fail('NETWORK_CHANGED','Saved network identity changed.');
  return {network,account:b.account,asset:lower(mint?ROUTE.destination.usdc:ROUTE.source.usdc),to:lower(to),amount:b.amountUnits,value:'0',data:lower(data),maximumFee:mint?b.maxDestinationGasFeeWei:b.maxSourceGasFeeWei};
}

export function validateCctpRecord(record){
  const a=describeCctpAction(record.cctp),tx=record.transaction;
  if(JSON.stringify(record.network)!==JSON.stringify(a.network)||record.account!==a.account||record.asset!==a.asset||record.to!==a.to||record.amount!==a.amount||record.nonce!==tx?.nonce)fail('ACTION_MISMATCH','The CCTP journal does not match its original review.');
  exactObject(tx,['chainId','nonce','to','value','data','gasLimit','gasPrice','type']);
  if(tx.chainId!==a.network.chainId||tx.to!==a.to||tx.value!=='0'||tx.data!==a.data||tx.type!==0||![tx.nonce,tx.gasLimit,tx.gasPrice].every(uint)||BigInt(tx.nonce)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(tx.gasLimit)<21000n||BigInt(tx.gasPrice)===0n||BigInt(tx.gasLimit)*BigInt(tx.gasPrice)>BigInt(a.maximumFee))fail('ACTION_MISMATCH','The exact CCTP calldata, nonce or maximum gas fee changed.');
  return true;
}

export function verifyCctpSignedRecord(raw,record){
  validateCctpRecord(record);const tx=record.transaction,signed=Transaction.from(raw);
  if(!signed.isSigned()||signed.hash!==keccak256(raw)||lower(signed.from)!==record.account||signed.chainId!==BigInt(tx.chainId)||signed.nonce!==Number(tx.nonce)||lower(signed.to)!==tx.to||signed.value!==0n||signed.data!==tx.data||signed.gasLimit!==BigInt(tx.gasLimit)||signed.gasPrice!==BigInt(tx.gasPrice)||signed.type!==0||record.hash&&record.hash!==signed.hash)fail('SIGNED_MISMATCH','Signed bytes do not match the original CCTP review.');
  return true;
}

/** Inherits the original Wallet sign/broadcast implementation and transport. */
export class CctpEVMAdapter extends EVMAdapter {
  async prepareCctp(network,account,cctp){
    const action=describeCctpAction(cctp);
    if(JSON.stringify(network)!==JSON.stringify(action.network)||address(account)!==action.account)fail('ACTION_MISMATCH','CCTP action account or network changed.');
    await this.verify(network);
    const request={from:action.account,to:action.to,value:'0x0',data:action.data};
    await this.#simulate(network,cctp,request);
    const nonce=quantity(await this.call(network,'eth_getTransactionCount',[account,'pending'])),gasPrice=quantity(await this.call(network,'eth_gasPrice')),estimate=quantity(await this.call(network,'eth_estimateGas',[request]));
    if(nonce>BigInt(Number.MAX_SAFE_INTEGER)||gasPrice===0n||estimate<21000n||estimate>10_000_000n)fail('GAS_INVALID','CCTP gas or nonce is outside the supported range.');
    const gasLimit=(estimate*120n+99n)/100n,fee=gasLimit*gasPrice;
    if(fee>BigInt(action.maximumFee))fail('GAS_LIMIT','The transaction fee exceeds the explicit ETH fee limit.');
    const result={amount:action.amount,fee:fee.toString(),transaction:{chainId:network.chainId,nonce:nonce.toString(),to:action.to,value:'0',data:action.data,gasLimit:gasLimit.toString(),gasPrice:gasPrice.toString(),type:0}};
    await this.validateSend(network,{network,account:action.account,asset:action.asset,to:action.to,amount:action.amount,nonce:nonce.toString(),transaction:result.transaction,cctp});
    return result;
  }
  verifySigned(raw,record){return record.cctp?verifyCctpSignedRecord(raw,record):super.verifySigned(raw,record)}
  async #simulate(network,cctp,request){
    const code=await this.call(network,'eth_getCode',[request.to,'latest']);
    if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||/^0x0+$/i.test(code))fail('CONTRACT_MISSING','The pinned CCTP contract is unavailable.');
    const result=await this.call(network,'eth_call',[request,'pending']);
    if(cctp.step==='approve'&&erc20.decodeFunctionResult('approve',result)[0]!==true||cctp.step==='mint'&&messages.decodeFunctionResult('receiveMessage',result)[0]!==true)fail('SIMULATION_REJECTED','The pinned CCTP action rejected simulation.');
    if(cctp.step==='mint'){const block=quantity(await this.call(network,'eth_blockNumber'));decodeAndValidateMessage(cctp.proof.message,{...cctp.binding,destinationBlockNumber:block.toString()})}
  }
  async validateSend(network,record){
    if(!record.cctp)return super.validateSend(network,record);
    validateCctpRecord(record);await this.verify(network);
    const b=record.cctp.binding;
    if(quantity(await this.call(network,'eth_getTransactionCount',[record.account,'pending']))!==BigInt(record.nonce))fail('NONCE_CHANGED','The original nonce changed; do not replace a recorded operation.');
    if(BigInt(await this.balance(network,record.account,null))<BigInt(record.transaction.gasLimit)*BigInt(record.transaction.gasPrice))fail('INSUFFICIENT_GAS','Insufficient test ETH for this exact action.');
    if(record.cctp.step!=='mint'&&BigInt(await this.balance(network,record.account,{address:ROUTE.source.usdc}))<BigInt(b.amountUnits))fail('INSUFFICIENT_USDC','Insufficient original test USDC.');
    if(record.cctp.step==='burn'){
      const raw=await this.call(network,'eth_call',[{to:ROUTE.source.usdc,data:erc20.encodeFunctionData('allowance',[record.account,ROUTE.source.tokenMessenger])},'pending']);
      if(erc20.decodeFunctionResult('allowance',raw)[0]<BigInt(b.amountUnits))fail('APPROVAL_REQUIRED','Wait for the original exact USDC approval.');
    }
    await this.#simulate(network,record.cctp,{from:record.account,to:record.transaction.to,value:'0x0',data:record.transaction.data});
  }
  async reconcile(network,record){
    if(!record.cctp)return super.reconcile(network,record);
    await this.verify(network);this.verifySigned(record.raw,record);
    const receipt=await this.call(network,'eth_getTransactionReceipt',[record.hash]);
    if(receipt===null)return {state:'unknown',receipt:null};
    const tx=await this.call(network,'eth_getTransactionByHash',[record.hash]),block=await this.call(network,'eth_getBlockByNumber',[receipt.blockNumber,false]),expected=record.transaction;
    if(!hash(receipt.transactionHash)||lower(receipt.transactionHash)!==record.hash||!hash(receipt.blockHash)||lower(block?.hash)!==lower(receipt.blockHash)||quantity(block.number)!==quantity(receipt.blockNumber)||!Array.isArray(block.transactions)||block.transactions.filter(h=>lower(h)===record.hash).length!==1||lower(tx?.hash)!==record.hash||lower(tx.from)!==record.account||lower(tx.to)!==expected.to||lower(tx.input)!==expected.data||quantity(tx.nonce)!==BigInt(expected.nonce)||quantity(tx.value)!==0n||quantity(tx.gas)!==BigInt(expected.gasLimit)||quantity(tx.gasPrice)!==BigInt(expected.gasPrice)||quantity(tx.chainId)!==BigInt(expected.chainId)||lower(tx.blockHash)!==lower(receipt.blockHash)||quantity(tx.blockNumber)!==quantity(receipt.blockNumber)||lower(receipt.from)!==record.account||lower(receipt.to)!==expected.to)fail('RECEIPT_MISMATCH','The original CCTP receipt, transaction and block do not match.');
    const status=quantity(receipt.status);if(status>1n)fail('RECEIPT_MISMATCH','Invalid receipt status.');
    if(status===1n)this.#events(record,receipt);
    return {state:status===1n?'included':'reverted',receipt:{hash:record.hash,blockHash:lower(receipt.blockHash),blockNumber:quantity(receipt.blockNumber).toString(),status:Number(status),confirmationScope:'rpc-block-inclusion'}};
  }
  #events(record,receipt){
    const binding=record.cctp.binding;
    const events=(contract,abi,name)=>(receipt.logs??[]).filter(l=>lower(l.address)===lower(contract)&&lower(l.transactionHash)===record.hash&&lower(l.blockHash)===lower(receipt.blockHash)&&l.blockNumber===receipt.blockNumber&&l.removed===false).flatMap(l=>{try{const e=abi.parseLog(l);return e?.name===name?[e]:[]}catch{return []}});
    const one=(list,test)=>{if(list.filter(test).length!==1)fail('EVENT_MISMATCH','The exact CCTP event was not found once in its original receipt.');};
    if(record.cctp.step==='approve')one(events(ROUTE.source.usdc,erc20,'Approval'),e=>lower(e.args.owner)===record.account&&lower(e.args.spender)===lower(ROUTE.source.tokenMessenger)&&e.args.value===BigInt(binding.amountUnits));
    if(record.cctp.step==='burn'){
      one(events(ROUTE.source.messageTransmitter,messages,'MessageSent'),e=>{decodeAndValidateMessage(e.args.message,{...binding,mode:'source'});return true});
      one(events(ROUTE.source.usdc,erc20,'Transfer'),e=>lower(e.args.from)===record.account&&lower(e.args.to)===zero&&e.args.value===BigInt(binding.amountUnits));
    }
    if(record.cctp.step==='mint'){
      const message=record.cctp.proof.message,parsed=decodeAndValidateMessage(message,{...binding,destinationBlockNumber:quantity(receipt.blockNumber).toString()});
      one(events(ROUTE.destination.messageTransmitter,messages,'MessageReceived'),e=>lower(e.args.caller)===record.account&&Number(e.args.sourceDomain)===ROUTE.source.domain&&lower(e.args.nonce)===lower(parsed.nonce)&&lower(e.args.sender)==='0x'+lower(ROUTE.source.tokenMessenger).slice(2).padStart(64,'0')&&Number(e.args.finalityThresholdExecuted)===2000&&lower(e.args.messageBody)==='0x'+message.slice(2+148*2));
      one(events(ROUTE.destination.usdc,erc20,'Transfer'),e=>lower(e.args.from)===zero&&lower(e.args.to)===binding.recipient&&e.args.value===BigInt(parsed.amountReceived));
    }
  }
}
