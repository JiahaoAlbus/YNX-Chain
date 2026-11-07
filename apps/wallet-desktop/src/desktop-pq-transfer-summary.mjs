// Read-only projection of the SAME original Main pending review. This display
// neither re-encodes the signed bytes nor grants approval/sign/broadcast rights.
function fields(value,names){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid original review');const out={};for(const name of names){const d=Object.getOwnPropertyDescriptor(value,name);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw Error('Original review field unavailable');out[name]=d.value;}return out;}
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;
export function projectPQTransferReviewSummary(request,context,now=Date.now()){
 const method=Object.getOwnPropertyDescriptor(request??{},'method');if(!method||!Object.hasOwn(method,'value'))throw Error('Original method unavailable');if(method.value!=='ynx_signPQNativeTransfer')return null;
 const r=fields(request,['id','method','createdAt','review']),v=fields(r.review,['account','from','to','chainId','nativeChainId','amount','fee','nonce','policyRevision','expiresAt']);
 if(['account','from','to','chainId','nativeChainId','expiresAt'].some(k=>typeof v[k]!=='string')||typeof r.createdAt!=='string'||!Number.isFinite(now))throw Error('Original strings unavailable');
 if(context?.locked||context?.authenticating||v.account!==context?.account||!/^0x[0-9a-f]{40}$/.test(v.account??'')||v.from!==v.account||!/^0x[0-9a-f]{40}$/.test(v.to??'')||!/^0x[0-9a-f]{40}$/.test(v.from??'')||! /^[0-9a-f]{64}$/.test(v.chainId??'')||v.nativeChainId!=='6423'||!uint(v.amount)||v.amount==='0'||v.fee!=='1'||!uint(v.nonce)||!uint(v.policyRevision)||typeof r.id!=='string'||!r.id||r.id.length>256)throw Error('Original transfer summary unavailable');
 const created=Date.parse(r.createdAt),expires=Date.parse(v.expiresAt);if(!Number.isFinite(created)||!Number.isFinite(expires)||created>now||expires<=now||expires<=created)throw Error('Original review expired or unavailable');
 const sum=BigInt(v.amount)+BigInt(v.fee);return Object.freeze({id:r.id,account:v.account,from:v.from,to:v.to,networkId:v.chainId,nativeChainId:v.nativeChainId,amount:v.amount,fee:v.fee,displaySum:sum<=18446744073709551615n?sum.toString():null,nonce:v.nonce,policyRevision:v.policyRevision,expiresAt:v.expiresAt,approved:false,signed:false,submitted:false});
}
export function createDesktopPQTransferSummary({root,document:doc,getContext,now=Date.now}){
 const make=(tag,text,cls)=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;},zh=()=>doc.documentElement.lang.startsWith('zh'),t=(en,cn)=>zh()?cn:en;
 function clear(){root.replaceChildren();root.hidden=true;}
 return Object.freeze({clear,render(request){clear();let v;try{v=projectPQTransferReviewSummary(request,getContext(),now());}catch{root.hidden=false;root.append(make('p',t('Compact transfer summary unavailable. Inspect the complete original request below.','转账摘要尚不可用，请核对下方完整原始请求。'),'desktop-warning'));return false;}if(!v)return false;
  root.hidden=false;root.append(make('p',v.amount+' YNXT','desktop-pq-review-amount'));const facts=doc.createElement('dl');facts.className='desktop-pq-review-facts';
  for(const [label,value]of [[t('From (canonical ID)','从（规范 ID）'),v.from],[t('Recipient (canonical ID)','接收方（规范 ID）'),v.to],[t('Native chain','原生链 ID'),v.nativeChainId],[t('Exact network ID','完整网络 ID'),v.networkId],[t('Fee','手续费'),v.fee+' YNXT'],...(v.displaySum===null?[]:[[t('Amount + stated fee','金额与所示手续费之和'),v.displaySum+' YNXT']]),[t('Review deadline','审阅截止时间'),v.expiresAt]]){const dt=make('dt',label),dd=make('dd',value);dd.dir='ltr';facts.append(dt,dd);}root.append(facts,make('p','ML-DSA-87 + SLH-DSA-SHA2-256f','desktop-pq-review-suite'),make('p',t('Sign and retain this original only. Broadcasting requires a separate original approval. No payment or consensus finality is claimed here.','仅签名并保留此原件；广播需要独立原始批准。此处不代表付款或共识最终确认。'),'desktop-pq-review-warning'));return true;
 }});
}
