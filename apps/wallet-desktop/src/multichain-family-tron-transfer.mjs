import {randomUUID} from 'node:crypto';
import {exactObject,multiError} from './multichain-config.mjs';
import {effectiveFamilyNetworks} from './multichain-family-defaults.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
import {FamilyOperationGate} from './multichain-family-operation-gate.mjs';
import {tronAddress,tronIntentPreview,buildTronUnsigned,TronSignReview} from './multichain-tron.mjs';
const fail=code=>{throw multiError(code,'Review the original TRON request and its network.');};
export class FamilyTronTransfer {
  #reviews=new Map();
  constructor({networks,tokens,accounts,journal,getContext,withMnemonic,getGuard,gate=new FamilyOperationGate(),now=Date.now,id=randomUUID,createPreflight=async network=>{const {TronPreflight}=await import('./multichain-tron-preflight.mjs');return new TronPreflight({network:{id:network.network,genesisBlockId:network.genesis},transport:createFamilyReadTransport({family:'tron',networkId:network.network,baseURL:network.rpcUrl}),now});}}){Object.assign(this,{networks,tokens,accounts,journal,getContext,withMnemonic,getGuard,gate,now,id,createPreflight});}
  async prepare(input){return this.gate.run(()=>this.#prepare(input));}
  async #prepare(input){
    exactObject(input,['network','to','amount','asset','contract','feeLimitSun','maxFeeSun']);const original=structuredClone(input);
    const context=await this.getContext();if(context.locked||context.authenticating||!context.account)fail('MULTICHAIN_LOCKED');
    const before=await this.networks.read(),catalog=await this.tokens.read(),network=effectiveFamilyNetworks(before).networks.find(n=>n.family==='tron'&&n.network===original.network);
    if(!network||!['trx','trc20'].includes(original.asset))fail('FAMILY_NETWORK_REQUIRED');
    const live=async()=>{const active=await this.getContext();if(active.locked||active.authenticating||active.account!==context.account||active.revision!==context.revision||(await this.networks.read()).revision!==before.revision||(await this.tokens.read()).revision!==catalog.revision)fail('MULTICHAIN_CONTEXT_CHANGED');};
    await live();const account=await this.accounts.account({family:'tron',network:network.network,index:0,account:0});await live();
    if(account.vaultAccount!==context.account||account.family!=='tron'||account.network!==network.network)fail('FAMILY_ACCOUNT_CHANGED');
    let token=null;if(original.asset==='trc20'){const contract=tronAddress(original.contract).hex;token=catalog.tokens.find(t=>t.family==='tron'&&t.network===network.network&&t.genesis===network.genesis&&t.contract===contract);if(!token)fail('FAMILY_TOKEN_NOT_FOUND');}
    else if(original.contract!==undefined&&original.contract!==null)fail('TRON_ASSET_INVALID');
    const proposed={network:{id:network.network,genesisBlockId:network.genesis},owner:account.address,to:original.to,asset:original.asset,amount:original.amount,decimals:token?.decimals??6,...(token?{contract:token.contract}:{})};
    const intent=tronIntentPreview(proposed);if(BigInt(intent.units)<=0n)fail('TRON_AMOUNT_INVALID');
    const preflight=await this.createPreflight(network),prepared=await preflight.prepare({owner:account.address,to:original.to,asset:original.asset,amount:original.amount,decimals:proposed.decimals,...(token?{contract:token.contract}:{}),derivationIndex:0,permissionId:0,feeLimitSun:original.feeLimitSun,maxFeeSun:original.maxFeeSun});await live();
    if(prepared.networkId!==network.network||prepared.networkGenesis!==network.genesis||prepared.intent.binding!==intent.binding||prepared.verification!=='provider-reported-not-consensus'||prepared.context.derivationIndex!==0||prepared.context.permissionId!==0)fail('FAMILY_RECOVERY_BINDING');
    const transaction=buildTronUnsigned(intent,prepared.context,this.now());if(JSON.stringify(transaction)!==JSON.stringify(prepared.transaction))fail('FAMILY_RECOVERY_BINDING');
    let permit;try{
      const id=this.id(),expiresAt=Math.min(this.now()+120000,Number(prepared.context.expiration));
      const validator=new TronSignReview({transaction,intent,context:prepared.context,now:this.now()});
      await live();permit=await this.journal.reserve({id,family:'tron',networkId:network.network,account:context.account,request:{network,operation:{intent,context:prepared.context}},outpoints:[]});await live();
      this.#reviews.set(id,{permit,validator,context,configRevision:before.revision,catalogRevision:catalog.revision,expiresAt});
      return {id,family:'tron',network:network.network,vaultAccount:context.account,from:account.address,to:tronAddress(original.to).base58,amount:original.amount,symbol:token?.symbol??'TRX',decimals:proposed.decimals,contract:token?.contract??null,fees:prepared.fees,maxFeeSun:original.maxFeeSun,endpoint:network.rpcUrl,expiresAt,state:'prepared',signingSupported:Boolean(this.withMnemonic&&this.getGuard),broadcastSupported:false};
    }catch(error){if(permit){await permit.cancelBeforeSigning().catch(()=>{});permit.retire();}throw error;}
  }
  invalidate(){for(const [id,entry] of this.#reviews){this.#reviews.delete(id);void entry.permit.cancelBeforeSigning().catch(()=>{}).finally(()=>entry.permit.retire());}}
  async sign(input){return this.gate.run(async()=>{
    exactObject(input,['id']);const entry=this.#reviews.get(input.id);if(!entry||!this.withMnemonic||!this.getGuard||this.now()>=entry.expiresAt)fail('TRON_REQUEST_EXPIRED');this.#reviews.delete(input.id);let begun=false,captured=false;
    const live=async()=>{const active=await this.getContext();if(active.locked||active.authenticating||active.account!==entry.context.account||active.revision!==entry.context.revision||(await this.networks.read()).revision!==entry.configRevision||(await this.tokens.read()).revision!==entry.catalogRevision)fail('MULTICHAIN_CONTEXT_CHANGED');if(this.now()>=entry.expiresAt)fail('TRON_REQUEST_EXPIRED');};
    try{
      await live();const guard=this.getGuard();guard.assert();if(guard.account!==entry.context.account)fail('FAMILY_ACCOUNT_CHANGED');
      begun=true;await entry.permit.beginSigning();await live();guard.assert();
      await entry.validator.signMnemonic({guard,now:this.now,withMnemonic:action=>this.withMnemonic((phrase,identity,keyGuard)=>{if(identity.account!==entry.context.account)fail('FAMILY_ACCOUNT_CHANGED');return action(phrase,identity,keyGuard);}),onProduced:produced=>{entry.permit.capture({txid:produced.txID,produced});captured=true;}});
      await entry.permit.saveProduced();await live();const record=(await this.journal.list()).find(r=>r.id===input.id);
      return {id:record.id,family:'tron',network:record.networkId,state:record.state,txid:record.result.txid,broadcastAuthorized:false};
    }catch(error){if(begun){if(captured)await entry.permit.saveProduced().catch(()=>{});await entry.permit.uncertain().catch(()=>{});throw multiError('FAMILY_SIGNING_OUTCOME_UNKNOWN','Original signing record retained. Check it; never sign again.');}await entry.permit.cancelBeforeSigning().catch(()=>{});throw error;}finally{entry.permit.retire();}
  });}
  async cancel(input){exactObject(input,['id']);const context=await this.getContext();if(!context.account)fail('FAMILY_ACCOUNT_CHANGED');const record=await this.journal.cancelPrepared(input.id,context.account);const entry=this.#reviews.get(input.id);if(entry){this.#reviews.delete(input.id);entry.permit.retire();}return {id:record.id,family:record.family,network:record.networkId,state:record.state};}
}
