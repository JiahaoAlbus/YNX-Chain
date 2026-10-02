// Exact existing AI Gateway contract. Selected pasted text is prompt content,
// never represented as an owned file or implicitly included history.
export function reviewedHostedPrompt(system, prompt) {
  const value = `${system}\n\n${prompt}`;
  if (Buffer.byteLength(value) > 8000)
    throw Object.assign(new Error('The reviewed request exceeds the existing model service limit of 8000 UTF-8 bytes. Shorten the request or selected text.'), { code: 'model_prompt_limit', status: 413 });
  return value;
}

export function existingHostedRequest(input) {
  return {
    session: input.hostedSession,
    prompt: reviewedHostedPrompt(input.system, input.prompt),
    outputLanguage: input.outputLanguage,
    includedContext: [],
    excludedContext: ['conversation', 'selected_files', 'selected_chain_records', 'selected_trust_records', 'selected_product_context'],
    attachments: [],
    productContexts: [],
    continueFrom: '',
  };
}
