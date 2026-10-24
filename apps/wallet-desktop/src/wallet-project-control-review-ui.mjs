// Dedicated control-consent consumer, not ARTIFACT-RELEASE consent. The owning
// Main/Native producer must retain and qualify the original command, principal,
// public binding and purpose. This display never creates a proof, Root, key or
// registration. Wire codec/purpose remain Auth-owned; none is invented here.
const commandKeys=['RequestID','Action','ProjectID','TeamID','SubjectAccount','PublisherID','RuntimeOrigin','ExpectedRevision','GrantExpiresMS','Read','Publish','Runtime','Revoke','ExpiresMS','PublicOriginalSHA256'];
const publisherKeys=['Account','ProjectID','PublisherID','KeyRole','PublicSHA256','RegistrationRef','ExpiresMS'];
const fail=()=>{throw Error('CONTROL_REVIEW_INVALID');};
function exact(value,keys){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);
 if(names.length!==keys.length||names.some(k=>!keys.includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
const text=v=>typeof v==='string'&&v.length>0&&new TextEncoder().encode(v).length<=256&&!/[\s\u0000-\u001f\u007f]/u.test(v);
const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=19&&BigInt(v)<=9223372036854775807n;
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function capture(review,at){
 const ds=Object.getOwnPropertyDescriptors(review??{});
 const r=exact(review,Object.hasOwn(ds,'publisher')?['reviewId','account','networkId','command','publisher']:['reviewId','account','networkId','command']);
 if(![r.reviewId,r.account,r.networkId].every(text)||!Number.isSafeInteger(at)||at<0)fail();
 const c=exact(r.command,commandKeys);
 for(const k of ['RequestID','Action','ProjectID','TeamID','SubjectAccount','PublisherID','RuntimeOrigin','PublicOriginalSHA256'])if(typeof c[k]!=='string'||c[k]!==''&&!text(c[k]))fail();
 for(const k of ['ExpectedRevision','GrantExpiresMS','ExpiresMS'])if(!uint(c[k]))fail();
 for(const k of ['Read','Publish','Runtime','Revoke'])if(typeof c[k]!=='boolean')fail();
 const actions=['project.create','team.create','team.member','project.member','project.team','project.origin','project.revoke','team.revoke','project.publisher'];
 if(!actions.includes(c.Action)||!text(c.RequestID)||!text(c.Action.startsWith('team.')?c.TeamID:c.ProjectID)||BigInt(c.ExpectedRevision)>2n**62n||BigInt(c.ExpiresMS)<=BigInt(at)||BigInt(c.ExpiresMS)>BigInt(at)+300000n)fail();
 const empty=(...keys)=>keys.every(k=>c[k]===''),noRights=!c.Read&&!c.Publish&&!c.Runtime;
 const grant=['team.member','project.member','project.team','project.publisher'].includes(c.Action);
 if(grant?(c.Revoke?c.GrantExpiresMS!=='0':BigInt(c.GrantExpiresMS)<=BigInt(at)):c.GrantExpiresMS!=='0')fail();
 switch(c.Action){
 case 'project.create':case 'team.create':if(c.ExpectedRevision!=='0'||!empty(c.Action==='project.create'?'TeamID':'ProjectID','SubjectAccount','PublisherID','RuntimeOrigin','PublicOriginalSHA256')||!noRights||c.Revoke)fail();break;
 case 'team.member':if(!text(c.SubjectAccount)||!empty('ProjectID','PublisherID','RuntimeOrigin','PublicOriginalSHA256')||!noRights)fail();break;
 case 'project.member':if(!text(c.SubjectAccount)||!empty('TeamID','PublisherID','RuntimeOrigin','PublicOriginalSHA256')||!c.Revoke&&noRights)fail();break;
 case 'project.team':if(!text(c.TeamID)||!empty('SubjectAccount','PublisherID','RuntimeOrigin','PublicOriginalSHA256')||!c.Revoke&&noRights)fail();break;
 case 'project.origin':{let u;try{u=new URL(c.RuntimeOrigin);}catch{fail();}if(c.ExpectedRevision==='0'||u.protocol!=='https:'||!u.host||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.origin!==c.RuntimeOrigin||!empty('TeamID','SubjectAccount','PublisherID','PublicOriginalSHA256')||!noRights||c.Revoke)fail();break;}
 case 'project.revoke':case 'team.revoke':if(c.ExpectedRevision==='0'||!c.Revoke||!noRights||!empty('SubjectAccount','PublisherID','PublicOriginalSHA256','RuntimeOrigin',c.Action==='project.revoke'?'TeamID':'ProjectID'))fail();break;
 case 'project.publisher':if(!text(c.SubjectAccount)||!text(c.PublisherID)||!digest(c.PublicOriginalSHA256)||!empty('TeamID','RuntimeOrigin')||!noRights)fail();break;
 }
 let p;
 if(c.Action==='project.publisher'&&!c.Revoke){
  p=exact(r.publisher,publisherKeys);
  if(!publisherKeys.filter(k=>k!=='ExpiresMS').every(k=>text(p[k]))||!uint(p.ExpiresMS)||p.Account!==c.SubjectAccount||p.ProjectID!==c.ProjectID||p.PublisherID!==c.PublisherID||p.KeyRole!=='ide-artifact-publisher'||p.PublicSHA256!==c.PublicOriginalSHA256||BigInt(p.ExpiresMS)<BigInt(c.GrantExpiresMS))fail();
 }else if(r.publisher!==undefined)fail();
 return Object.freeze({...r,command:Object.freeze(c),...(p?{publisher:Object.freeze(p)}:{})});
}
export function appendWalletProjectControlReview({container,review,api,getKeyState,isCurrent,onResult,now=Date.now,document:doc=document}){
 const openedAt=now(),own=capture(review,openedAt),initial={...getKeyState()},buttons=[];let entered=false,floor=openedAt;
 if(typeof api?.decideIDEProjectControl!=='function'||[getKeyState,isCurrent,onResult,now].some(f=>typeof f!=='function'))fail();
 const live=()=>{const s=getKeyState(),at=now();if(!Number.isSafeInteger(at)||at<floor)return false;floor=at;return isCurrent()&&!s.locked&&!s.authenticating&&s.account===own.account&&s.account===initial.account&&s.revision===initial.revision&&BigInt(at)<BigInt(own.command.ExpiresMS)&&(own.command.Revoke||own.command.GrantExpiresMS==='0'||BigInt(at)<BigInt(own.command.GrantExpiresMS));};
 const line=(tag,text)=>{const el=doc.createElement(tag);el.textContent=text;container.append(el);};
 line('h3','项目控制批准 / Project control consent');
 line('p','仅批准下列明确控制操作；不是制品签名、转账或 Root 授权。 / This exact control operation only; not artifact signing, transfer or Root authorization.');
 for(const k of ['account','networkId'])line('p',k+': '+own[k]);
 for(const k of commandKeys)line('p',k+': '+String(own.command[k]));
 if(own.publisher)for(const k of publisherKeys)line('p','Publisher '+k+': '+own.publisher[k]);
 line('p','公开绑定由原 Native/服务端独立验证；显示字段不授予权限。 / Original Native/server must independently verify the public binding; display DATA grants nothing.');
 const render=()=>{for(const b of buttons)b.disabled=entered||!live();};
 for(const [decision,label]of [['approve','批准此控制操作 / Approve this control operation'],['reject','拒绝 / Reject'],['cancel','取消 / Cancel']]){
  const b=doc.createElement('button');b.type='button';b.textContent=label;
  b.addEventListener('click',async()=>{
   if(entered||!live())return;entered=true;render();
   try{const response=await api.decideIDEProjectControl(own.reviewId,decision);if(!live())return;const v=response?.value;
    if(response?.ok!==true||v?.reviewId!==own.reviewId||v?.decision!==decision||v?.recorded!==true){onResult('Control decision outcome unknown; retain original request, no retry.');return;}
    onResult('Control '+decision+' choice recorded; not registration or publication completion.');
   }catch{if(live())onResult('Control decision outcome unknown; retain original request, no retry or fallback decision.');}
   finally{render();}
  });buttons.push(b);container.append(b);
 }
 render();return Object.freeze({refresh:render});
}
