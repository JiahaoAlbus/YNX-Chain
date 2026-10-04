// matrix/login.mjs
var MATRIX_LOGIN_CALLBACK = "/matrix/login/callback";
var SOCIAL_ORIGIN = "https://social.ynxweb4.com";
var consumedCallbacks = /* @__PURE__ */ new WeakSet();
var fail = (code, message) => Object.assign(new Error(message), { code });
function secureRoot(value, localQA) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("MATRIX_UNSAFE_ORIGIN", "A fixed secure homeserver is required");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !(url.protocol === "https:" || localQA && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw fail("MATRIX_UNSAFE_ORIGIN", "A fixed secure homeserver is required");
  return url;
}
function productOrigin(value, localQA) {
  const url = secureRoot(value, localQA);
  if (url.origin !== SOCIAL_ORIGIN && !(localQA && ["localhost", "127.0.0.1"].includes(url.hostname))) throw fail("MATRIX_CALLBACK_ORIGIN", "The registered Social callback is required");
  return url.origin;
}
function handleMatrixLoginCallback({ environment = globalThis, callbackOrigin = SOCIAL_ORIGIN, localQA = false, callbackHref = environment.location.href } = {}) {
  const url = new URL(callbackHref), current = new URL(environment.location.href), origin = productOrigin(callbackOrigin, localQA);
  if (url.origin !== origin || url.pathname !== MATRIX_LOGIN_CALLBACK || current.origin !== origin || current.pathname !== MATRIX_LOGIN_CALLBACK) return false;
  const token = url.searchParams.get("loginToken"), state = url.searchParams.get("state");
  const valid = url.searchParams.getAll("loginToken").length === 1 && url.searchParams.getAll("state").length === 1 && typeof token === "string" && token.length > 0 && token.length <= 8192 && /^[a-f0-9]{64}$/.test(state ?? "");
  environment.history.replaceState(null, "", MATRIX_LOGIN_CALLBACK);
  const status = environment.document?.getElementById?.("callback-status") ?? environment.document?.body;
  if (consumedCallbacks.has(environment)) {
    if (status) status.textContent = "This sign-in callback has already been used. Return to Social and retry.";
    return true;
  }
  consumedCallbacks.add(environment);
  if (valid && environment.opener) {
    if (status) status.textContent = "Sign-in returned to Social. You can close this window.";
    environment.opener.postMessage({ type: "ynx-social-matrix-login-token", state, loginToken: token }, origin);
    environment.close();
  } else if (status) status.textContent = "Matrix sign-in callback is unavailable or expired. Return to Social and retry.";
  return true;
}

// matrix/login-callback-entry.mjs
var zhCopy = /* @__PURE__ */ new Map([
  ["Return to YNX Social", "\u8FD4\u56DE YNX Social"],
  ["Return to your conversation.", "\u8FD4\u56DE\u4F60\u7684\u5BF9\u8BDD\u3002"],
  ["Return to Social", "\u8FD4\u56DE Social"],
  ["Sign-in returned to Social. You can close this window.", "\u767B\u5F55\u7ED3\u679C\u5DF2\u8FD4\u56DE Social\uFF0C\u53EF\u4EE5\u5173\u95ED\u6B64\u7A97\u53E3\u3002"],
  ["This sign-in callback has already been used. Return to Social and retry.", "\u6B64\u767B\u5F55\u56DE\u8C03\u5DF2\u4F7F\u7528\u3002\u8BF7\u8FD4\u56DE Social \u91CD\u8BD5\u3002"],
  ["Matrix sign-in callback is unavailable or expired. Return to Social and retry.", "Matrix \u767B\u5F55\u56DE\u8C03\u4E0D\u53EF\u7528\u6216\u5DF2\u8FC7\u671F\u3002\u8BF7\u8FD4\u56DE Social \u91CD\u8BD5\u3002"],
  ["This sign-in callback is unavailable. Return to Social and retry.", "\u6B64\u767B\u5F55\u56DE\u8C03\u4E0D\u53EF\u7528\u3002\u8BF7\u8FD4\u56DE Social \u91CD\u8BD5\u3002"],
  ["Sign-in could not return to Social. Return to Social and retry.", "\u767B\u5F55\u7ED3\u679C\u672A\u80FD\u8FD4\u56DE Social\u3002\u8BF7\u8FD4\u56DE Social \u91CD\u8BD5\u3002"]
]);
function callbackLocale(environment) {
  try {
    const current = new URL(environment.location.href), opener = environment.opener;
    if (current.origin === "https://social.ynxweb4.com" && opener && new URL(opener.location.href).origin === current.origin) {
      return /^zh(?:-|$)/i.test(opener.document?.documentElement?.lang ?? "") ? "zh-CN" : "en";
    }
  } catch {
  }
  return "en";
}
function runMatrixLoginCallbackPage({ callbackHref, environment = globalThis } = {}) {
  const status = environment.document?.getElementById?.("callback-status");
  const locale = callbackLocale(environment), copy = (text) => locale === "zh-CN" ? zhCopy.get(text) ?? text : text;
  if (environment.document?.documentElement) environment.document.documentElement.lang = locale;
  if (environment.document) {
    environment.document.title = copy("Return to YNX Social");
    for (const [id, text] of [["callback-title", "Return to your conversation."], ["callback-return", "Return to Social"]]) {
      const node = environment.document.getElementById?.(id);
      if (node) node.textContent = copy(text);
    }
  }
  try {
    if (typeof callbackHref !== "string" || !handleMatrixLoginCallback({ environment, callbackHref })) {
      if (status) status.textContent = copy("This sign-in callback is unavailable. Return to Social and retry.");
      return false;
    }
    if (status) status.textContent = copy(status.textContent);
    return true;
  } catch {
    if (status) status.textContent = copy("Sign-in could not return to Social. Return to Social and retry.");
    return false;
  }
}
export {
  runMatrixLoginCallbackPage
};
