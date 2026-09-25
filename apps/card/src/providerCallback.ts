/** Classify transport only. The respective protocol must still verify the result. */
export function cardCallbackKind(value:string):'session'|'application'|'none'|'invalid'{
  let url:URL;try{url=new URL(value)}catch{return 'invalid'}
  if(url.origin!=='https://card.ynxweb4.com'||url.pathname!=='/wallet-auth/callback')return 'none';
  const application=url.searchParams.has('cardApplicationApprovalResult');
  const session=url.searchParams.has('result');
  if(application&&session)return 'invalid';
  if(application)return url.searchParams.getAll('cardApplicationApprovalResult').length===1?'application':'invalid';
  if(session)return url.searchParams.getAll('result').length===1?'session':'invalid';
  return 'none';
}
