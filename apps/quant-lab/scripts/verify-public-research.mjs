// --run-stateless explicitly permits one public CPU-only historical backtest.
// Never accesses private sessions, saved workspace, Paper or execution routes.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const origin='https://quant.ynxweb4.com';
if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--run-stateless')throw Error('Use no argument or --run-stateless');
async function request(path,body){
  const response=await fetch(origin+path,{method:body?'POST':'GET',credentials:'omit',redirect:'error',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('public_response_not_json');
  return {receipt:{path,method:body?'POST':'GET',status:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},value:JSON.parse(bytes.toString())};
}
const status=await request('/api/v1/public/status'),ready=await request('/api/ready');
const report={observedAt:new Date().toISOString(),scope:'PUBLIC_STATELESS_RESEARCH_NOT_PRIVATE_WORKSPACE',statusReceipt:status.receipt,publicStatus:status.value,readyReceipt:ready.receipt,readiness:ready.value,statelessBacktestVerified:false,privateWorkspaceVerified:false,walletApproved:false,paperOrdersSubmitted:false,testnetOrdersSubmitted:false,visibleBrowserResultVerified:false};
assert.equal(status.receipt.status,200);assert.equal(status.value.mode,'public_stateless_research');assert.equal(status.value.capabilities?.liveFunds,false);assert.equal(status.value.capabilities?.paper,false);assert.equal(status.value.capabilities?.testnetExecution,false);
if(process.argv[2]==='--run-stateless'){
  assert.equal(status.value.capabilities.research,true);assert.equal(status.value.marketData?.synthetic,false);
  const body={strategy:{id:'ma-'+randomUUID(),name:'Public CPU-only provenance verification',family:'transparent',license:'Apache-2.0',seed:7,params:{fast:3,slow:8}},assumptions:{feeBPS:10,slippageBPS:5,latencyBars:1,participationBPS:1000,seed:7,trainEnd:24,walkForwardWindows:3}};
  const result=await request('/api/v1/public/research/backtests/from-market',body);
  // Emit the network receipt before any semantic assertion so verifier bugs
  // cannot erase evidence of an already-executed stateless request.
  console.log(JSON.stringify({kind:'STATELESS_RESPONSE_RECEIPT',...result.receipt}));
  assert.equal(result.receipt.status,201);assert.equal(result.value.status,'completed_oos');
  const strategy=result.value.strategy;
  assert.equal(strategy?.ID,body.strategy.id);assert.equal(strategy?.Name,body.strategy.name);
  assert.equal(strategy?.Seed,7);assert.equal(strategy?.Params?.fast,3);assert.equal(strategy?.Params?.slow,8);
  for(const [key,value] of Object.entries({FeeBPS:10,SlippageBPS:5,LatencyBars:1,ParticipationBPS:1000,Seed:7,TrainEnd:24,WalkForwardWindows:3}))assert.equal(result.value.assumptions?.[key],value);
  assert.ok(typeof strategy.Source==='string'&&strategy.Source.trim());
  assert.ok(Array.isArray(result.value.equityCurve)&&result.value.equityCurve.length>1);
  report.backtest={request:body,receipt:result.receipt,id:result.value.id,status:result.value.status,source:strategy.Source,split:strategy.Split,metrics:result.value.metrics,equityPoints:result.value.equityCurve.length};
  report.statelessBacktestVerified=true;
}
report.multiInstanceReady=ready.receipt.status===200&&ready.value.storage?.backend==='postgresql'&&ready.value.storage?.multiInstance===true;
console.log(JSON.stringify(report,null,2));
