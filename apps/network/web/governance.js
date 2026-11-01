(function (root) {
  'use strict';
  // Fixed helper read reports only. Neither a registry label nor a body digest
  // establishes chain finality, voting eligibility or Wallet approval.
  const VERSION = 'ynx-governance-api/v1';
  const SOURCE = 'ynx-governance-authoritative-state';
  const CODES = ['REPORTED','EMPTY','UNSUPPORTED','UNAVAILABLE','INVALID_RESPONSE','NOT_FOUND','NOT_CONFIGURED'];
  const META = ['projectionVersion','code','classification','reportKind','authority','walletApproval','nativeEligibility','chainFinality','source','version','asOf','observedAt','endpoint','responseSHA256','numericEncoding'];
  const MAX = '18446744073709551615';
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (v,k) => object(v) && Object.prototype.hasOwnProperty.call(v,k);
  const id = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const string = (v,n=8192) => typeof v === 'string' && v.length <= n && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(v);
  function uint(v) { return typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && (v.length < MAX.length || v.length === MAX.length && v <= MAX) ? v : null; }
  function time(v) {
    if (typeof v !== 'string' || v.length > 40) return null;
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
    if(!m)return null;
    const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(!y||mo<1||mo>12||d<1||d>days[mo-1]||h>23||mi>59||s>59||m[7]!=='Z'&&(Number(m[7].slice(1,3))>23||Number(m[7].slice(4))>59)||!Number.isFinite(Date.parse(v)))return null;
    return v;
  }
  function endpoint(v, detailID) {
    if(!string(v,2048))return null;
    try {const u=new URL(v),suffix='/governance/proposals'+(detailID?'/'+detailID:'');
      const path=v.match(/^https?:\/\/[^/]+(\/[^?#]*)?$/)?.[1]||'';
      const decoded=decodeURIComponent(path);
      if(u.username||u.password||u.search||u.hash||!u.pathname.endsWith(suffix)||
        /%2f|%5c/i.test(path)||decoded.includes('\\')||decoded.includes('//')||decoded.split('/').some(p=>p==='.'||p==='..'))return null;
      if(u.protocol!=='https:' && !(u.protocol==='http:' && ['127.0.0.1','[::1]'].includes(u.hostname)))return null;
      return v;
    } catch {return null;}
  }
  function metadata(v,detailID) {
    if(!object(v)||!boundedJSON(v,512*1024)||v.projectionVersion!=='YNX-NETWORK-GOVERNANCE-READ/v1'||!CODES.includes(v.code)||v.classification!=='RPC_ONLY'||v.reportKind!=='governance-registry'||v.numericEncoding!=='decimal-strings'||
      ['authority','walletApproval','nativeEligibility','chainFinality'].some(k=>v[k]!==false)||!time(v.observedAt))return null;
    const ep=v.endpoint===null?null:endpoint(v.endpoint,detailID);if(v.endpoint!==null&&!ep)return null;
    for(const k of ['source','version','asOf','responseSHA256'])if(!own(v,k))return null;
    if(v.source!==null&&v.source!==SOURCE||v.version!==null&&v.version!==VERSION||v.asOf!==null&&!time(v.asOf)||v.responseSHA256!==null&&!id(v.responseSHA256))return null;
    if(['REPORTED','EMPTY'].includes(v.code)&&(!ep||v.source!==SOURCE||v.version!==VERSION||!v.asOf||!v.responseSHA256))return null;
    return {code:v.code,classification:'RPC_ONLY',reportKind:'governance-registry',authority:false,walletApproval:false,nativeEligibility:false,chainFinality:false,
      source:v.source,version:v.version,asOf:v.asOf,observedAt:v.observedAt,endpoint:ep,responseSHA256:v.responseSHA256};
  }
  function boundedJSON(value,limit) {
    try {return new TextEncoder().encode(JSON.stringify(value)).length<=limit;}catch{return false;}
  }
  function decimalDocument(value,depth=0) {
    if(depth>32||typeof value==='number'||typeof value==='undefined'||typeof value==='function')return false;
    if(value===null||typeof value==='string'||typeof value==='boolean')return true;
    return typeof value==='object'&&Object.values(value).every(v=>decimalDocument(v,depth+1));
  }
  function proposal(v) {
    if(!object(v)||!boundedJSON(v,128*1024)||!decimalDocument(v)||!id(v.id)||!object(v.input)||!string(v.status,80)||!v.status||!string(v.input.summary)||!string(v.input.scope,128)||!string(v.input.proposalType,128)||!string(v.input.proposer,256)||!time(v.createdAt)||!time(v.updatedAt)||uint(v.deposit)===null||uint(v.eligiblePower)===null)return null;
    let end=null;if(v.votingEndsAt!==undefined&&v.votingEndsAt!==null&&v.votingEndsAt!==''&&v.votingEndsAt!=='0001-01-01T00:00:00Z'){end=time(v.votingEndsAt);if(!end)return null;}
    return {id:v.id,summary:v.input.summary,scope:v.input.scope,proposalType:v.input.proposalType,proposer:v.input.proposer,status:v.status,
      createdAt:v.createdAt,updatedAt:v.updatedAt,votingEndsAt:end,deposit:v.deposit,eligiblePower:v.eligiblePower};
  }
  function projectList(v) {
    const meta=metadata(v);if(!meta||Object.keys(v).some(k=>![...META,'proposals','reportedCount','returnedCount','limit','truncated'].includes(k))||!Array.isArray(v.proposals)||v.proposals.length>50||v.limit!=='50'||typeof v.truncated!=='boolean'||uint(v.returnedCount)!==String(v.proposals.length)||v.reportedCount!==null&&uint(v.reportedCount)===null)return null;
    const rows=[],seen=new Set();for(const raw of v.proposals){const p=proposal(raw);if(!p||seen.has(p.id))return null;seen.add(p.id);rows.push(p);}
    if(v.code==='EMPTY'&&(rows.length||v.reportedCount!=='0'||v.truncated)||v.code==='REPORTED'&&!rows.length)return null;
    if(!['REPORTED','EMPTY'].includes(v.code)&&(rows.length||v.returnedCount!=='0'||v.reportedCount!==null||v.truncated))return null;
    if(['REPORTED','EMPTY'].includes(v.code)&&(v.reportedCount===null||BigInt(v.reportedCount)<BigInt(rows.length)||!v.truncated&&v.reportedCount!==v.returnedCount))return null;
    return {...meta,proposals:rows,reportedCount:v.reportedCount,returnedCount:v.returnedCount,truncated:v.truncated};
  }
  function projectDetail(v, expectedID) {
    if(!id(expectedID))return null;
    const meta=metadata(v,expectedID);if(!meta||Object.keys(v).some(k=>![...META,'proposal'].includes(k)))return null;
    if(v.code!=='REPORTED')return v.proposal===null&&v.code!=='EMPTY'?{...meta,proposal:null,rawJSON:null}:null;
    const p=proposal(v.proposal);if(!p||p.id!==expectedID)return null;
    return {...meta,proposal:p,rawJSON:JSON.stringify(v.proposal,null,2)};
  }
  root.NetworkGovernance=Object.freeze({projectList,projectDetail});
})(typeof window==='undefined'?globalThis:window);
