/** Local forms only. IPC sends credentials directly to the trusted main process. */
import {setWalletCopy} from "./wallet-locale.mjs";
import {renderPermissionError} from "./permission-error-ui.mjs";
export function renderRecoveryReview(node,{account,resetPassword,count},doc=node.ownerDocument){
  node.replaceChildren();
  for(const [key,values]of [
    ["Restore {account}.",{account}],
    [resetPassword?"A new local password will be set. {count} other account(s) will remain visible and need their own recovery. The old encrypted Wallet is retained.":"The current password and other protected accounts will be retained.",{count}],
    ["Existing app permissions will be revoked. Pending transactions remain recorded.",{}]
  ]){const span=doc.createElement("span");setWalletCopy(span,key,values);node.append(span,doc.createTextNode(" "))}
}
export function createPasswordVaultUI({ api, getKeyState, getAccountStatus, renderAccount, document: doc = document }) {
  const $ = selector => doc.querySelector(selector), passwordSheet = $("#password-sheet"), recoverySheet = $("#recovery-sheet");
  let generation = 0, viewIntent = 0, mode = "unlock", previewId = null, busy = false;
  const message = result => result?.error?.message ?? "Wallet could not complete this operation. It remains locked.";
  const showError = (node,result) => {if(!renderPermissionError(node,result?.error))node.textContent=message(result)};
  const clear = () => { for (const field of doc.querySelectorAll('#password-sheet input,#recovery-sheet input')) field.value = ""; };
  async function refreshPublicStatus() {
    const revision = getKeyState().revision, intent = viewIntent;
    try { const status = await api.accountStatus(); if (revision === getKeyState().revision && intent === viewIntent) renderAccount(status); }
    catch { if (revision === getKeyState().revision && intent === viewIntent) $("#unlock-result").textContent = "The current Wallet could not be read. Keep its files and reopen Wallet before continuing."; }
  }
  function cancel({ explicit = false } = {}) { if (explicit) viewIntent++; generation++; previewId = null; busy = false; clear(); passwordSheet.close(); recoverySheet.close(); }
  function render() {
    const status = getAccountStatus(), state = getKeyState();
    $("#recover-wallet").hidden = !(status?.accounts?.length > 0);
    $("#recover-wallet").disabled = state.authenticating;
    $("#unlock-wallet").disabled = !status || !state.unlockAvailable || state.authenticating;
    $("#legacy-copy-notice").hidden = !status?.legacyCleanupPending;
    setWalletCopy($("#legacy-copy-notice"),"Original OS-encrypted Wallet files are retained on this device for recovery. Those old copies are not protected by the new Wallet password.");
    setWalletCopy($("#unlock-wallet"),state.authenticating ? "Unlocking…" : status?.passwordConfigured ? "Unlock with local password" : status?.initialized ? "Set password and migrate accounts" : "Set local Wallet password");
  }
  function toggleRecovery() {
    const kind = $("#recovery-kind").value, reset = $("#recovery-password-mode").value === "reset";
    $("#recovery-value-group").hidden = ["encrypted-json", "previous-password"].includes(kind);
    $("#recovery-file-group").hidden = kind !== "encrypted-json";
    $("#recovery-history-group").hidden = kind !== "previous-password";
    $("#recovery-backup-password-group").hidden = !["encrypted-json", "previous-password"].includes(kind);
    $("#recovery-current-group").hidden = reset;
    $("#recovery-new-group").hidden = !reset;
    clear();
  }
  function setBusy(value) {
    busy = value;
    for (const control of doc.querySelectorAll('#password-form input,#password-form button,#recovery-form input,#recovery-form select,#recovery-form button,#commit-recovery')) control.disabled = value;
  }
  $("#unlock-wallet").addEventListener("click", () => {
    if (busy) return;
    viewIntent++; generation++; clear();
    const status = getAccountStatus(); mode = status?.passwordConfigured ? "unlock" : status?.initialized ? "migrate" : "setup";
    setWalletCopy($("#password-title"),mode === "unlock" ? "Unlock Wallet" : "Protect your Wallet");
    setWalletCopy($("#password-explanation"),mode === "unlock" ? "Enter the local password that encrypts this Wallet. It locks after two minutes, when you leave the app, or when you switch accounts." : "Choose a password of 12 to 256 characters. It encrypts your Wallet on this device. Keep your account backups safe; this password cannot be reset by YNX.");
    $("#local-password").autocomplete = mode === "unlock" ? "current-password" : "new-password";
    $("#local-confirm-group").hidden = mode === "unlock"; $("#local-confirm").required = mode !== "unlock";
    $("#migration-explanation").hidden = mode !== "migrate";
    setWalletCopy($("#submit-password"),mode === "unlock" ? "Unlock Wallet" : mode === "migrate" ? "Encrypt and migrate all accounts" : "Set local password");
    $("#password-result").textContent = ""; $("#unlock-result").textContent = ""; setBusy(false); passwordSheet.showModal(); $("#local-password").focus();
  });
  $("#password-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const token = generation, intent = viewIntent, operation = mode;
    let password = $("#local-password").value, confirmation = $("#local-confirm").value;
    if (operation !== "unlock" && password !== confirmation) { setWalletCopy($("#password-result"),"The two passwords do not match."); return; }
    clear(); setBusy(true);
    try {
      const result = operation === "unlock" ? await api.unlock({ password }) : await api.setupPassword({ password, confirmation, migrateLegacy: operation === "migrate" });
      if (intent !== viewIntent) return;
      // A successful state change may itself invalidate the UI generation; no old
      // finally may clear credentials entered in a newly opened dialog.
      if (result.ok) {
        if (token === generation) passwordSheet.close();
        setWalletCopy($("#unlock-result"),operation === "unlock" ? getKeyState().locked ? "The unlock attempt finished, but Wallet is now locked." : "Wallet unlocked. Review each request before approving." : "Password protection is saved. Unlock with your local password to continue.");
      } else { if (token === generation) showError($("#password-result"),result); showError($("#unlock-result"),result); }
    } catch { if (token === generation) setWalletCopy($("#password-result"),"Wallet did not finish. Reopen the current Wallet before continuing."); }
    finally { password = null; confirmation = null; if (intent === viewIntent) await refreshPublicStatus(); if (token === generation) setBusy(false); }
  });
  $("#recover-wallet").addEventListener("click", async () => {
    if (busy) return;
    const intent = ++viewIntent, expectedRevision = getKeyState().revision + 1;
    cancel();
    let locked;
    try { locked = await api.lock(); }
    catch { if (intent === viewIntent) $("#unlock-result").textContent = "Wallet could not enter recovery. Try again."; return; }
    // The lock notification may arrive before its IPC acknowledgement. A newer
    // view opened in that interval owns its draft; this old click cannot close it.
    if (intent !== viewIntent || locked?.revision !== expectedRevision || getKeyState().revision !== expectedRevision || !getKeyState().locked) return;
    const token = generation;
    const response = await api.accountStatus(); if (token !== generation) return;
    if (!response.ok) { showError($("#unlock-result"),response); return; }
    renderAccount(response);
    $("#recovery-account").replaceChildren();
    for (const item of response.value.accounts) { const option = doc.createElement("option"); option.value = item.account; if(item.state === "recovery-required")setWalletCopy(option,"{account} · recovery required",{account:item.ynxAccount});else option.textContent=item.ynxAccount; option.selected = item.account === response.value.account; $("#recovery-account").append(option); }
    const history = await api.recoveryHistory(); if (token !== generation) return;
    $("#recovery-history").replaceChildren();
    if (history.ok) for (const item of history.value) { const option = doc.createElement("option"); option.value = item.id; setWalletCopy(option,"Saved Wallet revision {revision} · {id}",{revision:item.revision,id:item.id.slice(0,12)}); $("#recovery-history").append(option); }
    $("#recovery-password-mode").value = response.value.passwordConfigured && !response.value.formatError ? "keep" : "reset";
    $("#recovery-form").hidden = false; $("#recovery-review").hidden = true; $("#recovery-result").textContent = "";
    previewId = null; toggleRecovery(); setBusy(false); recoverySheet.showModal();
  });
  $("#recovery-kind").addEventListener("change", toggleRecovery);
  $("#recovery-password-mode").addEventListener("change", toggleRecovery);
  $("#recovery-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const token = generation, revision = getKeyState().revision;
    let input = { account: $("#recovery-account").value, kind: $("#recovery-kind").value, value: $("#recovery-value").value, backupPassword: $("#recovery-backup-password").value, currentPassword: $("#recovery-current-password").value, resetPassword: $("#recovery-password-mode").value === "reset", newPassword: $("#recovery-new-password").value, confirmation: $("#recovery-confirm").value };
    const file = $("#recovery-file").files?.[0]; if (input.kind === "previous-password") input.value = $("#recovery-history").value;
    clear(); setBusy(true);
    try {
      if (input.kind === "encrypted-json") { if (!file || file.size > 100_000) throw new Error("Select an encrypted JSON backup smaller than 100 KB."); input.value = await file.text(); }
      if (token !== generation || revision !== getKeyState().revision) return;
      const result = await api.prepareRecovery(input);
      if (token !== generation || revision !== getKeyState().revision) return;
      if (!result.ok) { showError($("#recovery-result"),result); return; }
      previewId = result.value.previewId; $("#recovery-form").hidden = true; $("#recovery-review").hidden = false;
      renderRecoveryReview($("#recovery-summary"),{account:getAccountStatus()?.accounts?.find(item => item.account === result.value.account)?.ynxAccount ?? result.value.account,resetPassword:result.value.resetPassword,count:result.value.recoveryRequiredAccounts.length},doc);
      setWalletCopy($("#recovery-result"),"The backup matches this exact account. Confirm within one minute.");
    } catch (error) { if (token === generation) $("#recovery-result").textContent = error.message ?? "Recovery did not finish."; }
    finally { input = null; if (token === generation) setBusy(false); }
  });
  $("#commit-recovery").addEventListener("click", async () => {
    if (busy || !previewId) return;
    const token = generation, intent = viewIntent, id = previewId; previewId = null; setBusy(true);
    try {
      const result = await api.commitRecovery(id);
      if (intent !== viewIntent) return;
      if (result.ok) { if (token === generation) recoverySheet.close(); setWalletCopy($("#unlock-result"),"Account recovery is saved. Unlock with the current local password. Other accounts and pending transactions remain listed."); }
      else { if (token === generation) showError($("#recovery-result"),result); showError($("#unlock-result"),result); }
    } catch { if (token === generation) setWalletCopy($("#recovery-result"),"Recovery did not finish. Check the current Wallet before retrying."); }
    finally { if (intent === viewIntent) await refreshPublicStatus(); if (token === generation) setBusy(false); }
  });
  for (const button of doc.querySelectorAll("[data-custody-cancel]")) button.addEventListener("click", () => { cancel({ explicit: true }); void api.lock(); });
  for (const sheet of [passwordSheet, recoverySheet]) sheet.addEventListener("cancel", event => { event.preventDefault(); cancel({ explicit: true }); void api.lock(); });
  return Object.freeze({ render, cancel });
}
