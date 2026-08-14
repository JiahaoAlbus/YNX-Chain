export type AuthorizationAttempt = Readonly<{generation:number;account:string}>;
export type AuthorizationLifecycle = Readonly<{generation:number;account:string}>;

export function assertAuthorizationAttemptActive(
  attempt:AuthorizationAttempt,
  current:AuthorizationLifecycle,
  expiresAt:string,
  now:Date,
):void{
  if(attempt.generation!==current.generation)throw new Error("Authorization review was dismissed or moved to the background");
  if(attempt.account!==current.account)throw new Error("Selected Wallet account changed during authorization review");
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error("Authorization verification time is invalid");
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)||!Number.isFinite(Date.parse(expiresAt))||new Date(expiresAt).toISOString()!==expiresAt)throw new Error("Authorization expiry is invalid");
  if(now.toISOString()>=expiresAt)throw new Error("Authorization request expired before final confirmation");
}
