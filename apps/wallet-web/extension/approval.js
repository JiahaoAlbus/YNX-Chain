import {extensionFlowCopy} from "./i18n.js";
import {loadPreferences} from "./preferences.js";
import {hostedCopy,normalizeHostedLocale} from "./hosted-i18n.js";
import {isProviderInternalRequestId,providerContextLabel} from "./extension-provider-permissions.js";
import {toYNXAddress} from "./wallet-address.js";
const selectedPreferences=loadPreferences(globalThis.localStorage);
const walletLocale=["restored","migrated"].includes(selectedPreferences.status)?selectedPreferences.record.locale:normalizeHostedLocale(globalThis.navigator?.language||"en");
const flow=key=>extensionFlowCopy(walletLocale,key);
if(document.documentElement){document.documentElement.lang=walletLocale;document.documentElement.dir=walletLocale==="ar"?"rtl":"ltr"}
for(const node of document.querySelectorAll?.("[data-hosted-i18n]")||[])node.textContent=hostedCopy(walletLocale,node.dataset.hostedI18n);
for(const node of document.querySelectorAll?.("[data-extension-i18n]")||[])node.textContent=flow(node.dataset.extensionI18n);
const api=globalThis.browser||globalThis.chrome;
const requestId=new URLSearchParams(location.search).get("requestId"),status=document.querySelector("#status"),approve=document.querySelector("#approve"),reject=document.querySelector("#reject");
function fail(code){status.textContent=flow("failed");const details=document.querySelector("#error-details"),errorCode=document.querySelector("#error-code");if(details)details.hidden=false;if(errorCode)errorCode.textContent=/^(?:[A-Z][A-Z0-9_]{2,80}|[0-9]{3,6})$/.test(String(code))?String(code):"REQUEST_FAILED";approve.disabled=true;reject.disabled=true}
async function decide(decision){approve.disabled=true;reject.disabled=true;status.textContent=decision==="approve"?flow("connecting"):flow("rejecting");const result=await api.runtime.sendMessage({type:"YNX_PROVIDER_APPROVAL_DECIDE_V1",requestId,decision}).catch(()=>null);if(result?.ok===true){window.close();return}fail(result?.error?.code||"APPROVAL_RUNTIME_UNAVAILABLE")}
if(!isProviderInternalRequestId(requestId))fail("INVALID_APPROVAL_REQUEST");
else api.runtime.sendMessage({type:"YNX_PROVIDER_APPROVAL_GET_V1",requestId}).then((result)=>{if(result?.ok!==true)return fail(result?.error?.code||"APPROVAL_REQUEST_UNAVAILABLE");document.querySelector("#origin").textContent=result.request.origin;document.querySelector("#browser-context").textContent=providerContextLabel(result.request.browserContext);document.querySelector("#account").textContent=toYNXAddress(result.request.account);status.textContent=flow("ready");approve.disabled=false;reject.disabled=false;approve.addEventListener("click",()=>void decide("approve"));reject.addEventListener("click",()=>void decide("reject"));}).catch(()=>fail("APPROVAL_RUNTIME_UNAVAILABLE"));
