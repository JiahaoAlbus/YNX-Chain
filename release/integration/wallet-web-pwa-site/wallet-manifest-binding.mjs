export const WALLET_ROUTE = "/dapp/wallet";
export const WALLET_MANIFEST_HREF = "/wallet/companion/manifest.webmanifest";

const inertBinding = Object.freeze({
  bound: false,
  created: false,
  previousHref: null,
  cleanup() {},
});

export function bindWalletManifest(documentLike, pathname) {
  if (pathname !== WALLET_ROUTE) return inertBinding;
  if (!documentLike?.head || typeof documentLike.querySelector !== "function") {
    throw new TypeError("A document with a head and querySelector is required");
  }

  let link = documentLike.querySelector('link[rel="manifest"]');
  const created = !link;
  const previousHref = link?.getAttribute("href") ?? null;

  if (!link) {
    link = documentLike.createElement("link");
    link.setAttribute("rel", "manifest");
    documentLike.head.append(link);
  }
  link.setAttribute("href", WALLET_MANIFEST_HREF);

  let cleaned = false;
  return {
    bound: true,
    created,
    previousHref,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (created) {
        link.remove();
      } else if (previousHref === null) {
        link.removeAttribute("href");
      } else {
        link.setAttribute("href", previousHref);
      }
    },
  };
}
