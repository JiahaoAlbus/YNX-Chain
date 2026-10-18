import {createHash} from 'node:crypto';

const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const canonicalHash=s=>typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s);
const decimal=s=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&BigInt(s)<=18446744073709551615n;
const frame=b=>{const n=Buffer.alloc(4);n.writeUInt32BE(b.length);return Buffer.concat([n,b])};

// Independent application identity codec. This does not verify a PQ signature.
export function pqBatchMemberHash(batchHash,index){
  if(!canonicalHash(batchHash)||!Number.isInteger(index)||index<0||index>=1024)throw Error('invalid canonical PQ member identity');
  const i=Buffer.alloc(4);i.writeUInt32BE(index);
  const count=Buffer.alloc(4);count.writeUInt32BE(3);
  return hash(Buffer.concat([
    count,frame(Buffer.from('YNX-NATIVE-BATCH-MEMBER/v1')),frame(Buffer.from(batchHash.slice(2),'hex')),frame(i),
  ]));
}

// Count original server claims only. Local durable checkpoint != inclusion or
// BFT finality; neither HTTP success nor shared proof existence fills that gap.
export function classifyPQBatchReceipt(wire,response,expectedMembers){
  if(!Buffer.isBuffer(wire)||wire.length<1||wire.length>8*1024*1024||!Array.isArray(expectedMembers)||expectedMembers.length<1||expectedMembers.length>1024||(expectedMembers.length&(expectedMembers.length-1))!==0)throw Error('PQ receipt input bounds');
  const batchHash=hash(wire);
  if(!response||response.batchHash!==batchHash||response.wireHash!==batchHash||typeof response.replayed!=='boolean'||!decimal(response.executionHeight)||!['durable','memory','uncertain','not_committed','rejected'].includes(response.status)||!Array.isArray(response.results)||response.results.length!==expectedMembers.length)throw Error('PQ receipt batch identity or shape mismatch');
  let admitted=0,rejected=0;
  const members=response.results.map((row,index)=>{
    const expected=expectedMembers[index];
    if(!expected||!['amount','fee','nonce'].every(k=>decimal(expected[k])))throw Error('invalid expected decimal member');
    if(!row||row.index!==index||row.batchHash!==batchHash||row.wireHash!==batchHash||!row.decimalFields||row.decimalFields.executionHeight!==response.executionHeight||!['amount','fee','nonce'].every(k=>row.decimalFields[k]===expected[k])||typeof row.error!=='string')throw Error('PQ receipt member identity or decimals mismatch');
    if(row.outcome==='admitted'){
      if(row.transactionHash!==pqBatchMemberHash(batchHash,index)||row.error!=='')throw Error('PQ admitted member identity mismatch');
      admitted++;
    }else if(row.outcome==='rejected'){
      if(row.transactionHash!==''||row.error==='')throw Error('PQ rejected member has execution identity');
      rejected++;
    }else throw Error('unknown PQ member outcome');
    return {index,outcome:row.outcome,transactionHash:row.transactionHash};
  });
  if((response.status==='rejected'&&(admitted!==0||response.replayed))||(response.status!=='rejected'&&admitted===0))throw Error('PQ batch status inconsistent with member outcomes');
  return {batchHash,status:response.status,replayed:response.replayed,members,serverReportedAdmitted:admitted,serverReportedRejected:rejected,newServerReportedDurableMembers:response.status==='durable'&&!response.replayed?admitted:0,verifiedEffectiveInclusions:null,verifiedFinalCommits:null,interpretation:'Server claims only. Replayed identities are not new business. Independent execution/readback, actual block inclusion and applicable consensus finality are separate evidence.'};
}

// One counter per run. Retain exact hashes up to the caller's explicit bound;
// never evict identities, which would turn a late duplicate into new business.
// This aggregates server claims only and cannot promote them to BFT evidence.
export function createPQReceiptCounter(maxMembers){
  if(!Number.isSafeInteger(maxMembers)||maxMembers<1||maxMembers>1000000)throw Error('PQ counter identity bound');
  const admitted=new Set(),durable=new Set();
  return Object.freeze({observe(wire,response,expectedMembers){
    const receipt=classifyPQBatchReceipt(wire,response,expectedMembers);
    const hashes=receipt.members.filter(m=>m.outcome==='admitted').map(m=>m.transactionHash);
    const unseen=hashes.filter(h=>!admitted.has(h));
    if(admitted.size+unseen.length>maxMembers)throw Error('PQ counter identity bound exceeded; stop run without eviction');
    const newDurable=receipt.status==='durable'?hashes.filter(h=>!durable.has(h)):[];
    // Validation and capacity admission finish before any cumulative mutation.
    for(const h of unseen)admitted.add(h);
    for(const h of newDurable)durable.add(h);
    return {...receipt,newUniqueServerReportedDurableMembers:receipt.replayed?0:newDurable.length,uniqueServerReportedAdmittedMembers:admitted.size,uniqueServerReportedDurableMembers:durable.size,interpretation:'Run-scoped exact hash deduplication of server claims. First-seen durable replays are observed durable identities, never new execution. Inclusion, execution readback and weighted consensus commit verification remain separate.'};
  }});
}
