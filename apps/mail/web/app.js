const state = {
  token: "",
  user: null,
  folder: "inbox",
  messages: [],
  selected: null,
  attachments: [],
  draft: null,
  aiJob: null,
};
if ((navigator.language || "").toLowerCase().startsWith("ar")) {
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
}
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const body = await response
    .json()
    .catch(() => ({ detail: "服务返回了无效响应" }));
  if (!response.ok) {
    if (response.status === 401) {
      signOut(false);
    }
    throw new Error(body.detail || body.error || `请求失败 ${response.status}`);
  }
  return body;
}
function updateNetwork() {
  const offline = !navigator.onLine;
  $("#offline").hidden = !offline;
  $("#confirm-send").disabled = offline;
  if (offline) $("#draft-state").textContent = "离线草稿保存在此设备";
}
async function beginSignIn(recovery = false) {
  const status = $("#signin-state");
  status.textContent = `Web companion 不接收 Wallet 回调。请在已安装的 YNX Mail 中使用 canonical request envelope 完成${recovery ? "恢复" : "登录"}；中央 registry/Gateway 部署前会失败关闭。`;
}
async function restoreSession() {
  try {
    const result = await api("/v1/auth/session");
    state.token = "cookie";
    state.user = result.user;
  } catch {
    state.token = "";
    state.user = null;
  }
}
function signOut(notify = true) {
  state.token = "";
  state.user = null;
  $("#signin").hidden = false;
  if (notify) toast("Mail 会话已退出");
}
async function loadMessages() {
  if (!state.token) return;
  $("#app").setAttribute("aria-busy", "true");
  try {
    const q = $("#search").value.trim();
    state.messages =
      (await api(
        `/v1/messages?folder=${encodeURIComponent(state.folder)}&q=${encodeURIComponent(q)}`,
      )) || [];
    renderMessages();
  } catch (error) {
    toast(error.message);
  } finally {
    $("#app").setAttribute("aria-busy", "false");
  }
}
function renderMessages() {
  const root = $("#messages");
  root.replaceChildren();
  $("#empty").hidden = state.messages.length > 0;
  $("#inbox-count").textContent =
    state.folder === "inbox"
      ? state.messages.length
      : $("#inbox-count").textContent;
  for (const m of state.messages) {
    const button = document.createElement("button");
    button.className = `message${state.selected?.id === m.id ? " selected" : ""}`;
    button.type = "button";
    button.setAttribute("role", "listitem");
    button.innerHTML = `<span class="sender-dot" aria-hidden="true"></span><span><h3>${escapeHTML(m.sender_handle)}</h3><p><b>${escapeHTML(m.subject || "（无主题）")}</b> · ${escapeHTML(m.body)}</p></span><time datetime="${escapeHTML(m.created_at)}">${new Date(m.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>`;
    button.addEventListener("click", () => openMessage(m));
    root.append(button);
  }
}
async function openMessage(message) {
  state.selected = message;
  renderMessages();
  $("#ai-begin").disabled = false;
  $("#ai-preview").textContent =
    `只会选择：${message.subject || "（无主题）"}。点击后再获取 provider、模型与成本，尚不会发送内容。`;
  try {
    const thread = await api(
      `/v1/threads/${encodeURIComponent(message.thread_id)}`,
    );
    const pane = $("#reading-pane");
    pane.classList.add("open");
    pane.innerHTML = `<header class="reader-header"><span class="eyebrow">线程 · ${thread.length} 封</span><h1>${escapeHTML(message.subject || "（无主题）")}</h1><div class="identity"><span><b>${escapeHTML(message.sender_handle)}</b><br><small>发送给 ${message.to.map(escapeHTML).join("、")}</small></span><span class="verified">✓ 签名发件人身份</span></div></header><div class="thread">${thread.map((m) => `<section><div class="identity"><b>${escapeHTML(m.sender_handle)}</b><time>${new Date(m.created_at).toLocaleString()}</time></div><div class="reader-body">${escapeHTML(m.body)}</div>${renderAttachments(m.attachments)}<div class="delivery">${m.deliveries.map((d) => `<span class="pill ${d.state}">${escapeHTML(d.recipient)} · ${escapeHTML(d.state)}${d.reason ? " · " + escapeHTML(d.reason) : ""}</span>`).join("")}</div></section>`).join("")}</div><footer class="reader-actions"><button class="primary" id="reply">回复</button><button class="quiet" data-move="archive">归档</button><button class="quiet" data-move="spam">标记垃圾邮件</button><button class="quiet" id="report">Trust 举报</button><button class="quiet" id="close-reader">返回</button></footer>`;
    $("#reply").onclick = () => openCompose(message);
    $("#close-reader").onclick = () => pane.classList.remove("open");
    $$("[data-move]").forEach(
      (b) => (b.onclick = () => moveMessage(message.id, b.dataset.move)),
    );
    $("#report").onclick = () => reportMessage(message.id);
  } catch (error) {
    toast(error.message);
  }
}
function renderAttachments(items = []) {
  if (!items.length) return "";
  return `<div class="attachment-list">${items.map((a) => `<div class="attachment"><span>${escapeHTML(a.name)} · ${Math.ceil(a.size / 1024)} KB</span><button class="quiet" type="button" data-attachment="${escapeHTML(a.id || a.sha256)}">下载 · SHA-256 ${escapeHTML(a.sha256.slice(0, 10))}…</button></div>`).join("")}</div>`;
}
async function moveMessage(id, folder) {
  try {
    await api(`/v1/messages/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ folder }),
    });
    toast(folder === "archive" ? "已归档，可从归档恢复" : "已移至垃圾邮件");
    state.selected = null;
    await loadMessages();
  } catch (error) {
    toast(error.message);
  }
}
async function reportMessage(id) {
  const reason = prompt(
    "请说明 Trust 举报原因（至少 8 个字符）。不会自动屏蔽或处罚对方。",
  );
  if (!reason) return;
  try {
    await api("/v1/reports", {
      method: "POST",
      body: JSON.stringify({ MessageID: id, Reason: reason }),
    });
    toast("Trust 举报已提交，可在审计记录中追踪并申诉");
  } catch (error) {
    toast(error.message);
  }
}
function openCompose(reply = null) {
  state.attachments = [];
  state.draft = null;
  $("#attachment-list").replaceChildren();
  $("#to").value = reply ? reply.sender_handle : "";
  $("#subject").value = reply
    ? `Re: ${reply.subject.replace(/^Re:\s*/i, "")}`
    : "";
  $("#body").value = "";
  $("#compose-form").dataset.thread = reply?.thread_id || "";
  const local = JSON.parse(
    localStorage.getItem("ynx.mail.offlineDraft") || "null",
  );
  if (!reply && local) {
    $("#to").value = local.to || "";
    $("#subject").value = local.subject || "";
    $("#body").value = local.body || "";
    $("#draft-state").textContent = "已恢复设备草稿";
  }
  $("#compose-dialog").showModal();
  $("#to").focus();
}
function saveLocalDraft() {
  const draft = {
    to: $("#to").value,
    subject: $("#subject").value,
    body: $("#body").value,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem("ynx.mail.offlineDraft", JSON.stringify(draft));
  $("#draft-state").textContent =
    `设备草稿 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
async function prepareAttachments(files) {
  state.attachments = [];
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (file.size > 10 * 1024 * 1024 || total > 10 * 1024 * 1024) {
      toast("单个或合计附件不能超过 10 MB");
      state.attachments = [];
      break;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    state.attachments.push({
      name: file.name,
      media_type: file.type || "application/octet-stream",
      size: file.size,
      sha256: hash,
      content_base64: btoa(binary),
    });
  }
  $("#attachment-list").innerHTML = renderAttachments(state.attachments);
}
async function reviewDraft(event) {
  event.preventDefault();
  saveLocalDraft();
  if (!navigator.onLine) {
    toast("离线时只保存草稿，不会发送");
    return;
  }
  const recipients = $("#to")
    .value.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const draft = {
    thread_id: $("#compose-form").dataset.thread || undefined,
    to: recipients,
    subject: $("#subject").value,
    body: $("#body").value,
    attachments: state.attachments,
  };
  try {
    state.draft = await api("/v1/drafts", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    $("#review-content").innerHTML =
      `<p><b>收件人：</b>${recipients.map(escapeHTML).join("、")}</p><p><b>主题：</b>${escapeHTML(draft.subject || "（无主题）")}</p><p><b>正文：</b>${escapeHTML(draft.body.slice(0, 220))}${draft.body.length > 220 ? "…" : ""}</p><p><b>附件：</b>${draft.attachments.length} 个，合计 ${draft.attachments.reduce((n, a) => n + a.size, 0)} bytes</p>`;
    $("#compose-dialog").close();
    $("#send-review").showModal();
  } catch (error) {
    toast(error.message);
  }
}
async function confirmSend() {
  if (!state.draft) return;
  $("#confirm-send").disabled = true;
  try {
    const message = await api(`/v1/drafts/${state.draft.id}/send`, {
      method: "POST",
      body: "{}",
    });
    const failed = message.deliveries.filter((d) => d.state === "failed");
    localStorage.removeItem("ynx.mail.offlineDraft");
    $("#send-review").close();
    toast(
      failed.length
        ? `已发送，${failed.length} 个收件人投递失败`
        : "已批准并完成 YNX 内部投递",
    );
    state.draft = null;
    await loadMessages();
  } catch (error) {
    toast(error.message);
  } finally {
    $("#confirm-send").disabled = !navigator.onLine;
  }
}
async function beginAI() {
  if (!state.selected) return;
  try {
    const kind = $("#ai-kind").value,
      contextIDs =
        kind === "organize"
          ? [...new Set(state.messages.map((message) => message.id))].slice(
              0,
              20,
            )
          : [state.selected.id];
    state.aiJob = await api("/v1/ai/jobs", {
      method: "POST",
      body: JSON.stringify({ kind, context_ids: contextIDs }),
    });
    $("#ai-preview").innerHTML =
      `<b>数据范围</b><br>${escapeHTML(state.aiJob.context_preview)}<br><br><b>Provider / 模型</b><br>${escapeHTML(state.aiJob.provider)} · ${escapeHTML(state.aiJob.model)}<br><br><b>成本估算</b><br>${escapeHTML(state.aiJob.cost_estimate || "由 Gateway 结算")}<br><small>批准后才会发送选中的 ${contextIDs.length} 封邮件内容。</small>`;
    $("#ai-begin").textContent = "批准并开始（可取消）";
    $("#ai-begin").onclick = approveAI;
  } catch (error) {
    toast(error.message);
  }
}
async function approveAI() {
  const jobID = state.aiJob.id;
  $("#ai-result").innerHTML =
    '<div class="permission-card">AI 正在运行并流式记录状态。<button class="quiet" id="ai-cancel">取消生成</button></div>';
  $("#ai-cancel").onclick = () => reviewAI("cancel");
  try {
    const job = await api(`/v1/ai/jobs/${jobID}/approve`, {
      method: "POST",
      body: "{}",
    });
    if (job.state === "cancelled") {
      toast("AI 生成已取消，晚到结果不会应用");
      return;
    }
    state.aiJob = job;
    $("#ai-result").innerHTML =
      `<div class="ai-output">${escapeHTML(job.result)}</div><p>结果尚未改变邮件或发送任何内容。</p><div class="reader-actions"><button class="primary" id="ai-apply">审阅并应用</button><button class="quiet" id="ai-reject">拒绝并保留审计</button></div>`;
    $("#ai-apply").onclick = () => reviewAI("apply");
    $("#ai-reject").onclick = () => reviewAI("reject");
  } catch (error) {
    if (!String(error.message).includes("canceled")) toast(error.message);
  }
}
async function reviewAI(decision) {
  try {
    const job = state.aiJob;
    await api(`/v1/ai/jobs/${job.id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    if (
      decision === "apply" &&
      (job.kind === "draft_reply" || job.kind === "translate")
    ) {
      openCompose(state.selected);
      $("#body").value = job.result;
      saveLocalDraft();
      toast("AI 结果仅应用到草稿，仍需发送审批");
    } else if (decision === "apply") {
      toast("AI 建议已保留；未发送或移动任何邮件");
    } else if (decision === "cancel") {
      toast("AI 生成已取消");
    } else toast("AI 结果已拒绝");
    state.aiJob = null;
    $("#ai-result").replaceChildren();
  } catch (error) {
    toast(error.message);
  }
}
function init() {
  restoreSession().then(async () => {
    if (state.token && state.user) {
      $("#signin").hidden = true;
      $("#account").textContent = state.user.handle
        .replace("@", "")
        .slice(0, 2)
        .toUpperCase();
      await loadMessages();
    } else $("#signin").hidden = false;
    $("#app").setAttribute("aria-busy", "false");
  });
  $("#wallet-signin").onclick = beginSignIn;
  $("#account").onclick = showAccount;
  $("#compose").onclick = () => openCompose();
  $("#compose-form").onsubmit = reviewDraft;
  $("#attachments").onchange = (e) => prepareAttachments(e.target.files);
  ["#to", "#subject", "#body"].forEach((s) =>
    $(s).addEventListener("input", () => {
      clearTimeout(window.saveDraftTimer);
      window.saveDraftTimer = setTimeout(saveLocalDraft, 500);
    }),
  );
  $("#confirm-send").onclick = confirmSend;
  $("#back-edit").onclick = () => {
    $("#send-review").close();
    $("#compose-dialog").showModal();
  };
  $$(".folder").forEach(
    (b) =>
      (b.onclick = () => {
        $$(".folder").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.folder = b.dataset.folder;
        $("#folder-label").textContent = b.textContent.trim();
        loadMessages();
      }),
  );
  $("#refresh").onclick = loadMessages;
  let searchTimer;
  $("#search").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadMessages, 250);
  };
  $("#ai-open").onclick = () => {
    $("#ai-panel").hidden = false;
    $("#ai-open").setAttribute("aria-expanded", "true");
  };
  $("#ai-close").onclick = () => {
    $("#ai-panel").hidden = true;
    $("#ai-open").setAttribute("aria-expanded", "false");
  };
  $("#ai-begin").onclick = beginAI;
  addEventListener("online", () => {
    updateNetwork();
    toast("网络已恢复，可批准发送");
  });
  addEventListener("offline", updateNetwork);
  updateNetwork();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}
async function showAccount() {
  const dialog = document.createElement("dialog");
  dialog.className = "review-dialog";
  dialog.innerHTML = `<div class="review-card"><span class="eyebrow">数据与会话</span><h2>Mail 账户</h2><p>${escapeHTML(state.user?.handle || "")}</p><p>导出包含 Mail 数据与审计记录，不包含 Wallet 密钥或账户哈希。</p><div class="detail-actions"><button class="quiet" data-action="export">导出 JSON</button><button class="quiet" data-action="logout">撤销此设备会话</button><button class="quiet danger-action" data-action="delete">删除 Mail 账户</button><button class="primary" data-action="close">关闭</button></div></div>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  dialog.querySelector('[data-action="export"]').onclick = async () => {
    try {
      const data = await api("/v1/account/export"),
        link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      link.download = "ynx-mail-export.json";
      link.click();
      URL.revokeObjectURL(link.href);
      toast("Mail 数据导出已生成");
    } catch (e) {
      toast(e.message);
    }
  };
  dialog.querySelector('[data-action="logout"]').onclick = () => {
    if (confirm("撤销此 Mail 设备会话并退出？"))
      api("/v1/auth/session", { method: "DELETE", body: "{}" }).finally(() =>
        signOut(),
      );
  };
  dialog.querySelector('[data-action="delete"]').onclick = async () => {
    const phrase = prompt("此操作不可撤销。输入 DELETE MAIL ACCOUNT 继续：");
    if (phrase !== "DELETE MAIL ACCOUNT")
      return toast("确认短语不匹配，未删除");
    try {
      await api("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: phrase }),
      });
      dialog.close();
      signOut(false);
      toast("Mail 账户已删除并保留最小审计墓碑");
    } catch (e) {
      toast(e.message);
    }
  };
  dialog.showModal();
}
init();
$("#wallet-signin").onclick = () => beginSignIn(false);
$("#wallet-recover").onclick = () => beginSignIn(true);
const auditButton = document.createElement("button");
auditButton.className = "avatar";
auditButton.textContent = "审";
auditButton.setAttribute("aria-label", "打开审计与 Trust 案件");
auditButton.onclick = showAudit;
$("#ai-open").before(auditButton);
async function showAudit() {
  try {
    const [audit, cases] = await Promise.all([
      api("/v1/audit"),
      api("/v1/reports"),
    ]);
    const dialog = document.createElement("dialog");
    dialog.className = "review-dialog";
    const card = document.createElement("div");
    card.className = "review-card";
    card.innerHTML =
      '<span class="eyebrow">账户证据</span><h2>审计与 Trust 案件</h2><p>仅显示当前 Mail 账户可访问的操作和案件。</p>';
    const list = document.createElement("div");
    for (const entry of audit.slice(-20).reverse()) {
      const row = document.createElement("p");
      row.textContent = `${new Date(entry.created_at).toLocaleString()} · ${entry.action}`;
      list.append(row);
    }
    for (const item of cases) {
      const row = document.createElement("div");
      row.className = "permission-card";
      row.textContent = `Trust ${item.id} · ${item.state} · ${item.reason}`;
      if (item.state !== "appealed") {
        const button = document.createElement("button");
        button.className = "quiet";
        button.textContent = "提交申诉";
        button.onclick = async () => {
          const text = prompt("申诉说明（至少 8 个字符）");
          if (!text) return;
          try {
            await api(`/v1/reports/${item.id}/appeal`, {
              method: "POST",
              body: JSON.stringify({ text }),
            });
            dialog.close();
            toast("Trust 申诉已提交并写入审计");
          } catch (e) {
            toast(e.message);
          }
        };
        row.append(button);
      }
      list.append(row);
    }
    card.append(list);
    const close = document.createElement("button");
    close.className = "primary";
    close.textContent = "关闭";
    close.onclick = () => dialog.close();
    card.append(close);
    dialog.append(card);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  } catch (e) {
    toast(e.message);
  }
}
