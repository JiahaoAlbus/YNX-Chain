// Read-only projection of the already owner-bound native workspace snapshot.
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=1024;
const time=value=>text(value)&&Number.isFinite(Date.parse(value));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=Number.isSafeInteger;
const safeNumbers=(value,depth=0)=>depth<=32&&(typeof value==='number'?integer(value):Array.isArray(value)?value.length<=100001&&value.every(item=>safeNumbers(item,depth+1)):record(value)?Object.values(value).every(item=>safeNumbers(item,depth+1)):value===null||['string','boolean'].includes(typeof value));
export function nativeHistoryPage(snapshot){
 const value=snapshot?.history;if(value===undefined)return null;
 const keys=value?.version==='bounded_v2'?['audit','experiments','orders','strategies']:['audit','experiments','orders'];
 if(!record(value)||!['bounded_v1','bounded_v2'].includes(value.version)||!text(value.revision)||!integer(value.offset)||value.offset<0||value.offset>Number.MAX_SAFE_INTEGER-20||value.offset%20!==0||value.pageSize!==20||typeof value.hasNext!=='boolean'||!record(value.counts)||Object.keys(value.counts).sort().join(',')!==keys.join(',')||!keys.every(key=>integer(value.counts[key])&&value.counts[key]>=0))return false;
 if(value.version==='bounded_v2'&&(!record(snapshot.strategies)||Object.keys(snapshot.strategies).length!==Math.min(20,Math.max(0,value.counts.strategies-value.offset))))return false;
 if(value.hasNext!==(value.offset+20<Math.max(...Object.values(value.counts))))return false;
 return value;
}
export function nativeSavedDetail(reply,id,revision){
 const value=reply?.experiment,projection=reply?.curveProjection;
 if(reply?.revision!==revision||value?.id!==id||!record(projection)||projection.policy!=='saved_points_endpoint_preserving_v1'||!integer(projection.originalPoints)||projection.originalPoints<0||projection.originalPoints>100001||!integer(projection.returnedPoints)||projection.returnedPoints!==Math.min(200,projection.originalPoints)||value.equityCurve?.length!==projection.returnedPoints)return null;
 const model=nativePaperHistory({ready:true,status:'connected',account:reply.account},{account:reply.account,paper:{Orders:[]},experiments:{[id]:value},audit:[]});
 if(model.status!=='ready'||model.invalid||(projection.returnedPoints>=2&&!nativeEquityCurve(value)))return null;
 return {...value,curveProjection:projection};
}
export function nativePaperHistory(session,snapshot){
 const empty={status:'unavailable',orders:[],experiments:[],audit:[],invalid:0};
 if(!session?.ready||session.status!=='connected'||!session.account||snapshot?.account!==session.account)return empty;
 if(!record(snapshot.paper)||!record(snapshot.experiments)||!Array.isArray(snapshot.audit)||!(snapshot.paper.Orders===null||Array.isArray(snapshot.paper.Orders)))return {...empty,status:'invalid'};
 if(nativeHistoryPage(snapshot)===false)return {...empty,status:'invalid'};
 const orders=snapshot.paper.Orders||[],experiments=Object.entries(snapshot.experiments),audit=snapshot.audit;
 if(orders.length>100||experiments.length>10000||audit.length>100000)return {...empty,status:'invalid'};
 let invalid=0;const seen=new Set();
 const validOrders=orders.filter(row=>{const valid=record(row)&&safeNumbers(row)&&/^paper-[0-9]+$/.test(row.ID)&&!seen.has(row.ID)&&hash(row.StrategyHash)&&['buy','sell'].includes(row.Side)&&['open','filled','partially_filled','cancelled'].includes(row.Status)&&integer(row.Amount)&&row.Amount>0&&integer(row.Filled)&&row.Filled>=0&&row.Filled<=row.Amount&&(row.Status==='filled'?row.Filled===row.Amount:row.Status==='open'?row.Filled===0:row.Status==='partially_filled'?row.Filled>0&&row.Filled<row.Amount:true)&&integer(row.Price)&&row.Price>0&&time(row.CreatedAt)&&text(row.Source)&&(!row.CostPolicy||(row.CostPolicy==='adverse_price_ceil_fee_micro_v1'&&integer(row.FeeBPS??0)&&(row.FeeBPS??0)>=0&&(row.FeeBPS??0)<=10000&&integer(row.SlippageBPS??0)&&(row.SlippageBPS??0)>=0&&(row.SlippageBPS??0)<10000&&integer(row.ExecutionPriceMicro)&&row.ExecutionPriceMicro>0&&integer(row.ExecutedNotionalMicro??0)&&(row.ExecutedNotionalMicro??0)>=0&&integer(row.FeeMicro??0)&&(row.FeeMicro??0)>=0));if(valid)seen.add(row.ID);else invalid++;return valid;});
 const validExperiments=experiments.filter(([id,row])=>{const metrics=row?.metrics;const valid=record(row)&&safeNumbers(row)&&row.id===id&&text(id)&&row.status==='completed_oos'&&time(row.createdAt)&&record(row.strategy)&&hash(row.strategy.StrategyHash)&&record(metrics)&&['ReturnBPS','BuyHoldBPS','MaxDrawdownBPS','SharpeMilli','VolatilityBPS','Trades','PartialFills','DataGaps'].every(key=>integer(metrics[key]))&&['MaxDrawdownBPS','VolatilityBPS','Trades','PartialFills','DataGaps'].every(key=>metrics[key]>=0)&&record(row.metricDefinitions)&&['returnBPS','buyHoldBPS','maxDrawdownBPS','sharpeMilli','volatilityBPS'].every(key=>text(row.metricDefinitions[key]));if(!valid)invalid++;return valid;}).map(([,row])=>row);
 const auditSeen=new Set();const validAudit=audit.filter(row=>{const valid=record(row)&&integer(row.Sequence)&&row.Sequence>0&&!auditSeen.has(row.Sequence)&&text(row.Action)&&text(row.ObjectID)&&hash(row.Digest)&&hash(row.Hash)&&time(row.CreatedAt);if(valid)auditSeen.add(row.Sequence);else invalid++;return valid;});
 const recent=(rows,field)=>[...rows].sort((a,b)=>Date.parse(b[field])-Date.parse(a[field]));
 return {status:'ready',account:session.account,orders:recent(validOrders,'CreatedAt'),experiments:recent(validExperiments,'createdAt'),audit:[...validAudit].sort((a,b)=>b.Sequence-a.Sequence),invalid};
}

