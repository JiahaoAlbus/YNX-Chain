import { copy } from "./copy";
import catalog from "./wallet-download-catalog.json";
import { verifiedWalletPreviews } from "./wallet-downloads";

const previews = verifiedWalletPreviews(catalog);

export function WalletDownloads() {
  if (!previews.length) return null;
  return <section className="wallet-downloads" aria-labelledby="wallet-downloads-title">
    <h3 id="wallet-downloads-title">{copy("Get YNX Wallet test previews")}</h3>
    <p>{copy("Complete sign-in and transfer flows are still being verified.")}</p>
    {previews.map(preview => <article key={preview.id}>
      <a className="wallet-download-link" href={preview.url} download={preview.filename}>
        <span>{copy("Download for Chrome / Edge (ZIP)")}</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
      </a>
      <p>{copy("Manual installation; not a browser store release.")}</p>
      <p>{copy("Unzip the file. In Chrome or Edge extensions, enable Developer mode and choose Load unpacked. Then return here and refresh.")}</p>
    </article>)}
  </section>;
}
