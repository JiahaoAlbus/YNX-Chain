// Mechanical extraction of the original projection-data mapping; DATA only.
export const ref=r=>({Realm:r.realm,Tenant:r.tenant,Kind:r.kind,ID:r.id,Revision:r.rev});
export const bind=b=>({Bytes:b.bytes,SHA3_512:b.sha3_512,SHA512:b.sha512});
const sink=s=>({Service:s.service,Tenant:s.tenant,Origin:s.origin,Path:s.path,Region:s.region,Operation:s.operation});
const sources=s=>s.map(x=>({Resource:ref(x.ref),Fields:x.fields,Label:x.label,Binding:bind(x.binding)}));
export function originalTaskReadBindingDATA(m,g){
 const s=g.binding,tool={ID:s.tool.id,Version:s.tool.version,Operation:g.operation,Purpose:s.purpose,Risk:s.risk,Schema:bind(s.tool.schema)};
 const b={Realm:g.realm,Tenant:g.tenant,Account:m.Account,Audience:g.audience,GrantID:g.id,GrantRevision:g.rev,Task:ref(s.task),Generation:s.generation,StepID:s.stepId,Holder:ref(g.holder),HolderEpoch:g.holderEpoch,SessionID:s.holderSession.id,SessionEpoch:s.holderSession.epoch,ChannelBinding:s.holderSession.channel,Tool:tool,Input:bind(s.input),Fields:m.Fields,Target:sink(s.target),Resources:g.resources.map(ref),Sources:sources(s.sources),EgressActual:null};
 return b;
}
