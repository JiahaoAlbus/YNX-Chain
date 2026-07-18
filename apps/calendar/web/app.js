const state = {
  token: "",
  user: null,
  view: localStorage.getItem("ynx.calendar.view") || "week",
  focusDate: new Date(),
  weekStart: startOfWeek(new Date()),
  occurrences: [],
  selected: null,
  selectedEvent: null,
  pendingChange: null,
  editing: null,
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
function toast(m) {
  const el = $("#toast");
  el.textContent = m;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function plusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function localInput(d) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 16);
}
function mutationID() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const r = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const body = await r.json().catch(() => ({ detail: "服务响应无效" }));
  if (!r.ok) {
    if (r.status === 401) signOut(false);
    throw new Error(body.detail || body.error || `请求失败 ${r.status}`);
  }
  return body;
}
async function beginSignIn(recovery = false) {
  $("#signin-state").textContent =
    `Web companion 不接收 Wallet 回调。请在已安装的 YNX Calendar 中使用 canonical request envelope 完成${recovery ? "恢复" : "登录"}；中央 registry/Gateway 部署前会失败关闭。`;
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
function signOut(show = true) {
  state.token = "";
  state.user = null;
  $("#signin").hidden = false;
  if (show) toast("Calendar 会话已撤销");
}
function renderFrame() {
  const days = $("#days");
  days.replaceChildren();
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const visibleDays = state.view === "day" ? 1 : 7;
  const firstDay = state.view === "day" ? state.focusDate : state.weekStart;
  for (let i = 0; i < visibleDays; i++) {
    const d = plusDays(firstDay, i),
      el = document.createElement("div");
    el.className = `day-head${d.toDateString() === new Date().toDateString() ? " today" : ""}`;
    el.innerHTML = `<span>${weekdays[(d.getDay() + 6) % 7]}</span><b>${d.getDate()}</b>`;
    days.append(el);
  }
  if (state.view === "month") {
    days.innerHTML = weekdays
      .map((name) => `<div class="day-head"><span>${name}</span></div>`)
      .join("");
    $("#range").textContent = state.focusDate.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
  } else if (state.view === "day") {
    $("#range").textContent = state.focusDate.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } else {
    $("#range").textContent =
      `${state.weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${plusDays(state.weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  days.style.gridTemplateColumns = `repeat(${visibleDays}, minmax(120px, 1fr))`;
  $("#timeline").dataset.view = state.view;
  $$("[data-view]").forEach((button) =>
    button.classList.toggle("active", button.dataset.view === state.view),
  );
  const hours = $("#hours");
  hours.replaceChildren();
  for (let h = 0; h < 24; h++) {
    const e = document.createElement("span");
    e.className = "hour-label";
    e.style.top = `${h * 60}px`;
    e.textContent = `${String(h).padStart(2, "0")}:00`;
    hours.append(e);
  }
}
async function loadEvents() {
  if (!state.token) return;
  renderFrame();
  $("#app").setAttribute("aria-busy", "true");
  let fromDate = state.weekStart,
    toDate = plusDays(state.weekStart, 7);
  if (state.view === "day") {
    fromDate = new Date(state.focusDate);
    fromDate.setHours(0, 0, 0, 0);
    toDate = plusDays(fromDate, 1);
  } else if (state.view === "month") {
    fromDate = new Date(
      state.focusDate.getFullYear(),
      state.focusDate.getMonth(),
      1,
    );
    fromDate = startOfWeek(fromDate);
    toDate = plusDays(fromDate, 42);
  }
  const from = fromDate.toISOString(),
    to = toDate.toISOString();
  try {
    state.occurrences =
      (await api(
        `/v1/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )) || [];
    renderEvents();
  } catch (e) {
    toast(e.message);
  } finally {
    $("#app").setAttribute("aria-busy", "false");
  }
}
function renderEvents() {
  const week = $("#week");
  week.replaceChildren();
  week.className = state.view === "month" ? "week month-grid" : "week";
  if (state.view === "month") {
    renderMonthEvents(week);
    return;
  }
  $("#empty").hidden = state.occurrences.length > 0;
  const overlap = new Set();
  for (let i = 0; i < state.occurrences.length; i++)
    for (let j = i + 1; j < state.occurrences.length; j++) {
      const a = state.occurrences[i],
        b = state.occurrences[j];
      if (
        new Date(a.start_utc) < new Date(b.end_utc) &&
        new Date(b.start_utc) < new Date(a.end_utc)
      ) {
        overlap.add(`${a.event_id}:${a.start_utc}`);
        overlap.add(`${b.event_id}:${b.start_utc}`);
      }
    }
  for (const o of state.occurrences) {
    const start = new Date(o.start_utc),
      end = new Date(o.end_utc),
      day = state.view === "day" ? 0 : (start.getDay() + 6) % 7,
      minutes = start.getHours() * 60 + start.getMinutes(),
      duration = Math.max(30, (end - start) / 60000),
      el = document.createElement("button");
    el.className = `event${overlap.has(`${o.event_id}:${o.start_utc}`) ? " conflict" : ""}`;
    const width = state.view === "day" ? 100 : 14.2857;
    el.style.left = `calc(${day} * ${width}% + 3px)`;
    el.style.width = `calc(${width}% - 6px)`;
    el.style.top = `${minutes}px`;
    el.style.height = `${duration}px`;
    el.innerHTML = `<b>${escapeHTML(o.title)}</b><span>${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;
    el.setAttribute(
      "aria-label",
      `${o.title}，${start.toLocaleString()} 到 ${end.toLocaleTimeString()}`,
    );
    el.onclick = () => openEvent(o);
    week.append(el);
  }
}
function renderMonthEvents(month) {
  const first = startOfWeek(
    new Date(state.focusDate.getFullYear(), state.focusDate.getMonth(), 1),
  );
  for (let i = 0; i < 42; i++) {
    const date = plusDays(first, i),
      cell = document.createElement("section");
    cell.className = `month-day${date.getMonth() === state.focusDate.getMonth() ? "" : " outside"}${date.toDateString() === new Date().toDateString() ? " today" : ""}`;
    cell.innerHTML = `<time datetime="${date.toISOString().slice(0, 10)}">${date.getDate()}</time>`;
    for (const occurrence of state.occurrences.filter(
      (o) => new Date(o.start_utc).toDateString() === date.toDateString(),
    )) {
      const button = document.createElement("button");
      button.className = "month-event";
      button.textContent = `${new Date(occurrence.start_utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${occurrence.title}`;
      button.onclick = () => openEvent(occurrence);
      cell.append(button);
    }
    month.append(cell);
  }
}
function populateTimeZones() {
  const zones = Intl.supportedValuesOf?.("timeZone") || [
    "Asia/Shanghai",
    "UTC",
    "America/Los_Angeles",
    "Europe/London",
  ];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  $("#timezone").innerHTML = zones
    .map(
      (z) =>
        `<option${z === local ? " selected" : ""}>${escapeHTML(z)}</option>`,
    )
    .join("");
  $("#zone-label").textContent = local;
}
function openForm(event = null) {
  state.editing = event;
  const start = event
    ? new Date(event.start_utc)
    : new Date(Date.now() + 3600000);
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
  const end = event
    ? new Date(event.end_utc)
    : new Date(start.getTime() + 3600000);
  $("#title").value = event?.title || "";
  $("#description").value = event?.description || "";
  $("#start").value = localInput(start);
  $("#end").value = localInput(end);
  $("#timezone").value =
    event?.time_zone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  $("#recurrence").value = event?.recurrence?.frequency || "";
  $("#count").value = event?.recurrence?.count || 1;
  $("#invitees").value = (event?.invites || []).map((i) => i.handle).join(", ");
  $("#meeting-link").value = event?.meeting_link || "";
  $("#event-title").textContent = event ? "修改事件" : "安排时间";
  $("#event-dialog").showModal();
  $("#title").focus();
}
function eventInput() {
  const freq = $("#recurrence").value;
  return {
    title: $("#title").value,
    description: $("#description").value,
    local_start: $("#start").value,
    local_end: $("#end").value,
    time_zone: $("#timezone").value,
    recurrence: freq
      ? { frequency: freq, interval: 1, count: Number($("#count").value) }
      : { frequency: "", interval: 0, count: 0 },
    invitees: $("#invitees")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    reminders: [
      { minutes_before: Number($("#reminder").value), channel: "local" },
    ],
    meeting_link: $("#meeting-link").value,
    client_mutation_id: mutationID(),
    base_version: state.editing?.version || 0,
  };
}
async function submitEvent(e) {
  e.preventDefault();
  const input = eventInput();
  if (!navigator.onLine) {
    const queue = JSON.parse(
      localStorage.getItem("ynx.calendar.offlineQueue") || "[]",
    );
    queue.push({
      kind: state.editing ? "update" : "create",
      eventID: state.editing?.id,
      input,
    });
    localStorage.setItem("ynx.calendar.offlineQueue", JSON.stringify(queue));
    $("#event-dialog").close();
    toast("已加入离线队列；联网后仍需逐项预览批准");
    return;
  }
  try {
    const path = state.editing
      ? `/v1/events/${state.editing.id}/preview`
      : "/v1/events/preview";
    state.pendingChange = await api(path, {
      method: "POST",
      body: JSON.stringify(input),
    });
    showChange();
  } catch (e2) {
    toast(e2.message);
  }
}
function showChange() {
  const c = state.pendingChange,
    a = c.after;
  $("#change-preview").innerHTML =
    `<div class="preview-block"><span>变更</span><b>${escapeHTML(c.kind)}</b><span>事件</span><b>${escapeHTML(a.title)}</b><span>时间</span><b>${new Date(a.start_utc).toLocaleString()} — ${new Date(a.end_utc).toLocaleTimeString()}</b><span>时区</span><b>${escapeHTML(a.time_zone)}</b><span>邀请</span><b>${a.invites.length ? a.invites.map((i) => escapeHTML(i.handle)).join("、") : "无"}</b><span>重复</span><b>${a.recurrence.frequency ? `${escapeHTML(a.recurrence.frequency)} × ${a.recurrence.count}` : "不重复"}</b></div>${c.conflicts?.length ? `<div class="conflicts"><b>${c.conflicts.length} 个冲突</b>${c.conflicts.map((x) => `<p>${escapeHTML(x.title)} · ${new Date(x.start_utc).toLocaleString()}</p>`).join("")}</div>` : ""}`;
  $("#conflict-override").hidden = !c.conflicts?.length;
  $("#accept-conflicts").checked = false;
  $("#event-dialog").close();
  $("#change-dialog").showModal();
}
async function approveChange() {
  if (!state.pendingChange) return;
  try {
    const changeID = state.pendingChange.id;
    const event = await api(`/v1/changes/${changeID}/approve`, {
      method: "POST",
      body: JSON.stringify({
        accept_conflicts: $("#accept-conflicts").checked,
      }),
    });
    state.pendingChange = null;
    state.editing = null;
    $("#change-dialog").close();
    toast("变更已批准，可从事件详情撤销");
    await loadEvents();
    await openEvent({ event_id: event.id });
    const actions = $("#event-content .detail-actions");
    if (actions) {
      const undo = document.createElement("button");
      undo.className = "quiet";
      undo.textContent = "撤销刚才变更";
      undo.onclick = () => revert(changeID);
      actions.prepend(undo);
    }
  } catch (e) {
    toast(e.message);
  }
}
async function openEvent(occurrence) {
  try {
    const event = await api(`/v1/events/${occurrence.event_id}`);
    state.selected = occurrence;
    state.selectedEvent = event;
    $("#ai-begin").disabled = false;
    $("#ai-preview").textContent =
      `只会选择：${event.title}。点击后再查看 provider、模型和成本。`;
    const mine = event.owner_handle === state.user.handle;
    $("#event-content").innerHTML =
      `<span class="eyebrow">${escapeHTML(event.state)} · v${event.version}</span><h1>${escapeHTML(event.title)}</h1><p>${escapeHTML(event.description || "无说明")}</p><div class="detail-row"><span>时间</span><b>${new Date(event.start_utc).toLocaleString()} — ${new Date(event.end_utc).toLocaleString()}</b><span>时区</span><b>${escapeHTML(event.time_zone)}</b><span>组织者</span><b>${escapeHTML(event.owner_handle)}</b><span>重复</span><b>${event.recurrence?.frequency ? `${escapeHTML(event.recurrence.frequency)} × ${event.recurrence.count}` : "不重复"}</b><span>提醒</span><b>${event.reminders?.map((r) => `提前 ${r.minutes_before} 分钟`).join("、") || "无"}</b><span>邀请</span><b>${event.invites?.map((i) => `${escapeHTML(i.handle)} · ${escapeHTML(i.state)}`).join("<br>") || "无"}</b><span>共享</span><b>${event.shares?.map((s) => `${escapeHTML(s.handle)} · ${escapeHTML(s.role)}`).join("<br>") || "无"}</b><span>会议链接</span><b>${event.meeting_link ? `<a href="${escapeHTML(event.meeting_link)}" target="_blank" rel="noopener noreferrer">打开边界链接</a>` : "无"}</b></div><div class="detail-actions">${mine ? '<button class="primary" id="edit-event">预览修改</button><button class="quiet" id="cancel-event">预览取消</button><button class="quiet" id="share-event">共享</button>' : '<button class="primary" data-rsvp="accepted">接受</button><button class="quiet" data-rsvp="tentative">暂定</button><button class="quiet" data-rsvp="declined">拒绝</button>'}${event._lastChange ? '<button class="quiet" id="revert-event">撤销上次变更</button>' : ""}<button class="quiet" id="close-detail">关闭</button></div>`;
    $("#event-detail").showModal();
    $("#close-detail").onclick = () => $("#event-detail").close();
    if (mine) {
      $("#edit-event").onclick = () => {
        $("#event-detail").close();
        openForm(event);
      };
      $("#cancel-event").onclick = () => previewCancel(event);
      $("#share-event").onclick = () => shareEvent(event);
    }
    $$("[data-rsvp]").forEach(
      (b) => (b.onclick = () => rsvp(event, b.dataset.rsvp)),
    );
    if ($("#revert-event"))
      $("#revert-event").onclick = () => revert(event._lastChange);
  } catch (e) {
    toast(e.message);
  }
}
async function previewCancel(event) {
  if (!confirm("先创建取消预览；此时不会通知联系人。继续？")) return;
  try {
    state.pendingChange = await api(`/v1/events/${event.id}/cancel-preview`, {
      method: "POST",
      body: JSON.stringify({
        client_mutation_id: mutationID(),
        base_version: event.version,
      }),
    });
    $("#event-detail").close();
    showChange();
  } catch (e) {
    toast(e.message);
  }
}
async function shareEvent(event) {
  const handle = prompt("共享给哪个 @handle？");
  if (!handle) return;
  const role = prompt("角色：viewer 或 editor", "viewer");
  if (!role) return;
  if (
    !confirm(
      `确认将 ${event.title} 以 ${role} 权限共享给 ${handle}？共享可通过后续变更移除。`,
    )
  )
    return;
  try {
    await api(`/v1/events/${event.id}/share`, {
      method: "POST",
      body: JSON.stringify({ handle, role }),
    });
    toast("已共享并写入审计");
    $("#event-detail").close();
    loadEvents();
  } catch (e) {
    toast(e.message);
  }
}
async function rsvp(event, response) {
  if (!confirm(`确认 RSVP：${response}？`)) return;
  try {
    await api(`/v1/events/${event.id}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ response }),
    });
    toast("RSVP 已更新");
    $("#event-detail").close();
    loadEvents();
  } catch (e) {
    toast(e.message);
  }
}
async function revert(changeID) {
  if (!confirm("撤销上次变更？若事件已有更新将安全失败。")) return;
  try {
    await api(`/v1/changes/${changeID}/revert`, { method: "POST", body: "{}" });
    toast("变更已撤销并写入审计");
    $("#event-detail").close();
    loadEvents();
  } catch (e) {
    toast(e.message);
  }
}
async function syncOffline() {
  if (!navigator.onLine || !state.token) return;
  const queue = JSON.parse(
    localStorage.getItem("ynx.calendar.offlineQueue") || "[]",
  );
  if (!queue.length) return;
  const item = queue[0];
  try {
    const path =
      item.kind === "update"
        ? `/v1/events/${item.eventID}/preview`
        : "/v1/events/preview";
    state.pendingChange = await api(path, {
      method: "POST",
      body: JSON.stringify(item.input),
    });
    queue.shift();
    localStorage.setItem("ynx.calendar.offlineQueue", JSON.stringify(queue));
    toast("离线变更已恢复；仍需你的批准");
    showChange();
  } catch (e) {
    toast(`离线变更需要处理：${e.message}`);
  }
}
async function beginAI() {
  if (!state.selectedEvent) return;
  try {
    state.aiJob = await api("/v1/ai/jobs", {
      method: "POST",
      body: JSON.stringify({
        kind: $("#ai-kind").value,
        event_ids: [state.selectedEvent.id],
      }),
    });
    $("#ai-preview").innerHTML =
      `<b>数据范围</b><br>${escapeHTML(state.aiJob.context_preview)}<br><br><b>Provider / 模型</b><br>${escapeHTML(state.aiJob.provider)} · ${escapeHTML(state.aiJob.model)}<br><br><b>成本估算</b><br>${escapeHTML(state.aiJob.cost_estimate || "由 Gateway 结算")}<br><small>批准后才会发送这 1 个事件的时间元数据。</small>`;
    $("#ai-begin").textContent = "批准并开始（可取消）";
    $("#ai-begin").onclick = approveAI;
  } catch (e) {
    toast(e.message);
  }
}
async function approveAI() {
  const jobID = state.aiJob.id;
  $("#ai-result").innerHTML =
    '<div class="permission">AI 正在运行并流式记录状态。<button class="quiet" id="ai-cancel">取消生成</button></div>';
  $("#ai-cancel").onclick = () => reviewAI("cancel");
  try {
    state.aiJob = await api(`/v1/ai/jobs/${jobID}/approve`, {
      method: "POST",
      body: "{}",
    });
    if (state.aiJob.state === "cancelled") {
      toast("AI 生成已取消，晚到结果不会应用");
      return;
    }
    $("#ai-result").innerHTML =
      `<div class="ai-output">${escapeHTML(state.aiJob.result)}</div><p>结果尚未更改事件、邀请或自动化。</p><div class="detail-actions"><button class="primary" id="ai-apply">保留为建议</button><button class="quiet" id="ai-reject">拒绝</button></div>`;
    $("#ai-apply").onclick = () => reviewAI("apply");
    $("#ai-reject").onclick = () => reviewAI("reject");
  } catch (e) {
    if (!String(e.message).includes("canceled")) toast(e.message);
  }
}
async function reviewAI(decision) {
  try {
    await api(`/v1/ai/jobs/${state.aiJob.id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    toast(decision === "apply" ? "建议已保留，但未修改日程" : "AI 建议已拒绝");
    state.aiJob = null;
    $("#ai-result").replaceChildren();
  } catch (e) {
    toast(e.message);
  }
}
function updateNetwork() {
  const offline = !navigator.onLine;
  $("#offline").hidden = !offline;
  if (!offline) syncOffline();
}
function init() {
  populateTimeZones();
  renderFrame();
  restoreSession().then(async () => {
    if (state.token && state.user) {
      $("#signin").hidden = true;
      $("#account").textContent = state.user.handle
        .replace("@", "")
        .slice(0, 2)
        .toUpperCase();
      await loadEvents();
      syncOffline();
    } else $("#signin").hidden = false;
    $("#app").setAttribute("aria-busy", "false");
  });
  $("#wallet-signin").onclick = beginSignIn;
  $("#account").onclick = showAccount;
  $("#new-event").onclick = () => openForm();
  $("#event-form").onsubmit = submitEvent;
  $("#approve-change").onclick = approveChange;
  $("#edit-change").onclick = () => {
    $("#change-dialog").close();
    $("#event-dialog").showModal();
  };
  $("#today").onclick = () => {
    state.focusDate = new Date();
    state.weekStart = startOfWeek(new Date());
    loadEvents();
  };
  $("#prev").onclick = () => {
    const step = state.view === "day" ? -1 : -7;
    if (state.view === "month")
      state.focusDate = new Date(
        state.focusDate.getFullYear(),
        state.focusDate.getMonth() - 1,
        1,
      );
    else state.focusDate = plusDays(state.focusDate, step);
    state.weekStart = startOfWeek(state.focusDate);
    loadEvents();
  };
  $("#next").onclick = () => {
    const step = state.view === "day" ? 1 : 7;
    if (state.view === "month")
      state.focusDate = new Date(
        state.focusDate.getFullYear(),
        state.focusDate.getMonth() + 1,
        1,
      );
    else state.focusDate = plusDays(state.focusDate, step);
    state.weekStart = startOfWeek(state.focusDate);
    loadEvents();
  };
  $$("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        state.view = button.dataset.view;
        localStorage.setItem("ynx.calendar.view", state.view);
        state.weekStart = startOfWeek(state.focusDate);
        loadEvents();
      }),
  );
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
    toast("网络已恢复，准备离线变更预览");
  });
  addEventListener("offline", updateNetwork);
  updateNetwork();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}
async function showAccount() {
  const dialog = document.createElement("dialog");
  dialog.className = "change-dialog";
  dialog.innerHTML = `<div class="change-card"><span class="eyebrow">数据与会话</span><h2>Calendar 账户</h2><p>${escapeHTML(state.user?.handle || "")}</p><p>导出包含 Calendar 事件、提醒与审计记录，不包含 Wallet 密钥或账户哈希。</p><div class="detail-actions"><button class="quiet" data-action="export">导出 JSON</button><button class="quiet" data-action="logout">撤销此设备会话</button><button class="quiet danger-action" data-action="delete">删除 Calendar 账户</button><button class="primary" data-action="close">关闭</button></div></div>`;
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
      link.download = "ynx-calendar-export.json";
      link.click();
      URL.revokeObjectURL(link.href);
      toast("Calendar 数据导出已生成");
    } catch (e) {
      toast(e.message);
    }
  };
  dialog.querySelector('[data-action="logout"]').onclick = () => {
    if (confirm("撤销此 Calendar 设备会话并退出？"))
      api("/v1/auth/session", { method: "DELETE", body: "{}" }).finally(() =>
        signOut(),
      );
  };
  dialog.querySelector('[data-action="delete"]').onclick = async () => {
    const phrase = prompt(
      "此操作不可撤销。输入 DELETE CALENDAR ACCOUNT 继续：",
    );
    if (phrase !== "DELETE CALENDAR ACCOUNT")
      return toast("确认短语不匹配，未删除");
    try {
      await api("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: phrase }),
      });
      dialog.close();
      signOut(false);
      toast("Calendar 账户已删除并保留最小审计墓碑");
    } catch (e) {
      toast(e.message);
    }
  };
  dialog.showModal();
}
const renderEventsBase = renderEvents;
renderEvents = () => {
  renderEventsBase();
  $("#empty").style.display = state.occurrences.length ? "none" : "grid";
};
init();
$("#wallet-signin").onclick = () => beginSignIn(false);
$("#wallet-recover").onclick = () => beginSignIn(true);
const auditButton = document.createElement("button");
auditButton.className = "avatar";
auditButton.textContent = "审";
auditButton.setAttribute("aria-label", "打开 Calendar 审计");
auditButton.onclick = showAudit;
$("#ai-open").before(auditButton);
async function showAudit() {
  try {
    const audit = await api("/v1/audit");
    const dialog = document.createElement("dialog");
    dialog.className = "change-dialog";
    const card = document.createElement("div");
    card.className = "change-card";
    card.innerHTML =
      '<span class="eyebrow">账户证据</span><h2>Calendar 审计</h2><p>预览、批准、撤销、RSVP、共享、提醒和 AI 审批均在此留痕。</p>';
    for (const entry of audit.slice(-25).reverse()) {
      const row = document.createElement("p");
      row.textContent = `${new Date(entry.created_at).toLocaleString()} · ${entry.action}`;
      card.append(row);
    }
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
let lastReminder = localStorage.getItem("ynx.calendar.lastReminder") || "";
async function loadReminders() {
  if (!state.token) return;
  try {
    const reminders = await api("/v1/reminders");
    if (reminders[0] && reminders[0].id !== lastReminder) {
      lastReminder = reminders[0].id;
      localStorage.setItem("ynx.calendar.lastReminder", lastReminder);
      toast(
        `提醒：${reminders[0].title}${reminders[0].state.includes("late") ? "（重启后恢复）" : ""}`,
      );
    }
  } catch {}
}
setInterval(loadReminders, 30000);
setTimeout(loadReminders, 1200);
