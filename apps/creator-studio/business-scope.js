export function creatorScope(path, method = 'GET') {
  if (/\/(payout-intents|revenue|disputes)/.test(path)) return 'creator:revenue';
  return ['GET', 'HEAD'].includes(method.toUpperCase()) ? 'creator:account' : 'creator:publish';
}
