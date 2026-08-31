/**
 * A small, accessible identity reference for the two independently discovered
 * standard-wallet providers. The MetaMask mark is deliberately original and
 * neutral: it is not a copied third-party logo and is never a YNX substitute.
 */
export function WalletIdentityMark({ kind }: { kind: "ynx-wallet" | "metamask" }) {
  const ynx = kind === "ynx-wallet";
  return (
    <span aria-label={ynx ? "YNX Wallet identity mark" : "MetaMask identity mark"} role="img" title={ynx ? "YNX Wallet" : "MetaMask"} style={{ display: "inline-flex", width: 22, height: 22, verticalAlign: "middle", marginRight: 6 }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
        {ynx
          ? <><path fill="#2453d4" d="M12 1 23 12 12 23 1 12Z" /><path fill="#fff" d="M7 7h3l2 4 2-4h3l-5 10h-1L7 7Z" /></>
          : <><path fill="#f6851b" d="m12 1 10 6v10l-10 6L2 17V7l10-6Z" /><path fill="#fff" d="M6.5 17V7h2.2l3.3 4.8L15.3 7h2.2v10h-2V10.6l-3.5 5h-.6l-3.5-5V17h-2Z" /></>}
      </svg>
    </span>
  );
}
