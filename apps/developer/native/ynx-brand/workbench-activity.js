// Installed only by the reviewed derived-runtime builder, before workbench code.
// This capability is scoped to this admitted document; it is not a family token.
(() => {
  const boot = document.currentScript;
  const capability = "__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__";
  boot?.remove();
  if (window !== window.top || capability.startsWith("__YNX_")) return;
  const send = window.fetch.bind(window);
  const add = document.addEventListener.bind(document);
  const closest = Element.prototype.closest;
  const uuid = crypto.randomUUID.bind(crypto);
  const stringify = JSON.stringify;
  const now = Date.now;
  let last = -Infinity, pending = false, retired = false;
  window.addEventListener("pagehide", () => { retired = true; }, { once: true });
  function userAction(event) {
    if (retired || pending || !event.isTrusted || !(event.target instanceof Element)) return;
    const editor = closest.call(event.target, ".monaco-editor textarea.inputarea");
    const terminal = closest.call(event.target, ".terminal .xterm-helper-textarea");
    let action;
    if (event.type === "beforeinput" && editor && !event.isComposing) action = "edit";
    else if (event.type === "keydown" && editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") action = "save";
    else if (event.type === "keydown" && terminal && !event.isComposing && !event.metaKey && (event.key.length === 1 || event.key === "Enter" || event.key === "Backspace")) action = "terminal-input";
    if (!action || now() - last < 30000) return;
    last = now(); pending = true;
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 10000);
    // Never send text, filenames, commands, tokens or refresh handles.
    send("/runtime/workbench-activity", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, signal: abort.signal,
      body: stringify({ capability, eventId: uuid(), action }) })
      .then(response => { if (response.status === 401 || response.status === 403) retired = true; })
      .catch(() => {}) // An uncertain activity request is not retried as idle keepalive.
      .finally(() => { clearTimeout(timeout); pending = false; });
  }
  add("beforeinput", userAction, true);
  add("keydown", userAction, true);
})();
