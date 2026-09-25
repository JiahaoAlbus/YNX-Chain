/** Local forms only. IPC sends credentials directly to the trusted main process. */
export function createPasswordVaultUI({ api, getKeyState, getAccountStatus, renderAccount, translate = (english, parameters = {}) => english.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => Object.hasOwn(parameters, key) ? String(parameters[key]) : match), write = (node, english, parameters) => { node.textContent = translate(english, parameters); }, locale = () => "en", document: doc = document }) {
  const $ = selector => doc.querySelector(selector), passwordSheet = $("#password-sheet"), recoverySheet = $("#recovery-sheet");
  let generation = 0, viewIntent = 0, mode = "unlock", previewId = null, busy = false;
  const copy = (english, zh) => {
    const translated = translate(english);
    return translated !== english ? translated : locale() === "zh-CN" ? zh : english;
  };
  const message = result => {
    const error = result?.error;
    if (error?.code === "PASSWORD_VAULT_STORAGE_FAILED") {
      const stage = typeof error.storageStage === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(error.storageStage) ? error.storageStage : "unknown";
      return translate("Wallet storage could not complete ({stage}). Existing recovery files were retained. Reopen Wallet before continuing.", { stage });
    }
    if (error?.code === "PASSWORD_VAULT_UNLOCK_FAILED") return copy("The password is incorrect or this encrypted Wallet changed. It remains locked.", "密码不正确或加密钱包已变更。钱包仍处于锁定状态。");
    if (error?.code === "PASSWORD_VAULT_FILE_CHANGED") return copy("The stored Wallet changed. Reopen it before continuing; its previous files were retained.", "存储的钱包已变更。现有文件已保留，请重新打开钱包后继续。");
    const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? ` (${error.code})` : "";
    return `${copy("Wallet could not complete this operation. It remains locked.", "钱包未能完成此操作，仍处于锁定状态。")}${code}`;
  };
  const clear = () => { for (const field of doc.querySelectorAll('#password-sheet input,#recovery-sheet input')) field.value = ""; };
  async function refreshPublicStatus() {
    const revision = getKeyState().revision, intent = viewIntent;
    try { const status = await api.accountStatus(); if (revision === getKeyState().revision && intent === viewIntent) renderAccount(status); }
    catch { if (revision === getKeyState().revision && intent === viewIntent) $("#unlock-result").textContent = copy("The current Wallet could not be read. Keep its files and reopen Wallet before continuing.", "无法读取当前钱包。请保留现有文件并重新打开钱包。"); }
  }
  function cancel({ explicit = false } = {}) { if (explicit) viewIntent++; generation++; previewId = null; busy = false; clear(); passwordSheet.close(); recoverySheet.close(); }
  function render() {
    const status = getAccountStatus(), state = getKeyState();
    $("#recover-wallet").hidden = !(status?.accounts?.length > 0);
    $("#recover-wallet").disabled = state.authenticating;
    $("#unlock-wallet").disabled = !status || !state.unlockAvailable || state.authenticating;
    $("#legacy-copy-notice").hidden = !status?.legacyCleanupPending;
    $("#legacy-copy-notice").textContent = translate("Original OS-encrypted Wallet files are retained on this device for recovery. Those old copies are not protected by the new Wallet password.");
    $("#unlock-wallet").textContent = state.authenticating ? copy("Unlocking…", "正在解锁…") : status?.passwordConfigured ? copy("Unlock with local password", "使用本地密码解锁") : status?.initialized ? copy("Set password and migrate accounts", "设置密码并迁移账户") : copy("Set local Wallet password", "设置本地钱包密码");
    if (passwordSheet.open) {
      $("#password-title").textContent = mode === "unlock" ? copy("Unlock Wallet", "解锁钱包") : copy("Protect your Wallet", "保护您的钱包");
      $("#password-explanation").textContent = mode === "unlock" ? copy("Enter the local password that encrypts this Wallet. It locks after two minutes, when you leave the app, or when you switch accounts.", "输入加密此钱包的本地密码。离开应用、切换账户或两分钟后，钱包会自动锁定。") : copy("Choose a password of 12 to 256 characters. It encrypts your Wallet on this device. Keep your account backups safe; this password cannot be reset by YNX.", "设置 12 至 256 个字符的本地密码，在此设备上加密钱包。请妥善保存账户备份；YNX 无法重置此密码。");
      $("#submit-password").textContent = mode === "unlock" ? copy("Unlock Wallet", "解锁钱包") : mode === "migrate" ? copy("Encrypt and migrate all accounts", "加密并迁移全部账户") : copy("Set local password", "设置本地密码");
    }
    if (recoverySheet.open) {
      for (const option of $("#recovery-account").options) if (option.dataset.accountAddress) option.textContent = option.dataset.recoveryRequired === "true" ? translate("{address} · recovery required", { address: option.dataset.accountAddress }) : option.dataset.accountAddress;
      for (const option of $("#recovery-history").options) if (option.dataset.revision) option.textContent = translate("Saved Wallet revision {revision} · {id}", { revision: option.dataset.revision, id: option.dataset.shortId });
    }
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
    $("#password-title").textContent = mode === "unlock" ? copy("Unlock Wallet", "解锁钱包") : copy("Protect your Wallet", "保护您的钱包");
    $("#password-explanation").textContent = mode === "unlock" ? copy("Enter the local password that encrypts this Wallet. It locks after two minutes, when you leave the app, or when you switch accounts.", "输入加密此钱包的本地密码。离开应用、切换账户或两分钟后，钱包会自动锁定。") : copy("Choose a password of 12 to 256 characters. It encrypts your Wallet on this device. Keep your account backups safe; this password cannot be reset by YNX.", "设置 12 至 256 个字符的本地密码，在此设备上加密钱包。请妥善保存账户备份；YNX 无法重置此密码。");
    $("#local-password").autocomplete = mode === "unlock" ? "current-password" : "new-password";
    $("#local-confirm-group").hidden = mode === "unlock"; $("#local-confirm").required = mode !== "unlock";
    $("#migration-explanation").hidden = mode !== "migrate";
    $("#submit-password").textContent = mode === "unlock" ? copy("Unlock Wallet", "解锁钱包") : mode === "migrate" ? copy("Encrypt and migrate all accounts", "加密并迁移全部账户") : copy("Set local password", "设置本地密码");
    $("#password-result").textContent = ""; $("#unlock-result").textContent = ""; setBusy(false); passwordSheet.showModal(); $("#local-password").focus();
  });
  $("#password-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const token = generation, operation = mode;
    let password = $("#local-password").value, confirmation = $("#local-confirm").value;
    if (operation !== "unlock" && password !== confirmation) { $("#password-result").textContent = copy("The two passwords do not match.", "两次输入的密码不一致。"); return; }
    clear(); setBusy(true);
    try {
      const result = operation === "unlock" ? await api.unlock({ password }) : await api.setupPassword({ password, confirmation, migrateLegacy: operation === "migrate" });
      // A successful state change may itself invalidate the UI generation; no old
      // finally may clear credentials entered in a newly opened dialog.
      if (result.ok) {
        if (token === generation) passwordSheet.close();
        $("#unlock-result").textContent = operation === "unlock" ? getKeyState().locked ? copy("The unlock attempt finished, but Wallet is now locked.", "解锁操作已结束，但钱包目前仍处于锁定状态。") : copy("Wallet unlocked. Review each request before approving.", "钱包已解锁。批准前请逐项核对请求。") : copy("Password protection is saved. Unlock with your local password to continue.", "密码保护已保存。请使用本地密码解锁后继续。");
      } else { if (token === generation) $("#password-result").textContent = message(result); $("#unlock-result").textContent = message(result); }
    } catch { if (token === generation) $("#password-result").textContent = copy("Wallet did not finish. Reopen the current Wallet before continuing.", "钱包操作未完成。请重新打开当前钱包后继续。"); }
    finally { password = null; confirmation = null; await refreshPublicStatus(); if (token === generation) setBusy(false); }
  });
  $("#recover-wallet").addEventListener("click", async () => {
    if (busy) return;
    const intent = ++viewIntent, expectedRevision = getKeyState().revision + 1;
    cancel();
    let locked;
    try { locked = await api.lock(); }
    catch { if (intent === viewIntent) $("#unlock-result").textContent = translate("Wallet could not enter recovery. Try again."); return; }
    // The lock notification may arrive before its IPC acknowledgement. A newer
    // view opened in that interval owns its draft; this old click cannot close it.
    if (intent !== viewIntent || locked?.revision !== expectedRevision || getKeyState().revision !== expectedRevision || !getKeyState().locked) return;
    const token = generation;
    const response = await api.accountStatus(); if (token !== generation) return;
    if (!response.ok) { $("#unlock-result").textContent = message(response); return; }
    renderAccount(response);
    $("#recovery-account").replaceChildren();
    for (const item of response.value.accounts) { const option = doc.createElement("option"); option.value = item.account; option.dataset.accountAddress = item.ynxAccount; option.dataset.recoveryRequired = String(item.state === "recovery-required"); option.textContent = item.state === "recovery-required" ? translate("{address} · recovery required", { address: item.ynxAccount }) : item.ynxAccount; option.selected = item.account === response.value.account; $("#recovery-account").append(option); }
    const history = await api.recoveryHistory(); if (token !== generation) return;
    $("#recovery-history").replaceChildren();
    if (history.ok) for (const item of history.value) { const option = doc.createElement("option"); option.value = item.id; option.dataset.revision = String(item.revision); option.dataset.shortId = item.id.slice(0, 12); option.textContent = translate("Saved Wallet revision {revision} · {id}", { revision: item.revision, id: option.dataset.shortId }); $("#recovery-history").append(option); }
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
      if (!result.ok) { $("#recovery-result").textContent = message(result); return; }
      previewId = result.value.previewId; $("#recovery-form").hidden = true; $("#recovery-review").hidden = false;
      write($("#recovery-summary"), result.value.resetPassword ? "Restore {account}. A new local password will be set. {count} other accounts will remain visible and need their own recovery. The old encrypted Wallet is retained. Existing app permissions will be revoked. Pending transactions remain recorded." : "Restore {account}. The current password and other protected accounts will be retained. Existing app permissions will be revoked. Pending transactions remain recorded.", { account: getAccountStatus()?.accounts?.find(item => item.account === result.value.account)?.ynxAccount ?? result.value.account, count: result.value.recoveryRequiredAccounts.length });
      $("#recovery-result").textContent = translate("The backup matches this exact account. Confirm within one minute.");
    } catch { if (token === generation) $("#recovery-result").textContent = translate("Recovery did not finish. Check the current Wallet before retrying."); }
    finally { input = null; if (token === generation) setBusy(false); }
  });
  $("#commit-recovery").addEventListener("click", async () => {
    if (busy || !previewId) return;
    const token = generation, id = previewId; previewId = null; setBusy(true);
    try {
      const result = await api.commitRecovery(id);
      if (result.ok) { if (token === generation) recoverySheet.close(); $("#unlock-result").textContent = translate("Account recovery is saved. Unlock with the current local password. Other accounts and pending transactions remain listed."); }
      else { if (token === generation) $("#recovery-result").textContent = message(result); $("#unlock-result").textContent = message(result); }
    } catch { if (token === generation) $("#recovery-result").textContent = translate("Recovery did not finish. Check the current Wallet before retrying."); }
    finally { await refreshPublicStatus(); if (token === generation) setBusy(false); }
  });
  for (const button of doc.querySelectorAll("[data-custody-cancel]")) button.addEventListener("click", () => { cancel({ explicit: true }); void api.lock(); });
  for (const sheet of [passwordSheet, recoverySheet]) sheet.addEventListener("cancel", event => { event.preventDefault(); cancel({ explicit: true }); void api.lock(); });
  return Object.freeze({ render, cancel });
}
