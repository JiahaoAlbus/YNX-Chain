import {CardError,type CardScope,type Principal} from './contracts.ts';

// The two new scopes exist in Wallet source ff5b7d49, not necessarily a live
// registry. They are never mapped from application/controls permission.
const routeScopes:readonly [string,RegExp,CardScope][]=[
  ['GET',/^\/api\/card\/v1\/state$/,'account:read'],
  ['GET',/^\/api\/card\/v1\/cards\/[^/]+\/(statement|reconciliation)$/,'account:read'],
  ['POST',/^\/api\/card\/v1\/applications$/,'card:application:write'],
  ['PATCH',/^\/api\/card\/v1\/applications\/[^/]+$/,'card:application:write'],
  ['POST',/^\/api\/card\/v1\/applications\/[^/]+\/(approval-request|submit|cancel)$/,'card:application:write'],
  ['POST',/^\/api\/card\/v1\/cards\/[^/]+\/(freeze|unfreeze|close|recover)$/,'card:controls:write'],
  ['PUT',/^\/api\/card\/v1\/cards\/[^/]+\/controls$/,'card:controls:write'],
  ['POST',/^\/api\/card\/v1\/cards\/[^/]+\/topup-intents$/,'card:topup:write'],
  ['POST',/^\/api\/card\/v1\/topups$/,'card:topup:write'],
  ['POST',/^\/api\/card\/v1\/cards\/[^/]+\/authorizations$/,'card:simulation:write'],
  ['POST',/^\/api\/card\/v1\/cards\/[^/]+\/fees$/,'card:simulation:write'],
  ['POST',/^\/api\/card\/v1\/authorizations\/[^/]+\/(capture|reverse)$/,'card:simulation:write'],
  ['POST',/^\/api\/card\/v1\/captures\/[^/]+\/refund$/,'card:simulation:write'],
];

export function scopeForRoute(method:string,path:string):CardScope {
  const route=routeScopes.find(([verb,pattern])=>verb===method&&pattern.test(path));
  if(!route)throw new CardError('CARD_ROUTE_NOT_FOUND',404);
  return route[2];
}

export function scopeForMutation(operation:string):CardScope {
  if(/^applications:(create|update|approval|submit-start|submit-finish|submit-failure|cancel)(:|$)/.test(operation))return 'card:application:write';
  if(/^(card:(freeze|unfreeze|close|recover):|controls:)/.test(operation))return 'card:controls:write';
  if(/^topup-(intent|confirm):/.test(operation))return 'card:topup:write';
  if(/^(authorization|capture|reverse|refund|fee):/.test(operation))return 'card:simulation:write';
  throw new CardError('CARD_OPERATION_NOT_ALLOWED',403);
}

export function requireScope(principal:Principal,scope:CardScope):void {
  if(!Array.isArray(principal.scopes)||!principal.scopes.includes(scope))throw new CardError('CARD_PERMISSION_DENIED',403);
}
