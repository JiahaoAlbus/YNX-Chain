import {isProviderInternalRequestId,providerContextLabel} from "./extension-provider-permissions.js";
import {toYNXAddress} from "./wallet-address.js";

const api=globalThis.browser||globalThis.chrome,requestId=new URLSearchParams(location.search).get("requestId");
const byId=id=>document.getElementById(id),status=byId("status"),approve=byId("approve"),reject=byId("reject"),password=byId("password");
const copy={
  en:{eyebrow:"SITE ACCESS",title:"Allow this product?",intro:"Review what this site can access. Approval applies only to this request and still needs service verification.",site:"Site",product:"Product",account:"Account",purpose:"Product's reason",permissions:"Requested access",expires:"Approve before",technical:"Technical details",application:"Application ID",context:"Browser context",network:"Network",protocol:"Protocol",scopeIds:"Permission IDs",originalPurpose:"Original purpose",password:"Wallet password",approve:"Approve",reject:"Reject",loading:"Loading request…",ready:"Check the site and every permission, then enter your wallet password.",shortPassword:"Enter at least 12 password characters.",working:"Unlocking and approving…",rejecting:"Rejecting…",badPassword:"That password did not unlock this wallet. Try again.",unavailable:"This request is no longer available. Return to the product and start a new request.",expired:"This request expired. Return to the product and start a new request.",changed:"The page, tab, or wallet changed. Return to the product and start a new request.",runtime:"Wallet review is unavailable. Return to the product and retry.",rejected:"The request could not be approved. Return to the product and retry.",scope:{"account:read":"Read account profile","card:application:write":"Submit a card application","card:controls:write":"Change card controls","card:finance:share":"Share Card data with Finance","card:dispute:write":"Submit a card dispute","card:simulation:write":"Run card simulations","card:topup:write":"Request a card top-up","finance.ai.draft":"Create Finance AI drafts","finance.pay.read":"Read payment information","finance.portfolio.read":"Read portfolio information","finance.profile.write":"Change Finance profile"}},
  "zh-CN":{eyebrow:"网站授权",title:"允许该产品访问吗？",intro:"请核对网站和请求的权限。本次批准只适用于当前请求，后续仍需服务端核验。",site:"网站",product:"产品",account:"账户",purpose:"产品用途",permissions:"请求权限",expires:"请在此时间前批准",technical:"技术详情",application:"应用标识",context:"浏览器环境",network:"网络",protocol:"协议",scopeIds:"权限标识",originalPurpose:"原始用途说明",password:"钱包密码",approve:"批准",reject:"拒绝",loading:"正在读取请求…",ready:"请核对网站及每项权限，再输入钱包密码。",shortPassword:"密码至少需要 12 个字符。",working:"正在解锁并批准…",rejecting:"正在拒绝…",badPassword:"密码未能解锁钱包，请重试。",unavailable:"该请求已不可用。请返回产品重新发起。",expired:"请求已过期。请返回产品重新发起。",changed:"页面、标签页或钱包已变更。请返回产品重新发起。",runtime:"钱包审批暂时不可用。请返回产品重试。",rejected:"本次请求未获批准。请返回产品重试。",scope:{"account:read":"读取账户资料","card:application:write":"提交卡片申请","card:controls:write":"修改卡片控制设置","card:finance:share":"向 Finance 共享 Card 数据","card:dispute:write":"提交卡片争议","card:simulation:write":"运行卡片模拟","card:topup:write":"申请卡片充值","finance.ai.draft":"创建 Finance AI 草稿","finance.pay.read":"读取支付信息","finance.portfolio.read":"读取投资组合信息","finance.profile.write":"修改 Finance 资料"}},
};
const purposeZh=new Map([
  ["Read Card TEST records and request explicit application or freeze controls. This does not create a card or transfer funds.","读取 Card 测试记录，并在单独确认后申请卡片或调整冻结控制。本次授权不会创建卡片或转移资金。"],
  ["Allow Card to manage your separately selected read-only sharing with YNX Finance. This grants no payment or trading authority.","允许 Card 管理你单独选择的 Finance 只读数据共享。本次授权不授予支付或交易权限。"],
]);
let locale;try{locale=localStorage.getItem("ynx.wallet.private.locale")}catch{}if(!Object.hasOwn(copy,locale))locale=navigator.language?.toLowerCase().startsWith("zh")?"zh-CN":"en";
let deadlineAt=0,timer,request=null,state="loading",errorCode=null;
function tr(){return copy[locale]}
function errorKind(code){if(code==="PRIVATE_APPROVAL_EXPIRED"||code==="BRIDGE_TIMEOUT")return"expired";if(["DOCUMENT_CHANGED","ORIGIN_CHANGED","PROVIDER_ACCOUNT_CHANGED","PRIVATE_TAB_CHANGED","PRIVATE_APPROVAL_CLOSED"].includes(code))return"changed";if(["PRIVATE_APPROVAL_UNAVAILABLE","INVALID_PRIVATE_APPROVAL_REQUEST"].includes(code))return"unavailable";if(code==="PRIVATE_APPROVAL_RUNTIME_UNAVAILABLE"||code==="RUNTIME_UNAVAILABLE")return"runtime";return"rejected"}
function render(){
  const t=tr();document.documentElement.lang=locale;byId("language").textContent=locale==="en"?"中文":"English";
  for(const [id,key]of Object.entries({eyebrow:"eyebrow",title:"title",intro:"intro","site-label":"site","product-label":"product","account-label":"account","purpose-label":"purpose","permissions-label":"permissions","expires-label":"expires","technical-label":"technical","application-label":"application","context-label":"context","network-label":"network","protocol-label":"protocol","scope-ids-label":"scopeIds","original-purpose-label":"originalPurpose","password-label":"password"}))byId(id).textContent=t[key];
  approve.textContent=t.approve;reject.textContent=t.reject;
  if(request){
    byId("product").textContent=request.productName;
    byId("purpose").textContent=locale==="zh-CN"?purposeZh.get(request.purpose)||request.purpose:request.purpose;
    byId("expires").textContent=new Date(request.expiresAt).toLocaleString(locale,{dateStyle:"medium",timeStyle:"short"});
    const scopes=byId("scopes");scopes.replaceChildren();for(const id of request.scopes){const item=document.createElement("span");item.className="scope-item";item.textContent=t.scope[id]||id;scopes.append(item)}
  }
  const message=state==="error"?t[errorKind(errorCode)]||t.rejected:t[state];status.textContent=errorCode?`${message} (${errorCode})`:message;
}
function fail(code){state="error";errorCode=code;approve.disabled=true;reject.disabled=true;password.value="";render()}
async function decide(decision){
  approve.disabled=true;reject.disabled=true;if(Date.now()>=deadlineAt)return fail("PRIVATE_APPROVAL_EXPIRED");
  const secret=decision==="approve"?password.value:undefined;
  if(decision==="approve"&&secret.length<12){state="shortPassword";render();approve.disabled=false;reject.disabled=false;return}
  state=decision==="approve"?"working":"rejecting";render();
  const response=await api.runtime.sendMessage({type:"YNX_PRIVATE_APPROVAL_DECIDE_V2",requestId,decision,password:secret}).catch(()=>null);password.value="";
  if(response?.ok===true){window.close();return}
  if(["VAULT_PASSWORD_INVALID","VAULT_UNLOCK_FAILED"].includes(response?.error?.code)){state="badPassword";render();approve.disabled=false;reject.disabled=false;return}
  fail(response?.error?.code||"PRIVATE_APPROVAL_RUNTIME_UNAVAILABLE");
}
byId("language").addEventListener("click",()=>{locale=locale==="en"?"zh-CN":"en";try{localStorage.setItem("ynx.wallet.private.locale",locale)}catch{}render()});
render();
if(!isProviderInternalRequestId(requestId))fail("INVALID_PRIVATE_APPROVAL_REQUEST");
else api.runtime.sendMessage({type:"YNX_PRIVATE_APPROVAL_GET_V2",requestId}).then(response=>{
  if(response?.ok!==true)return fail(response?.error?.code||"PRIVATE_APPROVAL_UNAVAILABLE");
  request=response.request;deadlineAt=request.deadlineAt;if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now())return fail("PRIVATE_APPROVAL_EXPIRED");
  byId("origin").textContent=request.origin;byId("account").textContent=toYNXAddress(request.account);
  byId("application").textContent=request.applicationId;byId("browser-context").textContent=providerContextLabel(request.browserContext);byId("scope-ids").textContent=request.scopes.join(" · ");byId("original-purpose").textContent=request.purpose;
  state="ready";render();approve.disabled=false;reject.disabled=false;
  timer=setTimeout(()=>fail("PRIVATE_APPROVAL_EXPIRED"),deadlineAt-Date.now());
  approve.addEventListener("click",()=>void decide("approve"));reject.addEventListener("click",()=>void decide("reject"));
}).catch(()=>fail("PRIVATE_APPROVAL_RUNTIME_UNAVAILABLE"));
addEventListener("pagehide",()=>{clearTimeout(timer);password.value=""});