// Presentation only: deterministic BigInt normalization of actual saved equity,
// not a new risk/return calculation or synthetic replacement series.
export function nativeEquityCurve(experiment){
 const rows=experiment?.equityCurve;
 if(!Array.isArray(rows)||rows.length<2||rows.length>100001)return null;
 let previous=-Infinity,min=null,max=null;
 for(const row of rows){if(!record(row)||!time(row.time)||!integer(row.equity)||!integer(row.benchmarkEquity)||Date.parse(row.time)<=previous)return null;previous=Date.parse(row.time);for(const value of [row.equity,row.benchmarkEquity]){const n=BigInt(value);min=min===null||n<min?n:min;max=max===null||n>max?n:max;}}
 const range=max-min||1n,indices=[];for(let n=0;n<Math.min(200,rows.length);n++)indices.push(Math.round(n*(rows.length-1)/(Math.min(200,rows.length)-1)));
 const firstTime=BigInt(Date.parse(rows[0].time)),span=BigInt(Date.parse(rows.at(-1).time))-firstTime;
 const points=key=>indices.map(index=>`${20+Number((BigInt(Date.parse(rows[index].time))-firstTime)*720n/span)},${180-Number((BigInt(rows[index][key])-min)*160n/range)}`).join(' ');
 return {equity:points('equity'),benchmark:points('benchmarkEquity'),first:rows[0].time,last:rows.at(-1).time,total:experiment.curveProjection?.originalPoints??rows.length,displayed:indices.length};
}
