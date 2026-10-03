// Exact existing AI Gateway contract. Selected pasted text is prompt content,
// never represented as an owned file or implicitly included history.
export function reviewedHostedPrompt(system, prompt) {
  const value = `${system}\n\n${prompt}`;
  if (Buffer.byteLength(value) > 8000)
    throw Object.assign(new Error('The reviewed request exceeds the existing model service limit of 8000 UTF-8 bytes. Shorten the request or selected text.'), { code: 'model_prompt_limit', status: 413 });
  return value;
}

export function existingHostedRequest(input) {
  const attachments = validatedModelAttachments(input.attachments);
  const value = {
    session: input.hostedSession,
    prompt: reviewedHostedPrompt(input.system, input.prompt),
    outputLanguage: input.outputLanguage,
    includedContext: attachments.length ? ['selected_files'] : [],
    excludedContext: ['conversation', ...(!attachments.length ? ['selected_files'] : []), 'selected_chain_records', 'selected_trust_records', 'selected_product_context'],
    attachments,
    productContexts: [],
    continueFrom: '',
  };
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
    throw Object.assign(new Error('Selected context exceeds the existing Gateway body limit.'), { code: 'model_context_limit', status: 413 });
  return value;
}

export function validatedModelAttachments(value = []) {
  if (!Array.isArray(value) || value.length > 8) throw invalidAttachments();
  const seen = new Set();
  return value.map(file => {
    if (!file || typeof file.id !== 'string' || !file.id.trim() || file.id.length > 120 ||
      typeof file.name !== 'string' || !file.name.trim() || Buffer.byteLength(file.name) > 160 || seen.has(file.name) ||
      !['text/plain', 'text/markdown', 'application/json'].includes(file.mimeType) ||
      typeof file.text !== 'string' || !file.text.length || file.text.includes('\0') || Buffer.byteLength(file.text) > 262144)
      throw invalidAttachments();
    seen.add(file.name);
    return { id: file.id, name: file.name, mimeType: file.mimeType, text: file.text };
  });
}
function invalidAttachments() {
  return Object.assign(new Error('Select at most eight supported, nonempty project files within the existing model context limits.'), { code: 'model_attachments_invalid', status: 400 });
}
