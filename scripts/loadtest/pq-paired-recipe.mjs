import path from 'node:path';

export function pqPairedRecipe({sourceRoot,commit,head,dirty,baseAncestor,successFixture,measurementSource,overlaySource,outputDir,n,trial,targetExists=false}){
  if(!/^[0-9a-f]{40}$/.test(commit??'')||head!==commit||dirty!==''||baseAncestor!==true)throw Error('exact clean frozen production descendant required');
  if(!/func\s+pqBatchSuccessDiskSnapshot\s*\(/.test(successFixture??''))throw Error('frozen original-owner success fixture is missing');
  if(!/SubmitPQBatchMeasured\s*\(/.test(measurementSource??'')||!measurementSource.includes('ynx-pq-batch-measurement-v1'))throw Error('frozen production measurement API is missing or incompatible');
  if(![1,16,64].includes(n)||!Number.isInteger(trial)||trial<1||trial>3)throw Error('one bounded N1/16/64 and trial1..3 required');
  for(const p of [sourceRoot,overlaySource,outputDir])if(typeof p!=='string'||!path.isAbsolute(p))throw Error('absolute preparation paths required');
  if(targetExists)throw Error('preserve existing owner test file');
  const target=path.join(sourceRoot,'internal/chain/pq_paired_performance_test.go');
  const overlay=path.join(outputDir,'overlay.json'),output=path.join(outputDir,'pq-paired-result.json');
  return {status:'prepared_only_no_go_or_processes_started',sourceRoot,commit,n,trial,executionAuthorized:false,productionMeasurementVersion:'ynx-pq-batch-measurement-v1',
    overlay:{Replace:{[target]:path.join(outputDir,'pq_paired_performance_test.go.in')}},output,
    command:['go','test','-overlay',overlay,'-p','1','./internal/chain','-run','^TestPQPairedPersistentPerformance$','-count=1','-timeout=90s'],
    environment:{GOMAXPROCS:'1',GOGC:'50',GOMEMLIMIT:'512MiB',YNX_PQ_PAIR_SOURCE_COMMIT:commit,YNX_PQ_PAIR_N:String(n),YNX_PQ_PAIR_TRIAL:String(trial),YNX_PQ_PAIR_OUTPUT:output},
    proposedBudget:{totalMs:120000,privateDataBytes:32*1024*1024,ownedRSSBytes:1024*1024*1024,diskFloorBytes:1073741824,rootDiskReserveBytes:445644800,estimatedCompileDeltaBytes:1073741824,requires:'fresh Root CI/local grant and original resource guards; these proposed bounds are not granted by preparation'},
    interpretation:'Compile/run remains pending. No replacement crypto or correctness fixture. Go overlay adds one isolated performance test without changing source checkout; actual source must remain frozen through execution.'};
}
