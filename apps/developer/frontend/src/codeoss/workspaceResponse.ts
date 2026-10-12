// Preserve the HTTP status for identity retirement even when a proxy returns
// an empty/HTML response. No response is converted into a successful catalog.
export async function readWorkspaceResponse(response: Response) {
  const unavailable = () => Object.assign(new Error('The workspace connection is unavailable. Refresh your projects or try again later.'), {
    status: response.status, code: 'WORKSPACE_RESPONSE_UNREADABLE',
  });
  let value;
  try { value = await response.json(); } catch { throw unavailable(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value;
}
