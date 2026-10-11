import {randomUUID} from 'node:crypto';
import {exactObject, multiError} from './multichain-config.mjs';
import {effectiveFamilyNetworks} from './multichain-family-defaults.mjs';
import {BitcoinReadAdapter, BitcoinSigningAdapter, createBitcoinPreview} from './multichain-bitcoin.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
const fail=code=>{throw multiError(code,'Review the original Bitcoin request and its network.');};
export class FamilyBitcoinTransfer {
  constructor({networks,accounts,journal,getContext,now=Date.now,id=randomUUID,createReader=network=>new BitcoinReadAdapter({network:network.network,request:createFamilyReadTransport({family:'bitcoin',networkId:network.network,baseURL:network.rpcUrl})})}){Object.assign(this,{networks,accounts,journal,getContext,now,id,createReader});this.busy=false;}
  async prepare(input){
    exactObject(input,['network','to','amount','feeRateSatPerVbyte','maxFeeSats']);
    if(this.busy)fail('MULTICHAIN_BUSY');
    // Caller never supplies UTXOs, public keys, PSBT, account or transaction ID.
    const original=structuredClone(input);
    this.busy=true;let permit;
    try{
      const context=await this.getContext();if(!context.account||context.locked||context.authenticating)fail('MULTICHAIN_LOCKED');
      const before=await this.networks.read(),network=effectiveFamilyNetworks(before).networks.find(n=>n.family==='bitcoin'&&n.network===original.network);
      if(!network)fail('FAMILY_NETWORK_REQUIRED');
      const live=async()=>{const c=await this.getContext();if(c.locked||c.authenticating||c.account!==context.account||c.revision!==context.revision||(await this.networks.read()).revision!==before.revision)fail('MULTICHAIN_CONTEXT_CHANGED');};
      await live();const account=await this.accounts.account({family:'bitcoin',network:network.network,index:0,account:0});await live();
      if(account.vaultAccount!==context.account||account.family!=='bitcoin'||account.network!==network.network)fail('FAMILY_ACCOUNT_CHANGED');
      const reader=await this.createReader(network),read=await reader.readAddress(account.address);await live();
      if(read.address!==account.address||read.network!==network.network)fail('FAMILY_ACCOUNT_CHANGED');
      const request={requestId:this.id(),network:network.network,from:account.address,to:original.to,changeAddress:account.changeAddress,amount:original.amount,feeRateSatPerVbyte:original.feeRateSatPerVbyte,utxos:read.utxos.map(u=>({txid:u.txid,vout:u.vout,value:u.valueSats,status:{confirmed:u.status.confirmed,block_height:u.status.blockHeight,block_hash:u.status.blockHash}}))};
      const preview=createBitcoinPreview(request),proofs=await reader.fetchPrevoutProofs(preview.inputs);await live();
      // Build and verify the exact original PSBT/prevouts without accessing a
      // signer. This private adapter is retired after this preparation phase.
      const expiresAt=this.now()+120000,validator=new BitcoinSigningAdapter({now:this.now});
      validator.prepare({request,publicKey:Buffer.from(account.publicKey,'hex'),changePublicKey:Buffer.from(account.changePublicKey,'hex'),...proofs,expiresAt,maxFeeSats:original.maxFeeSats});validator.cancel(request.requestId);
      const operation={previewRequest:request,publicKey:account.publicKey,changePublicKey:account.changePublicKey,previousTransactions:proofs.previousTransactions,maxFeeSats:original.maxFeeSats};
      await live();permit=await this.journal.reserve({id:request.requestId,family:'bitcoin',networkId:network.network,account:context.account,request:{network,operation},outpoints:preview.inputs.map(i=>`${i.txid}:${i.vout}`)});await live();
      return {id:request.requestId,family:'bitcoin',network:network.network,vaultAccount:context.account,configRevision:before.revision,endpoint:network.rpcUrl,from:account.address,to:request.to,amount:request.amount,changeAddress:request.changeAddress,feeSats:preview.feeSats,maxFeeSats:original.maxFeeSats,estimatedVbytes:preview.estimatedVbytes,outputs:preview.outputs,expiresAt,state:'prepared',signingSupported:false,broadcastSupported:false};
    }catch(error){if(permit)await permit.cancelBeforeSigning().catch(()=>{});throw error;}finally{permit?.retire();this.busy=false;}
  }
  async cancel(input){
    exactObject(input,['id']);const context=await this.getContext();
    if(!context.account)fail('FAMILY_ACCOUNT_CHANGED');
    const record=await this.journal.cancelPrepared(input.id,context.account);
    return {id:record.id,family:record.family,network:record.networkId,state:record.state};
  }
}
