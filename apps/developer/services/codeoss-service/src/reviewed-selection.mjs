// Metadata comes from the reviewed editor capture, never from the model.
// File authority remains the native editor's current document/path guards.
export const SELECTION_KIND = 'ynx-native-selected-edit/v1';
export const EDIT_SYSTEM = 'Suggest one replacement for the user-reviewed selected text. Return JSON only as {"summary":string,"replacement":string}. replacement replaces only selectedText; preserve surrounding code. Do not invent file paths, versions, digests or session identifiers. Do not claim execution, installation, signing or deployment.';
export function reviewedSelection(context, sessionId) {
  let value; try { value = JSON.parse(context); } catch { throw invalid('Paste the JSON capture from YNX: Copy Selected Context for Review.'); }
  if (!value || Object.keys(value).sort().join() !== 'fullTextDigest,selectedText,sessionId,uri,version' || value.sessionId !== sessionId ||
      typeof value.uri !== 'string' || value.uri.length < 1 || value.uri.length > 2048 ||
      !Number.isSafeInteger(value.version) || value.version < 0 || !/^[a-f0-9]{64}$/.test(value.fullTextDigest || '') ||
      typeof value.selectedText !== 'string' || !value.selectedText.length || Buffer.byteLength(value.selectedText) > 64 * 1024)
    throw invalid('Use a nonempty selection copied from this active IDE session.');
  return { uri:value.uri, version:value.version, fullTextDigest:value.fullTextDigest, selectedText:value.selectedText, sessionId };
}
export function reviewedReplacement(text, selection) {
  let value; try { value = JSON.parse(text); } catch { throw outputInvalid(); }
  if (!value || Object.keys(value).sort().join() !== 'replacement,summary' || typeof value.summary !== 'string' ||
      !value.summary.trim() || Buffer.byteLength(value.summary) > 4096 || typeof value.replacement !== 'string' || Buffer.byteLength(value.replacement) > 256 * 1024)
    throw outputInvalid();
  return { summary:value.summary, bundle:{protocol:'ynx-reviewed-text/v1',sessionId:selection.sessionId,changes:[{
    uri:selection.uri,version:selection.version,fullTextDigest:selection.fullTextDigest,
    replacements:[{find:selection.selectedText,replace:value.replacement}],
  }]} };
}
export function savedSelectionReview(context, text, sessionId) {
  let saved;try{saved=JSON.parse(context);}catch{return null;}
  if(saved?.kind!==SELECTION_KIND)return null;
  let capture;try{capture=JSON.parse(saved.context);}catch{return null;}
  // Reopening a saved answer remains possible after a new runtime session.
  // Its old edit cannot be exported as approval for the new session.
  if(capture?.sessionId!==sessionId)return null;
  try { return reviewedReplacement(text,reviewedSelection(saved.context,sessionId)); }
  catch { return null; } // Preserve readback of opaque legacy answers; never export an invalid edit.
}
export function isSavedSelectionReview(context) {
  try { return JSON.parse(context)?.kind === SELECTION_KIND; } catch { return false; }
}
function invalid(message){return Object.assign(new Error(message),{code:'tools_selection_invalid',status:400});}
function outputInvalid(){return Object.assign(new Error('The model did not return a valid selected-text replacement. Review a new request before sending again.'),{code:'tools_edit_output_invalid',status:502});}
