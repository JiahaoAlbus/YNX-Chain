/** Installed Windows-only V3 custody gate. Prints public state and fixed error codes only. */
const [mode, expectedAccount = ""] = process.argv.slice(2);
const password = process.env.YNX_WALLET_QA_PASSWORD;
if (!["create", "restore"].includes(mode) || typeof password !== "string" || password.length < 12) throw new Error("Installed V3 gate input is incomplete");

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
    return JSON.stringify({
      account: account.ok ? { initialized: account.value.initialized, passwordConfigured: account.value.passwordConfigured, account: account.value.account, ynxAccount: account.value.ynxAccount, custody: account.value.custody, recoveryRequired: account.value.recoveryRequired } : null,
      error: account.ok ? null : { code: account.error?.code, storageStage: account.error?.storageStage },
      locked: security.locked,
      ui: { title: document.querySelector('#account-title')?.textContent, detail: document.querySelector('#account-detail')?.textContent, passwordResult: document.querySelector('#password-result')?.textContent, unlockResult: document.querySelector('#unlock-result')?.textContent, passwordSheetOpen: document.querySelector('#password-sheet')?.open, unlockEnabled: !document.querySelector('#unlock-wallet')?.disabled, unlockLabel: document.querySelector('#unlock-wallet')?.textContent }
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
  throw new Error(`${label}: ${JSON.stringify(state)}`);
}
async function formSubmit(value, confirmation) {
  const expectedUnlock = confirmation === undefined;
  const opened = await evaluate(`(() => {
    const open = document.querySelector('#unlock-wallet');
    if (open.disabled) return { enabled: false };
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
  if (mode === "create") {
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
    console.log(JSON.stringify({ mode, passwordPersisted: true, accountCreated: true, wrongPasswordRejected: true, sameAccountAfterUnlock: true, account: created.account.account, ynxAccount: created.account.ynxAccount, custody: created.account.custody }));
  } else {
    if (!before.account.initialized || before.account.account !== expectedAccount || !before.locked) throw new Error(`Installed restore gate found different public account: ${JSON.stringify(before)}`);
    await until(state => state.ui.unlockEnabled && /Unlock with local password|使用本地密码解锁/i.test(state.ui.unlockLabel), "Cold restart unlock UI readiness");
    await formSubmit(password);
    const restored = await until(state => state.locked === false && state.account?.account === expectedAccount, "Cold restart password unlock");
    console.log(JSON.stringify({ mode, sameAccountAfterRestart: true, account: restored.account.account, ynxAccount: restored.account.ynxAccount, custody: restored.account.custody }));
  }
} finally {
  socket.close();
}
