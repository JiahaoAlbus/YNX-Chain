// Shared backend contract for ordinary text-project paths. This validates bytes
// as supplied; it never silently normalizes a user's filename into another one.
export function isWorkspacePath(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 240 &&
    /^[\p{L}\p{M}\p{N}_./ +@-]+$/u.test(value) && !value.startsWith('/') &&
    !value.split('/').some(part => !part || part === '.' || part === '..');
}
