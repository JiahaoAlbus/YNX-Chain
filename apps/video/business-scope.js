export function videoScope(path, method = 'GET') {
  method = method.toUpperCase();
  if (path.includes('..') || path.includes('//')) throw new Error('Invalid Video API route.');
  const id = '[A-Za-z0-9_-]+';
  if (['GET', 'HEAD'].includes(method)) {
    if (path === '/v1/account') return 'video:account';
    if (/^\/v1\/(history|playlists|subscriptions)$/.test(path)) return 'video:library';
    if (new RegExp(`^/v1/(videos|videos/${id}(/comments)?|channels/${id})$`).test(path) || /^\/media\/[A-Za-z0-9_./-]+$/.test(path) && !path.includes('..')) return 'video:playback';
  }
  if (method === 'POST') {
    if (path === '/v1/playlists' || new RegExp(`^/v1/(playlists/${id}/videos|channels/${id}/subscription|videos/${id}/watch)$`).test(path)) return 'video:library';
    if (new RegExp(`^/v1/(videos/${id}/(comments|reports)|reports/${id}/appeals)$`).test(path)) return 'video:account';
  }
  if (method === 'PUT' && new RegExp(`^/v1/channels/${id}/subscription$`).test(path)) return 'video:library';
  if (method === 'DELETE') {
    if (new RegExp(`^/v1/(channels/${id}/subscription|playlists/${id}(/videos/${id})?)$`).test(path)) return 'video:library';
    if (path === '/v1/privacy/account-data') return 'video:account';
  }
  throw new Error('This operation is not available to a Video account.');
}
