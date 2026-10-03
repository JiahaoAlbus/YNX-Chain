export function applyCardBuildIdentityShell(html,identity) {
  if(typeof html!=="string" || !html.includes("</body>") || !/<title>[^<]*<\/title>/i.test(html))throw Error("Missing Card product shell");
  if(!["qa","testnet-release"].includes(identity.releaseChannel) || !/^[a-f0-9]{40}$/.test(identity.sourceCommit) ||
     typeof identity.appVersion!=="string" || !/^[0-9A-Za-z.+-]{1,80}$/.test(identity.appVersion))throw Error("Invalid Card shell identity");
  const qa=identity.releaseChannel==="qa";
  const title=qa?`YNX Card QA | ${identity.appVersion}`:`YNX Card | ${identity.appVersion}`;
  const badge=qa?`<aside id="ynx-card-qa-build" role="note" aria-label="QA build, not the formal Card release" translate="no" class="notranslate" style="position:fixed;bottom:12px;left:12px;z-index:2147483647;max-width:calc(100vw - 24px);padding:10px 14px;background:#101820;color:#fff;border:2px solid #fff;border-radius:8px;font:600 13px/1.5 sans-serif;overflow-wrap:anywhere">YNX Card QA / Testnet only<br>Version ${identity.appVersion} / Source ${identity.sourceCommit}<br>Not the formal release. No real payments.</aside>`:"";
  return html.replace(/<title>[^<]*<\/title>/i,`<title>${title}</title>`)
    .replace(/<body\b/i,`<body data-ynx-card-release-channel="${identity.releaseChannel}" data-ynx-card-source="${identity.sourceCommit}"`)
    .replace("</body>",`${badge}\n</body>`);
}
