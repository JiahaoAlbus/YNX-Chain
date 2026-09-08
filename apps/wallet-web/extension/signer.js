import {isProviderInternalRequestId,providerContextLabel} from "./extension-provider-permissions.js";
import {toYNXAddress} from "./wallet-address.js";
import {extensionReviewText} from "./extension-signer.js";
const api=globalThis.browser||globalThis.chrome,requestId=new URLSearchParams(location.search).get("requestId"),status=document.querySelector("#status"),approve=document.querySelector("#approve"),reject=document.querySelector("#reject"),password=document.querySelector("#password");
let deadlineAt=0,expiryTimer=null;
function renderReview(summary,method){
  document.querySelector("#request").textContent=summary;
  const signature=method==="personal_sign"||method==="eth_signTypedData_v4",transfer=method==="eth_sendTransaction";
  document.querySelector("#review-kind").textContent=transfer?"TRANSACTION REQUEST":signature?"SIGNATURE REQUEST":"SENSITIVE REQUEST";
  document.querySelector("#review-title").textContent=transfer?"Review transfer":method==="personal_sign"?"Sign message":method==="eth_signTypedData_v4"?"Sign structured data":"Review and unlock";
  document.querySelector("#review-intro").textContent=transfer?"Approving signs and sends this transaction to YNX Testnet. Check the recipient, amount and network fee before unlocking.":signature?"Check the site, account and test network. Approving signs this one request with your wallet.":"Review the site, account, network and complete request before unlocking.";
  const readable=document.querySelector("#readable-review"),details=document.querySelector("#raw-details"),preview=document.querySelector("#readable-request"),warning=document.querySelector("#review-warning");
  readable.hidden=true;details.open=true;
  let review;try{review=JSON.parse(summary);if(!review||typeof review!=="object"||Array.isArray(review)||extensionReviewText(review)!==summary)return}catch{return}
  // Reuse the protocol's exact escaping after JSON.parse; raw summary stays untouched.
  if(method==="personal_sign"&&typeof review.messageText==="string"&&typeof review.messageHex==="string"&&Number.isSafeInteger(review.messageBytes)){
    document.querySelector("#review-label").textContent=`Message · ${review.messageBytes} bytes`;
    document.querySelector("#review-note").textContent="Visible escape sequences are preserved. Compare the exact hexadecimal bytes in the full original request below.";
    const escaped=extensionReviewText(review.messageText);preview.textContent=review.messageText.length?escaped.slice(1,-1):'"" (empty message)';preview.className="review-text message-text";
  }else if(method==="eth_signTypedData_v4"&&review.domain&&review.types&&review.message&&typeof review.primaryType==="string"){
    document.querySelector("#review-label").textContent="Domain, types and message";
    document.querySelector("#review-note").textContent="Review every domain, type and message field. Visible escape sequences are preserved.";
    preview.textContent=extensionReviewText(review);
  }else return;
  if(typeof review.warning==="string"){warning.textContent=extensionReviewText(review.warning).slice(1,-1);warning.hidden=false}
  readable.hidden=false;details.open=false;
}
function fail(code,message="Sensitive request unavailable."){status.textContent=`${code}: ${message}`;approve.disabled=true;reject.disabled=true;password.value=""}
async function decide(decision){approve.disabled=true;reject.disabled=true;if(Date.now()>=deadlineAt)return fail("SIGNER_REVIEW_EXPIRED");const secret=decision==="approve"?password.value:undefined;if(decision==="approve"&&secret.length<12){status.textContent="Use at least 12 password characters.";approve.disabled=false;reject.disabled=false;return}status.textContent=decision==="approve"?"Unlocking and signing…":"Rejecting…";const result=await api.runtime.sendMessage({type:"YNX_SIGNER_DECIDE_V1",requestId,decision,password:secret}).catch(()=>null);password.value="";if(result?.ok===true){window.close();return}fail(result?.error?.code||"SIGNER_RUNTIME_UNAVAILABLE",result?.error?.message)}
if(!isProviderInternalRequestId(requestId))fail("INVALID_SIGNER_REQUEST");else api.runtime.sendMessage({type:"YNX_SIGNER_GET_V1",requestId}).then(result=>{if(result?.ok!==true)return fail(result?.error?.code||"SIGNER_REQUEST_UNAVAILABLE",result?.error?.message);document.querySelector("#browser-context").textContent=providerContextLabel(result.request.browserContext);deadlineAt=result.request.deadlineAt;if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now())return fail("SIGNER_REVIEW_EXPIRED");for(const key of["origin","account","method"])document.querySelector(`#${key}`).textContent=key==="account"?toYNXAddress(result.request[key]):result.request[key];renderReview(result.request.summary,result.request.method);status.textContent="Read every field, then enter the local vault password to approve this one request.";approve.disabled=false;reject.disabled=false;expiryTimer=setTimeout(()=>fail("SIGNER_REVIEW_EXPIRED"),deadlineAt-Date.now());approve.addEventListener("click",()=>void decide("approve"));reject.addEventListener("click",()=>void decide("reject"));}).catch(()=>fail("SIGNER_RUNTIME_UNAVAILABLE"));addEventListener("pagehide",()=>{clearTimeout(expiryTimer);password.value=""});
