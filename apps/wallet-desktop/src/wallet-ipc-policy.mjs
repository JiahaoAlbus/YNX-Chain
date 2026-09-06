/** Only the installed local main frame can invoke custody and approval handlers. */
export function assertWalletIPC(event, contents, expectedURL) {
  if (!contents || contents.isDestroyed() || event?.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== expectedURL) {
    throw Object.assign(new Error("Wallet operations require its trusted local window."), { code: 4100, data: { code: "UNTRUSTED_WALLET_FRAME" } });
  }
}
