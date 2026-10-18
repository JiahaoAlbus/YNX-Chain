/** Both normal return channels use the SDK's small-reference URI budget.
 * Encoding a full proof internally is not permission to hand an oversized URI
 * to the OS or a connected provider while the original publisher is missing. */
export function assertSessionReturnTransport(callbackUrl){
  if(typeof callbackUrl!=='string'||!callbackUrl||Buffer.byteLength(callbackUrl,'utf8')>4096){
    throw Object.assign(new Error('The original signed approval is retained. A qualified small-reference return is required; nothing was delivered.'),{code:'SESSION_REFERENCE_RETURN_REQUIRED'});
  }
  return callbackUrl;
}
