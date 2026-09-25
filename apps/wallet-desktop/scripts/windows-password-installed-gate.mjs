/** Installed Windows-only V3 custody gate. Prints public state and fixed error codes only. */
import { Wallet } from "ethers";
import path from "node:path";

const [mode, expectedAccount = ""] = process.argv.slice(2);
const password = process.env.YNX_WALLET_QA_PASSWORD;
if (!["create", "restore", "import", "backup-start", "backup-result", "import-backup", "offline-create", "offline-restore", "locale-set", "locale-restore"].includes(mode) || typeof password !== "string" || password.length < 12) throw new Error("Installed V3 gate input is incomplete");
const importFixtures = Array.from({ length: 6 }, (_, index) => {
  const key = `0x${(0x42 + index).toString(16).repeat(32)}`; // Public, disposable fixtures; never user keys.
  return { key, account: new Wallet(key).address.toLowerCase() };
});

async function target() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9334/json/list")).json();
      const page = pages.find(item => item.type === "page" && item.url?.startsWith("file:") && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("WALLET_PAGE_UNAVAILABLE");
}

const socket = new WebSocket((await target()).webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
async function evaluate(expression, stage) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener("message", listener); reject(new Error(`${stage}:PAGE_RESPONSE_TIMEOUT`)); }, 30_000);
    const listener = event => {
      let reply;
      try { reply = JSON.parse(event.data); } catch { return; }
      if (reply.id !== id) return;
      clearTimeout(timeout); socket.removeEventListener("message", listener);
      if (reply.error || reply.result?.exceptionDetails) {
        const reported = reply.result?.exceptionDetails?.exception?.className;
        const errorClass = ["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(reported) ? reported.toUpperCase() : "UNKNOWN";
        reject(new Error(`${stage}:PAGE_EVALUATION_${errorClass}`));
      }
      else resolve(reply.result?.result?.value);
    };
    socket.addEventListener("message", listener);
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}
async function protocol(method, params, stage) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener("message", listener); reject(new Error(`${stage}:PAGE_RESPONSE_TIMEOUT`)); }, 30_000);
    const listener = event => {
      let reply;
      try { reply = JSON.parse(event.data); } catch { return; }
      if (reply.id !== id) return;
      clearTimeout(timeout); socket.removeEventListener("message", listener);
      if (reply.error) reject(new Error(`${stage}:PROTOCOL_REJECTED`));
      else resolve(reply.result);
    };
    socket.addEventListener("message", listener);
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}
async function waitForPreload() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await evaluate(`Boolean(window.ynxWallet && typeof window.ynxWallet.accountStatus === "function" && typeof window.ynxWallet.securityStatus === "function")`, "PRELOAD_READY");
    if (ready === true) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("PRELOAD_READY:WALLET_API_UNAVAILABLE");
}
async function snapshot() {
  return JSON.parse(await evaluate(`(async () => {
    const [account, security] = await Promise.all([window.ynxWallet.accountStatus(), window.ynxWallet.securityStatus()]);
    const unlock = document.querySelector('#unlock-wallet');
    return JSON.stringify({
      account: account.ok ? { initialized: account.value.initialized, passwordConfigured: account.value.passwordConfigured, account: account.value.account, ynxAccount: account.value.ynxAccount, accounts: account.value.accounts?.map(item => item.account), custody: account.value.custody, recoveryRequired: account.value.recoveryRequired } : null,
      error: account.ok ? null : { code: account.error?.code, storageStage: account.error?.storageStage },
      locked: security.locked,
      ui: { title: document.querySelector('#account-title')?.textContent, detail: document.querySelector('#account-detail')?.textContent, passwordResult: document.querySelector('#password-result')?.textContent, unlockResult: document.querySelector('#unlock-result')?.textContent, passwordSheetOpen: document.querySelector('#password-sheet')?.open, unlockEnabled: Boolean(unlock && !unlock.disabled && unlock.getClientRects().length), unlockLabel: unlock?.textContent, importEnabled: !document.querySelector('#import-form button')?.disabled, importResult: document.querySelector('#import-result')?.textContent, backupEnabled: !document.querySelector('#save-backup')?.disabled, backupVisible: !document.querySelector('#backup-section')?.hidden, backupResult: document.querySelector('#backup-result')?.textContent }
    });
  })()`, "ACCOUNT_SNAPSHOT"));
}
async function until(predicate, label, count = 100) {
  let state;
  for (let attempt = 0; attempt < count; attempt++) {
    state = await snapshot();
    if (predicate(state)) return state;
    if (state.error || /storage could not|存储未能完成|storage cannot be read|无法读取钱包存储/i.test(`${state.ui.passwordResult} ${state.ui.unlockResult} ${state.ui.detail}`)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const visible = `${state?.ui?.passwordResult ?? ""} ${state?.ui?.unlockResult ?? ""} ${state?.ui?.detail ?? ""} ${state?.ui?.importResult ?? ""} ${state?.ui?.backupResult ?? ""}`;
  const stage = /Reference: ([a-z][a-z0-9-]{0,79})\./.exec(visible)?.[1] ?? null;
  throw new Error(`${label}: ${JSON.stringify({ account: state?.account && { initialized: state.account.initialized, passwordConfigured: state.account.passwordConfigured, account: state.account.account, custody: state.account.custody }, error: state?.error, locked: state?.locked, storageStage: stage, ui: { passwordSheetOpen: state?.ui?.passwordSheetOpen, unlockEnabled: state?.ui?.unlockEnabled, importEnabled: state?.ui?.importEnabled, backupEnabled: state?.ui?.backupEnabled, backupVisible: state?.ui?.backupVisible, importSucceeded: /Account imported|账户已导入/i.test(state?.ui?.importResult ?? ""), backupSaved: /Encrypted backup saved|加密备份已保存/i.test(state?.ui?.backupResult ?? "") } })}`);
}
async function formSubmit(value, confirmation) {
  const expectedUnlock = confirmation === undefined;
  // The public 0.6.8 renderer can report custody through preload before its
  // account-status event has enabled the visible password action. Exercise the
  // real button only once it is interactive; a persistent disabled/error state
  // still fails with the bounded, public-status diagnostic from until().
  await until(state => state.ui.unlockEnabled === true && !state.ui.passwordSheetOpen, "Password action ready", 60);
  const opened = await evaluate(`(() => {
    const open = document.querySelector('#unlock-wallet');
    if (!open || open.disabled || !open.getClientRects().length) return { enabled: false };
    open.click();
    return { enabled: true, sheetOpen: document.querySelector('#password-sheet').open, unlockMode: document.querySelector('#local-confirm-group').hidden };
  })()`, "PASSWORD_FORM_OPEN");
  if (!opened?.enabled) throw new Error("PASSWORD_FORM_OPEN:BUTTON_DISABLED");
  if (!opened.sheetOpen) throw new Error("PASSWORD_FORM_OPEN:SHEET_CLOSED");
  if (opened.unlockMode !== expectedUnlock) throw new Error("PASSWORD_FORM_OPEN:MODE_MISMATCH");
  await evaluate(`(() => {
    const form = document.querySelector('#password-form');
    document.querySelector('#local-password').value = ${JSON.stringify(value)};
    document.querySelector('#local-confirm').value = ${JSON.stringify(confirmation ?? "")};
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`, "PASSWORD_FORM_SUBMIT");
}

try {
  await waitForPreload();
  const before = await until(state => state.account !== null, "Initial installed Wallet custody status");
  if (mode.startsWith("offline-")) {
    const network = await evaluate(`(async () => { const status=await window.ynxWallet.status(); return { available: status.available }; })()`, "OFFLINE_NETWORK_STATUS");
    if (network?.available !== false) throw new Error("OFFLINE_NETWORK_NOT_PROVEN");
    let visible = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      visible = await evaluate(`/unavailable|不可用/i.test(document.querySelector('#network')?.textContent ?? '')`, "OFFLINE_NETWORK_UI");
      if (visible) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!visible) throw new Error("OFFLINE_NETWORK_UI_NOT_PROVEN");
  }
  if (mode === "locale-set" || mode === "locale-restore") {
    const version = process.env.YNX_WALLET_EXPECTED_VERSION;
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || before.account.account !== expectedAccount || !before.account.initialized || !before.locked) throw new Error("LOCALE_ACCOUNT_OR_VERSION_UNAVAILABLE");
    if (mode === "locale-set") await evaluate(`(() => { document.querySelector('nav [data-view="settings"]').click(); const select=document.querySelector('#display-language'); select.value='ar'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`, "LOCALE_SELECT_ARABIC");
    let displayed;
    for (let attempt = 0; attempt < 40; attempt++) {
      displayed = await evaluate(`(async () => { const info=await window.ynxWallet.appInfo(); return { version:info?.version, visible:document.querySelector('#wallet-version')?.textContent, lang:document.documentElement.lang, dir:document.documentElement.dir, selected:document.querySelector('#display-language')?.value, account:(await window.ynxWallet.accountStatus()).value?.account, locked:(await window.ynxWallet.securityStatus()).locked }; })()`, "LOCALE_INSTALLED_SNAPSHOT");
      if (displayed?.version === version && displayed.visible?.includes(version) && displayed.lang === "ar" && displayed.dir === "rtl" && displayed.selected === "ar") break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (displayed?.version !== version || !displayed.visible?.includes(version) || displayed.lang !== "ar" || displayed.dir !== "rtl" || displayed.selected !== "ar" || displayed.account !== expectedAccount || displayed.locked !== true) throw new Error("LOCALE_DISPLAY_OR_CUSTODY_CHANGED");
    console.log(JSON.stringify({ mode, version, arabicRTL: true, preferenceRetained: mode === "locale-restore", samePublicAccount: true, remainedLocked: true, account: expectedAccount }));
  } else if (mode === "backup-result") {
    if (!before.account.initialized || before.account.account !== expectedAccount) throw new Error("BACKUP_RESULT_ACCOUNT_UNAVAILABLE");
    await until(state => /Encrypted backup saved|加密备份已保存/i.test(state.ui.backupResult), "Native backup file saved");
    console.log(JSON.stringify({ mode, nativeBackupSaved: true, account: before.account.account }));
  } else if (mode === "import-backup") {
    const file = process.env.YNX_WALLET_QA_BACKUP_FILE;
    const backupPassword = process.env.YNX_WALLET_QA_BACKUP_PASSWORD;
    if (!path.win32.isAbsolute(file ?? "") || typeof backupPassword !== "string" || backupPassword.length < 12 || !expectedAccount || before.account.initialized || before.account.passwordConfigured) throw new Error("BACKUP_IMPORT_INPUT_UNAVAILABLE");
    await until(state => state.ui.unlockEnabled && /Set local Wallet password|设置本地钱包密码/i.test(state.ui.unlockLabel), "Backup import setup UI readiness");
    await formSubmit(password, password);
    await until(state => state.account?.passwordConfigured && !state.account.initialized, "Backup import password persistence");
    await until(state => state.ui.unlockEnabled && /Unlock with local password|使用本地密码解锁/i.test(state.ui.unlockLabel), "Backup import unlock UI readiness");
    await formSubmit(password);
    await until(state => !state.locked && !state.account?.initialized, "Backup import unlock");
    await until(state => state.ui.importEnabled, "Backup import UI readiness");
    await evaluate(`(() => { document.querySelector('nav [data-view="accounts"]').click(); const kind=document.querySelector('#import-kind'); kind.value='encrypted-json'; kind.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, "BACKUP_IMPORT_KIND");
    const documentNode = await protocol("DOM.getDocument", { depth: 1 }, "BACKUP_FILE_DOCUMENT");
    const fileNode = await protocol("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#import-file" }, "BACKUP_FILE_INPUT");
    if (!fileNode?.nodeId) throw new Error("BACKUP_FILE_INPUT_UNAVAILABLE");
    await protocol("DOM.setFileInputFiles", { nodeId: fileNode.nodeId, files: [file] }, "BACKUP_FILE_SELECT");
    const submitted = await evaluate(`(() => {
      const form=document.querySelector('#import-form');
      if (form.querySelector('button').disabled || !document.querySelector('#import-file').files?.length) return false;
      document.querySelector('#import-password').value=${JSON.stringify(backupPassword)};
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()`, "BACKUP_IMPORT_SUBMIT");
    if (!submitted) throw new Error("BACKUP_IMPORT_SUBMIT:FORM_UNAVAILABLE");
    const imported = await until(state => !state.locked && state.account?.account === expectedAccount && state.account?.custody === "password-encrypted-local", "Backup file restored same public account");
    console.log(JSON.stringify({ mode, imported: true, account: imported.account.account, ynxAccount: imported.account.ynxAccount, custody: imported.account.custody }));
  } else if (mode === "create" || mode === "offline-create") {
    if (before.account.initialized || before.account.passwordConfigured || !before.locked) throw new Error("Installed create gate requires a fresh, locked Wallet profile");
    await formSubmit(password, password);
    await until(state => state.account?.passwordConfigured === true && state.account.initialized === false, "Password persistence");
    await until(state => state.ui.unlockEnabled && /Unlock with local password|使用本地密码解锁/i.test(state.ui.unlockLabel), "Password unlock UI readiness");
    await formSubmit(password);
    await until(state => state.locked === false && state.account?.passwordConfigured === true, "Password unlock");
    await evaluate(`(() => { document.querySelector('nav [data-view="accounts"]')?.click(); document.querySelector('#create-account')?.click(); return true; })()`, "ACCOUNT_CREATE_CLICK");
    const created = await until(state => state.account?.initialized === true && state.locked === false, "Account creation");
    await evaluate(`document.querySelector('#lock-wallet')?.click(); true`, "EXPLICIT_LOCK_CLICK");
    await until(state => state.locked === true, "Explicit lock");
    await formSubmit("incorrect synthetic password");
    await until(state => state.locked === true && /incorrect|不正确/i.test(`${state.ui.passwordResult} ${state.ui.unlockResult}`), "Wrong password leaves Wallet locked");
    await formSubmit(password);
    await until(state => state.locked === false && state.account?.account === created.account.account, "Correct password restores the same account");
    console.log(JSON.stringify({ mode, passwordPersisted: true, accountCreated: true, wrongPasswordRejected: true, sameAccountAfterUnlock: true, account: created.account.account, ynxAccount: created.account.ynxAccount, custody: created.account.custody, ...(mode === "offline-create" ? { rpcUnavailableDuringAccountCreation: true } : {}) }));
  } else {
    if (!before.account.initialized || before.account.account !== expectedAccount || !before.locked) throw new Error("INSTALLED_RESTORE_ACCOUNT_OR_LOCK_MISMATCH");
    await until(state => state.ui.unlockEnabled && /Unlock with local password|使用本地密码解锁/i.test(state.ui.unlockLabel), "Cold restart unlock UI readiness");
    await formSubmit(password);
    const restored = await until(state => state.locked === false && state.account?.account === expectedAccount, "Cold restart password unlock");
    if (mode === "restore" || mode === "offline-restore") console.log(JSON.stringify({ mode, sameAccountAfterRestart: true, account: restored.account.account, ynxAccount: restored.account.ynxAccount, custody: restored.account.custody, ...(mode === "offline-restore" ? { rpcUnavailableDuringRestart: true } : {}) }));
    else if (mode === "backup-start") {
        const backupPassword = process.env.YNX_WALLET_QA_BACKUP_PASSWORD;
        if (typeof backupPassword !== "string" || backupPassword.length < 12) throw new Error("BACKUP_PASSWORD_UNAVAILABLE");
        await until(state => state.ui.backupVisible && state.ui.backupEnabled, "Backup UI readiness");
        const submitted = await evaluate(`(() => {
          document.querySelector('nav [data-view="accounts"]').click();
          const section=document.querySelector('#backup-section'); section.open=true;
          const form=document.querySelector('#backup-form');
          if (form.querySelector('button').disabled) return false;
          document.querySelector('#backup-password').value=${JSON.stringify(backupPassword)};
          document.querySelector('#backup-confirm').value=${JSON.stringify(backupPassword)};
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return true;
        })()`, "BACKUP_FORM_SUBMIT");
        if (!submitted) throw new Error("BACKUP_FORM_SUBMIT:BUTTON_DISABLED");
        console.log(JSON.stringify({ mode, backupSubmittedThroughInstalledUI: true, account: restored.account.account }));
    } else {
      let imported;
      for (const [index, fixture] of importFixtures.entries()) {
        if (fixture.account === expectedAccount) throw new Error("IMPORT_FIXTURE_ACCOUNT_COLLISION");
        // The product deliberately locks after inactivity or focus loss. Each
        // native import may take long enough to cross that boundary; resume
        // through the visible password dialog before the next one.
        const prior = await snapshot();
        if (prior.locked) {
          await until(state => state.ui.unlockEnabled && /Unlock with local password|使用本地密码解锁/i.test(state.ui.unlockLabel), `Import ${index + 1} unlock UI readiness`);
          await formSubmit(password);
          await until(state => !state.locked && state.account?.accounts?.includes(expectedAccount), `Import ${index + 1} password unlock`);
        }
        await until(state => state.ui.importEnabled, `Import ${index + 1} UI readiness`);
        const submitted = await evaluate(`(() => {
          document.querySelector('nav [data-view="accounts"]').click();
          const form = document.querySelector('#import-form');
          if (form.querySelector('button').disabled) return false;
          document.querySelector('#import-kind').value = 'private-key';
          document.querySelector('#import-value').value = ${JSON.stringify(fixture.key)};
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return true;
        })()`, `ACCOUNT_IMPORT_${index + 1}_SUBMIT`);
        if (!submitted) throw new Error(`ACCOUNT_IMPORT_${index + 1}_SUBMIT:BUTTON_DISABLED`);
        imported = await until(state => state.account?.account === fixture.account && state.locked === false && [expectedAccount, ...importFixtures.slice(0, index + 1).map(item => item.account)].every(account => state.account?.accounts?.includes(account)), `Encrypted account import ${index + 1}`);
      }
      console.log(JSON.stringify({ mode, imported: true, importCount: importFixtures.length, originalAccountRetained: true, allPreviousAccountsRetained: true, account: imported.account.account, originalAccount: expectedAccount, custody: imported.account.custody }));
    }
  }
} finally {
  socket.close();
}
