import test from 'node:test';
import assert from 'node:assert/strict';
import {TronPreflight} from '../src/multichain-tron-preflight.mjs';
import {verifyTronUnsigned} from '../src/multichain-tron.mjs';
const owner='417e5f4552091a69125d5dfcb7b8c2659029395bdf',to='41'+'22'.repeat(20),contract='41'+'33'.repeat(20);
const network={id:'nile',genesisBlockId:'00'.repeat(32)},now=1700000000000;
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const constant=n=>({result:{result:true},constant_result:[word(n)],transaction:{ret:[{ret:'SUCESS',contractRet:'SUCCESS'}]}});
function fixture(change=()=>{},asset='trx') {
  const data={genesis:{blockID:network.genesisBlockId,block_header:{raw_data:{number:0}}},
    owner:{address:owner,balance:1000000000,owner_permission:{threshold:1,keys:[{address:owner,weight:1}]}},recipient:{address:to,balance:0},
    resources:{NetLimit:5000,NetUsed:10,EnergyLimit:100000,EnergyUsed:1},
    parameters:{chainParameter:Object.entries({getTransactionFee:1000,getEnergyFee:100,getMaxFeeLimit:15000000000,getAllowDynamicEnergy:1,getDynamicEnergyMaxFactor:34000,getCreateNewAccountFeeInSystemContract:1000000,getCreateAccountFee:100000,getCreateNewAccountBandwidthRate:1}).map(([key,value])=>({key,value}))},
    head:{blockID:'0000000000000064'+'12'.repeat(24),block_header:{raw_data:{number:100,timestamp:now-3000}}},
    decimals:constant(6),balance:constant(10000000),simulation:{...constant(1),energy_used:1000},estimate:{result:{result:true},energy_required:1100}};
  change(data); const calls=[];
  const transport=async(endpoint,body,chain)=>{
    assert.deepEqual(chain,network); calls.push({endpoint,body});
    if(endpoint==='/wallet/getblockbynum')return data.genesis;
    if(endpoint==='/wallet/getaccount')return body.address===owner?data.owner:data.recipient;
    if(endpoint==='/wallet/getaccountresource')return data.resources;
    if(endpoint==='/wallet/getchainparameters')return data.parameters;
    if(endpoint==='/wallet/getnowblock')return data.head;
    if(endpoint==='/wallet/estimateenergy')return data.estimate;
    if(endpoint==='/wallet/triggerconstantcontract')return body.function_selector==='decimals()'?data.decimals:body.function_selector==='balanceOf(address)'?data.balance:data.simulation;
    throw Error('unexpected endpoint');
  };
  return {adapter:new TronPreflight({network,transport,now:()=>now}),input:{owner,to,asset,amount:'1',decimals:6,...(asset==='trc20'?{contract}:{}),maxFeeSun:'10000000'},calls,data};
}
test('TRX normal preflight builds canonical original, never uses node transaction',async()=>{
  const f=fixture(),r=await f.adapter.prepare(f.input); verifyTronUnsigned(r.transaction,r.intent,r.context,now);
  assert.equal(r.fees.energySun,'0');assert.equal(r.fees.totalSun,r.fees.bandwidthSun);assert.equal(r.recipientActivated,true);
  assert.equal(r.broadcastAuthorized,false);assert.equal(r.context.expiration,now+60000);assert(Object.isFrozen(r.transaction));
  assert(f.calls.every(c=>!/(broadcast|create|triggerSmart)/i.test(c.endpoint)));
});
test('TRX activation reserves fixed account fees, not free/staked resources',async()=>{
  const f=fixture(d=>{d.recipient={};}),r=await f.adapter.prepare(f.input);
  assert.equal(r.recipientActivated,false);assert.equal(r.fees.activationSun,'1000000');assert.equal(r.fees.bandwidthSun,'100000');assert.equal(r.fees.totalSun,'1100000');
});
test('TRC20 uses strict transfer simulation plus estimate and max dynamic bound',async()=>{
  const f=fixture(()=>{},'trc20'),r=await f.adapter.prepare(f.input);
  assert.equal(r.fees.energyUnits,'4840');assert.equal(r.fees.energySun,'484000');assert.equal(r.context.feeLimitSun,'484000');
  verifyTronUnsigned(r.transaction,r.intent,r.context,now);
  const transfer=f.calls.filter(c=>c.body.function_selector==='transfer(address,uint256)');assert.equal(transfer.length,2);
  assert.equal(transfer[0].body.parameter.length,128);assert.deepEqual(Object.keys(transfer[0].body).sort(),['contract_address','function_selector','owner_address','parameter','visible']);
});
test('network identity and account mismatch rejected before transaction production',async()=>{
  for (const change of [d=>{d.genesis.blockID='01'.repeat(32);},d=>{d.owner.address=to;},d=>{d.recipient.address=owner;}]) {
    const f=fixture(change);await assert.rejects(f.adapter.prepare(f.input));
  }
});
test('single owner only: missing/rotated/multisig/active/unsafe permission rejected',async()=>{
  for(const change of [d=>{delete d.owner.owner_permission;},d=>{d.owner.owner_permission.keys[0].address=to;},d=>{d.owner.owner_permission.keys.push({address:to,weight:1});},d=>{d.owner.owner_permission.threshold=2;},d=>{d.owner.owner_permission.type='Active';},d=>{d.owner.owner_permission.keys[0].weight=2;}]) {
    const f=fixture(change);await assert.rejects(f.adapter.prepare(f.input));
  }
  const f=fixture();await assert.rejects(f.adapter.prepare({...f.input,permissionId:2}));assert.equal(f.calls.length,0);
});
test('zero/unactivated owner, insufficient funds and max fee are explicit failure',async()=>{
  for(const change of [d=>{d.owner={};},d=>{d.owner.balance=100;},d=>{d.owner.balance=0;}]) {const f=fixture(change);await assert.rejects(f.adapter.prepare(f.input));}
  const f=fixture();await assert.rejects(f.adapter.prepare({...f.input,maxFeeSun:'1'}),{code:'TRON_FEE_BUDGET_EXCEEDED'});
  await assert.rejects(f.adapter.prepare({...f.input,maxFeeSun:undefined}));
});
test('chain prices missing/duplicate/unsafe values not guessed or converted to zero',async()=>{
  for(const change of [d=>{d.parameters.chainParameter=[];},d=>{d.parameters.chainParameter.push(d.parameters.chainParameter[0]);},d=>{d.parameters.chainParameter[0].value=9007199254740992;},d=>{d.resources.Error='private node error';}]) {
    const f=fixture(change);await assert.rejects(f.adapter.prepare(f.input));
  }
});
test('head height/TAPOS timestamp stale/future/unsafe rejected',async()=>{
  for(const change of [d=>{d.head.blockID='11'.repeat(32);},d=>{d.head.block_header.raw_data.timestamp=now-60001;},d=>{d.head.block_header.raw_data.timestamp=now+1;},d=>{d.head.block_header.raw_data.number=9007199254740992;}]) {
    const f=fixture(change);await assert.rejects(f.adapter.prepare(f.input));
  }
});
test('TRC20 activation, decimals, balance, false/revert/absent simulation and unsupported estimate fail closed',async()=>{
  for(const change of [d=>{d.recipient={};},d=>{d.decimals=constant(18);},d=>{d.balance=constant(0);},d=>{d.simulation.constant_result=[word(0)];},d=>{d.simulation.transaction.ret[0].contractRet='REVERT';},d=>{delete d.simulation.transaction;},d=>{d.estimate={Error:'unsupported'};},d=>{d.estimate.energy_required=0;},d=>{d.parameters.chainParameter=d.parameters.chainParameter.filter(p=>p.key!=='getDynamicEnergyMaxFactor');}]) {
    const f=fixture(change,'trc20');await assert.rejects(f.adapter.prepare(f.input));
  }
});
test('TRC20 explicit fee limits cover total Energy and obey node/user cap',async()=>{
  const f=fixture(()=>{},'trc20');await assert.rejects(f.adapter.prepare({...f.input,feeLimitSun:'100'}),{code:'TRON_ENERGY_FEE_LIMIT_INSUFFICIENT'});
  await assert.rejects(f.adapter.prepare({...f.input,feeLimitSun:'15000000001'}));
  const r=await f.adapter.prepare({...f.input,feeLimitSun:'1000000'});assert.equal(r.context.feeLimitSun,'1000000');assert.equal(r.fees.energySun,'1000000');
  await assert.rejects(f.adapter.prepare({...f.input,feeLimitSun:'1000000',maxFeeSun:'999999'}),{code:'TRON_FEE_BUDGET_EXCEEDED'});
});
test('input is snapshotted before awaits, endpoint failures do not retry or leak node details',async()=>{
  const f=fixture(),p=f.adapter.prepare(f.input);f.input.amount='999';const r=await p;assert.equal(r.intent.units,'1000000');
  let calls=0;const adapter=new TronPreflight({network,now:()=>now,transport:async()=>{calls++;throw Error('offline');}});
  await assert.rejects(adapter.prepare(f.input),{code:'TRON_PREFLIGHT_READ_UNAVAILABLE'});assert.equal(calls,1);
});
test('elapsed observation budget cannot be silently reused',async()=>{
  const f=fixture();let tick=0;const adapter=new TronPreflight({network,now:()=>now+(tick++?10001:0),transport:async(endpoint,body)=>{
    if(endpoint==='/wallet/getblockbynum')return f.data.genesis;if(endpoint==='/wallet/getaccount')return body.address===owner?f.data.owner:f.data.recipient;
    if(endpoint==='/wallet/getaccountresource')return f.data.resources;if(endpoint==='/wallet/getchainparameters')return f.data.parameters;return f.data.head;
  }});await assert.rejects(adapter.prepare(f.input),{code:'TRON_PREFLIGHT_STALE_OBSERVATIONS'});
});
