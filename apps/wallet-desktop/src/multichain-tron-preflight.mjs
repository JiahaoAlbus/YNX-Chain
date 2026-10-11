import {utils as tronUtils} from 'tronweb';
import {tronNetwork, tronAddress, tronBalance, tronResources, tronIntentPreview,
  buildTronUnsigned, trc20Balance, trc20Decimals, trc20Parameter, tronDerivationPath} from './multichain-tron.mjs';

// Read-only node observations, never signing/broadcasting or accepting a node's
// unsigned transaction. The parent must bind this review to its vault session
// and refresh after expiry; no atomic-state or consensus-finality claim is made.
export const TRON_PREFLIGHT_ROUTES = Object.freeze({head:'/wallet/getnowblock', parameters:'/wallet/getchainparameters',
  estimate:'/wallet/estimateenergy', simulation:'/wallet/triggerconstantcontract'});
const MAX = 9223372036854775807n;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value,'Error')) fail('TRON_PREFLIGHT_RPC_INVALID'); return value; }
function uint(value, max=MAX) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || value < 0) fail('TRON_PREFLIGHT_INTEGER_INVALID'); value=String(value); }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length>80) fail('TRON_PREFLIGHT_INTEGER_INVALID');
  const n=BigInt(value); if (n>max) fail('TRON_PREFLIGHT_INTEGER_INVALID'); return n;
}
function freeze(value) { if (value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function parameters(body) {
  object(body); if (!Array.isArray(body.chainParameter) || body.chainParameter.length>256) fail('TRON_CHAIN_PARAMETERS_INVALID');
  const out=new Map(); for (const entry of body.chainParameter) {
    object(entry); if (typeof entry.key!=='string' || out.has(entry.key)) fail('TRON_CHAIN_PARAMETERS_INVALID');
    // java-tron may return signed protocol flags, e.g.
    // getRemoveThePowerOfTheGr=-1. Validate the protocol's signed int64
    // representation here; only parameters actually consumed as prices,
    // limits or rates must be unsigned. Never clamp a negative price to zero.
    let value=entry.value??0;
    if(typeof value==='number'){
      if(!Number.isSafeInteger(value))fail('TRON_PREFLIGHT_INTEGER_INVALID');
      value=String(value);
    }
    if(typeof value!=='string'||! /^(0|-?[1-9][0-9]*)$/.test(value)||value.length>20)fail('TRON_PREFLIGHT_INTEGER_INVALID');
    const n=BigInt(value);
    if(n< -9223372036854775808n||n>MAX)fail('TRON_PREFLIGHT_INTEGER_INVALID');
    out.set(entry.key,value);
  }
  return key=>{ if (!out.has(key)) fail('TRON_CHAIN_PARAMETER_MISSING'); return uint(out.get(key)); };
}
function reference(body, now) {
  object(body); const header=object(object(body.block_header).raw_data), number=uint(header.number);
  const timestamp=uint(header.timestamp), blockID=body.blockID;
  if (typeof blockID!=='string' || !/^[0-9a-fA-F]{64}$/.test(blockID) || BigInt('0x'+blockID.slice(0,16))!==number) fail('TRON_REFERENCE_MISMATCH');
  if (timestamp>BigInt(now) || BigInt(now)-timestamp>60000n) fail('TRON_PREFLIGHT_STALE_HEAD');
  return {number:number.toString(),timestamp:timestamp.toString(),blockID:blockID.toLowerCase()};
}
function ownerPermission(account, owner) {
  object(account); if (tronAddress(account.address).hex!==owner) fail('TRON_ACCOUNT_MISMATCH');
  if (account.type!==undefined && account.type!==0 && account.type!=='Normal') fail('TRON_OWNER_ACCOUNT_UNSUPPORTED');
  const p=object(account.owner_permission);
  if ((p.id??0)!==0 || ![0,'Owner'].includes(p.type??0) || uint(p.threshold)!==1n || !Array.isArray(p.keys) || p.keys.length!==1 ||
    tronAddress(p.keys[0]?.address).hex!==owner || uint(p.keys[0]?.weight)!==1n || p.operations!==undefined) fail('TRON_OWNER_PERMISSION_UNSUPPORTED');
}
function success(body) {
  object(body); const result=object(body.result);
  if (result.result!==true || (result.code!==undefined && result.code!==0 && result.code!=='SUCCESS')) fail('TRON_SIMULATION_FAILED');
}
function simulation(body) {
  success(body);
  // Require explicit ABI bool true. Empty/nonstandard returns do not mean success.
  if (!Array.isArray(body.constant_result) || body.constant_result.length!==1 || body.constant_result[0]!== '0'.repeat(63)+'1') fail('TRON_SIMULATION_FAILED');
  const ret=body.transaction?.ret;
  if (!Array.isArray(ret) || ret.length!==1 || (ret[0].ret===undefined && ret[0].contractRet===undefined) ||
    (ret[0].ret!==undefined && !['SUCCESS','SUCESS'].includes(ret[0].ret)) ||
    (ret[0].contractRet!==undefined && ret[0].contractRet!=='SUCCESS')) fail('TRON_SIMULATION_FAILED');
  const energy=uint(body.energy_used); if (!energy) fail('TRON_ENERGY_ESTIMATE_INVALID'); return energy;
}
export class TronPreflight {
  #network; #transport; #now;
  constructor({network,transport,now=Date.now}) {
    this.#network=tronNetwork(network); if (typeof transport!=='function' || typeof now!=='function') fail('TRON_PREFLIGHT_CONFIG_INVALID');
    this.#transport=transport; this.#now=now;
  }
  async prepare(input) {
    object(input); const {owner,to,asset='trx',amount,decimals=6,contract,derivationIndex=0,permissionId=0,feeLimitSun,maxFeeSun}=input;
    if (permissionId!==0) fail('TRON_PERMISSION_UNSUPPORTED'); tronDerivationPath(derivationIndex);
    const intent=tronIntentPreview({network:this.#network,owner,to,asset,amount,decimals,...(contract!==undefined?{contract}:{})});
    const maxFee=uint(maxFeeSun); if (!maxFee) fail('TRON_FEE_BUDGET_REQUIRED');
    const requestedFee=feeLimitSun===undefined?null:uint(feeLimitSun,BigInt(Number.MAX_SAFE_INTEGER));
    if (asset==='trx' && requestedFee!==null && requestedFee!==0n) fail('TRON_FEE_INVALID');
    const started=Number(uint(this.#now(),BigInt(Number.MAX_SAFE_INTEGER)));
    const read=async(endpoint,body)=>{
      let response; try { response=await this.#transport(endpoint,body,this.#network); }
      catch { fail('TRON_PREFLIGHT_READ_UNAVAILABLE'); } // no arbitrary remote error/credentials in review
      return object(response);
    };
    const genesis=await read('/wallet/getblockbynum',{num:0});
    if (genesis.blockID?.toLowerCase()!==this.#network.genesisBlockId || uint(object(object(genesis.block_header).raw_data).number??0)!==0n) fail('TRON_NETWORK_MISMATCH');
    const from=await read('/wallet/getaccount',{address:intent.owner,visible:false});
    const fromBalance=tronBalance(from,intent.owner); if (!fromBalance.activated) fail('TRON_OWNER_NOT_ACTIVATED'); ownerPermission(from,intent.owner);
    const recipient=await read('/wallet/getaccount',{address:intent.to,visible:false});
    const recipientBalance=tronBalance(recipient,intent.to);
    if (recipientBalance.activated && recipient.type!==undefined && recipient.type!==0 && recipient.type!=='Normal') fail('TRON_RECIPIENT_ACCOUNT_UNSUPPORTED');
    // TRC20 does not activate a TRON account. Until explicit user-facing support
    // exists, refuse this case rather than silently treating it as TRX activation.
    if (asset==='trc20' && !recipientBalance.activated) fail('TRON_TRC20_RECIPIENT_NOT_ACTIVATED');
    const resourceBody=await read('/wallet/getaccountresource',{address:intent.owner,visible:false});
    const resources=tronResources(resourceBody);
    const get=parameters(await read(TRON_PREFLIGHT_ROUTES.parameters,{}));
    const bandwidthPrice=get('getTransactionFee'); if (!bandwidthPrice) fail('TRON_CHAIN_PARAMETERS_INVALID');
    let energyUnits=0n, energySun=0n, energyFeeLimit=0n;
    if (asset==='trc20') {
      const call=(function_selector,parameter='')=>({owner_address:intent.owner,contract_address:intent.contract,function_selector,parameter,visible:false});
      const actualDecimals=trc20Decimals(await read(TRON_PREFLIGHT_ROUTES.simulation,call('decimals()')));
      if (actualDecimals!==intent.decimals) fail('TRON_DECIMALS_MISMATCH');
      const balance=trc20Balance(await read(TRON_PREFLIGHT_ROUTES.simulation,call('balanceOf(address)',intent.owner.slice(2).padStart(64,'0'))),actualDecimals);
      if (BigInt(balance.units)<BigInt(intent.units)) fail('TRON_TOKEN_BALANCE_INSUFFICIENT');
      const transfer=call('transfer(address,uint256)',trc20Parameter(intent.to,intent.units));
      const used=simulation(await read(TRON_PREFLIGHT_ROUTES.simulation,transfer));
      const estimate=await read(TRON_PREFLIGHT_ROUTES.estimate,transfer); success(estimate);
      const estimated=uint(estimate.energy_required); if (!estimated) fail('TRON_ENERGY_ESTIMATE_INVALID');
      const enabled=get('getAllowDynamicEnergy'); if (enabled>1n) fail('TRON_CHAIN_PARAMETERS_INVALID');
      const factor=enabled?get('getDynamicEnergyMaxFactor'):0n;
      if (factor>100000n) fail('TRON_CHAIN_PARAMETERS_INVALID');
      // Both estimators include present penalties. Multiplying by max possible
      // dynamic factor is deliberately an over-bound, never subtracting subsidy
      // or stake that can change before inclusion. No exact fee claim is made.
      energyUnits=((used>estimated?used:estimated)*(10000n+factor)+9999n)/10000n;
      const price=get('getEnergyFee'); if (!price) fail('TRON_CHAIN_PARAMETERS_INVALID');
      energySun=energyUnits*price;
      energyFeeLimit=requestedFee??energySun;
      if (energyFeeLimit<energySun || energyFeeLimit>get('getMaxFeeLimit') || energyFeeLimit>BigInt(Number.MAX_SAFE_INTEGER)) fail('TRON_ENERGY_FEE_LIMIT_INSUFFICIENT');
      // A higher caller-provided fee_limit authorizes up to that Energy budget;
      // reserve it, not just the lower simulated requirement, under maxFeeSun.
      energySun=energyFeeLimit;
    }
    const now=Number(uint(this.#now(),BigInt(Number.MAX_SAFE_INTEGER)));
    if (now<started || now-started>10000) fail('TRON_PREFLIGHT_STALE_OBSERVATIONS');
    const head=reference(await read(TRON_PREFLIGHT_ROUTES.head,{}),now);
    const finished=Number(uint(this.#now(),BigInt(Number.MAX_SAFE_INTEGER)));
    if (finished<now || finished-started>10000) fail('TRON_PREFLIGHT_STALE_OBSERVATIONS');
    const context={network:this.#network,reference:head,timestamp:finished,expiration:finished+60000,feeLimitSun:energyFeeLimit.toString(),permissionId:0,derivationIndex};
    const transaction=buildTronUnsigned(intent,context,finished);
    // Protocol serialized signed envelope: one 65-byte signature (tag + length),
    // then 64-byte maximum result per sole contract, as java-tron charges.
    const pb=tronUtils.transaction.txJsonToPb(transaction);
    const bandwidthBytes=BigInt(pb.serializeBinary().length+67+64);
    const activationSun=recipientBalance.activated?0n:get('getCreateNewAccountFeeInSystemContract');
    // Never sum stake/free pools. Reserve full burn despite reported resources:
    // they and network free pool can be consumed before inclusion.
    const bandwidthSun=recipientBalance.activated?bandwidthBytes*bandwidthPrice:get('getCreateAccountFee');
    if (!recipientBalance.activated && get('getCreateNewAccountBandwidthRate')===0n) fail('TRON_CHAIN_PARAMETERS_INVALID');
    const total=bandwidthSun+energySun+activationSun;
    if (total>MAX || total>maxFee) fail('TRON_FEE_BUDGET_EXCEEDED');
    if (BigInt(fromBalance.sun)<total+(asset==='trx'?BigInt(intent.units):0n)) fail('TRON_TRX_BALANCE_INSUFFICIENT');
    return freeze({intent,context,transaction,fees:{bandwidthSun:bandwidthSun.toString(),energySun:energySun.toString(),activationSun:activationSun.toString(),totalSun:total.toString(),energyUnits:energyUnits.toString(),bandwidthBytes:bandwidthBytes.toString(),budgetScope:'provider-upper-bound'},
      resources,ownerActivated:true,recipientActivated:recipientBalance.activated,networkId:this.#network.id,networkGenesis:this.#network.genesisBlockId,
      verification:'provider-reported-not-consensus',budgetGuaranteed:false,expiresAt:context.expiration,broadcastAuthorized:false});
  }
}
