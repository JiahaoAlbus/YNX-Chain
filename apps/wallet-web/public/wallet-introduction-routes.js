// Root marketing is never an SDK entry. Only the original known #connect=
// protocol is forwarded to the SAME-origin preserved Wallet document.
export function originalWalletIntroductionDestination(input) {
  const url=new URL(input);
  if (!['/','/index.html'].includes(url.pathname)) return null;
  if (!url.hash.startsWith('#connect=')) return null;
  return `/app.html${url.search}${url.hash}`;
}
export function originalWalletExplicitApp(input) {
  const url=new URL(input);
  return `/app.html${url.search}`;
}
