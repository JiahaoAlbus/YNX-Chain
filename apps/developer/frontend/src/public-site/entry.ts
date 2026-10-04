export function isPublicDeveloperEntry(location: Pick<Location, 'pathname' | 'search' | 'hash'>, nativeWorkspace: unknown): boolean {
  if (nativeWorkspace) return false;
  if (!['/', '/index.html', '/about'].includes(location.pathname)) return false;
  const query = new URLSearchParams(location.search);
  if ([...query.keys()].some(key => key !== 'lang')) return false;
  return !location.hash || ['#features', '#platforms', '#help', '#main', '#top'].includes(location.hash);
}
export function publicLanguage(search: string): 'zh' | 'en' {
  return new URLSearchParams(search).get('lang') === 'en' ? 'en' : 'zh';
}
