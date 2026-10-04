/** Main-process camera acquisition permit. Public scanning is not signing/auth. */
export function createRecipientCameraPermission({getContext, expectedURL, getContents, id, now = Date.now}) {
  let permit = null;
  function ready(context) {return context.focused && !context.locked && !context.authenticating && !context.changing && Boolean(context.account);}
  function begin() {
    const context = getContext(); permit = null;
    if (!ready(context)) throw new Error("Camera unavailable");
    permit = {id: id(), account: context.account, revision: context.revision, expires: now() + 60_000};
    return {id: permit.id};
  }
  function end(value) {if (value === permit?.id) permit = null;}
  function invalidate() {permit = null;}
  function allows(contents, permission, details, check = false) {
    const context = getContext(), expected = getContents();
    if (!permit || now() >= permit.expires || !ready(context) || context.account !== permit.account || context.revision !== permit.revision ||
        !expected || expected.isDestroyed() || contents !== expected || details?.isMainFrame !== true ||
        details.requestingUrl !== expectedURL || expected.mainFrame?.url !== expectedURL || permission !== "media") return false;
    return check ? details.mediaType === "video" : Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === "video";
  }
  return Object.freeze({begin, end, invalidate, allows});
}
