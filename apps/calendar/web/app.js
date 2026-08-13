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
const activeLocale = () => window.ynxI18n?.locale() || document.documentElement.lang || navigator.language;
const tr = (key, fallback) => {
  const value = window.ynxI18n?.t(key);
  return value && value !== key ? value : fallback;
};
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
  const body = await r.json().catch(() => ({ detail: "The service returned an invalid response." }));
  if (!r.ok) {
    if (r.status === 401) signOut(false);
    throw new Error(body.detail || body.error || `Request failed (${r.status})`);
  }
  return body;
}
async function beginSignIn(recovery = false) {
  $("#signin-state").textContent =
    `The Web companion does not accept Wallet callbacks. Use the installed YNX Calendar app and its canonical request envelope to ${recovery ? "recover" : "sign in"}. It fails closed until the central registry and Gateway are available.`;
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
  if (show) toast("Calendar session revoked");
}
function renderFrame() {
  const days = $("#days");
  days.replaceChildren();
  const visibleDays = state.view === "day" ? 1 : 7;
  const firstDay = state.view === "day" ? state.focusDate : state.weekStart;
  for (let i = 0; i < visibleDays; i++) {
    const d = plusDays(firstDay, i),
      el = document.createElement("div");
    el.className = `day-head${d.toDateString() === new Date().toDateString() ? " today" : ""}`;
    el.innerHTML = `<span>${d.toLocaleDateString(activeLocale(), { weekday: "short" })}</span><b>${d.getDate()}</b>`;
    days.append(el);
  }
  if (state.view === "month") {
    days.innerHTML = Array.from({ length: 7 }, (_, index) =>
      plusDays(state.weekStart, index).toLocaleDateString(activeLocale(), { weekday: "short" }),
    )
      .map((name) => `<div class="day-head"><span>${name}</span></div>`)
      .join("");
    $("#range").textContent = state.focusDate.toLocaleDateString(activeLocale(), {
      year: "numeric",
      month: "long",
    });
  } else if (state.view === "day") {
    $("#range").textContent = state.focusDate.toLocaleDateString(activeLocale(), {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } else {
    $("#range").textContent =
      `${state.weekStart.toLocaleDateString(activeLocale(), { month: "short", day: "numeric" })} — ${plusDays(state.weekStart, 6).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" })}`;
  }
  days.style.setProperty("--visible-days", visibleDays);
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
    el.innerHTML = `<b>${escapeHTML(o.title)}</b><span>${start.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}</span>`;
    el.setAttribute(
      "aria-label",
      `${o.title}, ${start.toLocaleString(activeLocale())} to ${end.toLocaleTimeString(activeLocale())}`,
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
      button.textContent = `${new Date(occurrence.start_utc).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })} ${occurrence.title}`;
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
  $("#event-title").textContent = event ? tr("update", "Update event") : tr("create", "Create event");
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
    toast("Queued offline; each change still requires preview and approval after reconnecting");
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
    `<div class="preview-block"><span>Change</span><b>${escapeHTML(c.kind)}</b><span>Event</span><b>${escapeHTML(a.title)}</b><span>Time</span><b>${new Date(a.start_utc).toLocaleString(activeLocale())} — ${new Date(a.end_utc).toLocaleTimeString(activeLocale())}</b><span>${tr("timezone", "Time zone")}</span><b>${escapeHTML(a.time_zone)}</b><span>Invitations</span><b>${a.invites.length ? a.invites.map((i) => escapeHTML(i.handle)).join(", ") : "None"}</b><span>${tr("repeat", "Recurrence")}</span><b>${a.recurrence.frequency ? `${escapeHTML(a.recurrence.frequency)} × ${a.recurrence.count}` : "Does not repeat"}</b></div>${c.conflicts?.length ? `<div class="conflicts"><b>${c.conflicts.length} conflict(s)</b>${c.conflicts.map((x) => `<p>${escapeHTML(x.title)} · ${new Date(x.start_utc).toLocaleString(activeLocale())}</p>`).join("")}</div>` : ""}`;
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
    toast("Change approved; it can be reverted from event details");
    await loadEvents();
    await openEvent({ event_id: event.id });
    const actions = $("#event-content .detail-actions");
    if (actions) {
      const undo = document.createElement("button");
      undo.className = "quiet";
      undo.textContent = "Undo last change";
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
      `Selected only: ${event.title}. Next, review the provider, model, and cost.`;
    const mine = event.owner_handle === state.user.handle;
    $("#event-content").innerHTML =
      `<span class="eyebrow">${escapeHTML(event.state)} · v${event.version}</span><h1>${escapeHTML(event.title)}</h1><p>${escapeHTML(event.description || "No description")}</p><div class="detail-row"><span>Time</span><b>${new Date(event.start_utc).toLocaleString(activeLocale())} — ${new Date(event.end_utc).toLocaleString(activeLocale())}</b><span>${tr("timezone", "Time zone")}</span><b>${escapeHTML(event.time_zone)}</b><span>Organizer</span><b>${escapeHTML(event.owner_handle)}</b><span>${tr("repeat", "Recurrence")}</span><b>${event.recurrence?.frequency ? `${escapeHTML(event.recurrence.frequency)} × ${event.recurrence.count}` : "Does not repeat"}</b><span>${tr("reminder", "Reminder")}</span><b>${event.reminders?.map((r) => `${r.minutes_before} minutes before`).join(", ") || "None"}</b><span>Invitations</span><b>${event.invites?.map((i) => `${escapeHTML(i.handle)} · ${escapeHTML(i.state)}`).join("<br>") || "None"}</b><span>${tr("share", "Sharing")}</span><b>${event.shares?.map((s) => `${escapeHTML(s.handle)} · ${escapeHTML(s.role)}`).join("<br>") || "None"}</b><span>${tr("meeting_link", "Meeting link")}</span><b>${event.meeting_link ? `<a href="${escapeHTML(event.meeting_link)}" target="_blank" rel="noopener noreferrer">Open bounded link</a>` : "None"}</b></div><div class="detail-actions">${mine ? `<button class="primary" id="edit-event">${tr("update", "Update event")}</button><button class="quiet" id="cancel-event">${tr("cancel_event", "Cancel event")}</button><button class="quiet" id="share-event">${tr("share", "Share calendar")}</button>` : '<button class="primary" data-rsvp="accepted">Accept</button><button class="quiet" data-rsvp="tentative">Tentative</button><button class="quiet" data-rsvp="declined">Decline</button>'}${event._lastChange ? '<button class="quiet" id="revert-event">Undo last change</button>' : ""}<button class="quiet" id="close-detail">Close</button></div>`;
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
  if (!confirm("Create a cancellation preview first? Contacts are not notified yet.")) return;
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
  const handle = prompt("Share with which @handle?");
  if (!handle) return;
  const role = prompt("Role: viewer or editor", "viewer");
  if (!role) return;
  if (
    !confirm(
      `Share ${event.title} with ${handle} as ${role}? Sharing can be removed by a later change.`,
    )
  )
    return;
  try {
    await api(`/v1/events/${event.id}/share`, {
      method: "POST",
      body: JSON.stringify({ handle, role }),
    });
    toast("Shared and recorded in the audit log");
    $("#event-detail").close();
    loadEvents();
  } catch (e) {
    toast(e.message);
  }
}
async function rsvp(event, response) {
  if (!confirm(`Confirm RSVP: ${response}?`)) return;
  try {
    await api(`/v1/events/${event.id}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ response }),
    });
    toast("RSVP updated");
    $("#event-detail").close();
    loadEvents();
  } catch (e) {
    toast(e.message);
  }
}
async function revert(changeID) {
  if (!confirm("Undo the last change? This safely fails if the event has changed since.")) return;
  try {
    await api(`/v1/changes/${changeID}/revert`, { method: "POST", body: "{}" });
    toast("Change reverted and recorded in the audit log");
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
    toast("Offline change restored; your approval is still required");
    showChange();
  } catch (e) {
    toast(`Offline change needs attention: ${e.message}`);
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
      `<b>Data scope</b><br>${escapeHTML(state.aiJob.context_preview)}<br><br><b>Provider / model</b><br>${escapeHTML(state.aiJob.provider)} · ${escapeHTML(state.aiJob.model)}<br><br><b>Estimated cost</b><br>${escapeHTML(state.aiJob.cost_estimate || "Settled by Gateway")}<br><small>Only approval sends time metadata for this one event.</small>`;
    $("#ai-begin").textContent = "Approve and start (cancelable)";
    $("#ai-begin").onclick = approveAI;
  } catch (e) {
    toast(e.message);
  }
}
async function approveAI() {
  const jobID = state.aiJob.id;
  $("#ai-result").innerHTML =
    '<div class="permission">AI is running with streamed status.<button class="quiet" id="ai-cancel">Cancel generation</button></div>';
  $("#ai-cancel").onclick = () => reviewAI("cancel");
  try {
    state.aiJob = await api(`/v1/ai/jobs/${jobID}/approve`, {
      method: "POST",
      body: "{}",
    });
    if (state.aiJob.state === "cancelled") {
      toast("AI generation canceled; late results will not be applied");
      return;
    }
    $("#ai-result").innerHTML =
      `<div class="ai-output">${escapeHTML(state.aiJob.result)}</div><p>The result has not changed any event, invitation, or automation.</p><div class="detail-actions"><button class="primary" id="ai-apply">Keep as suggestion</button><button class="quiet" id="ai-reject">Reject</button></div>`;
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
    toast(decision === "apply" ? "Suggestion retained; the calendar was not changed" : "AI suggestion rejected");
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
    toast("Network restored; offline changes are ready for preview");
  });
addEventListener("offline", updateNetwork);
addEventListener("ynx:locale", () => {
  renderFrame();
  if (state.token) loadEvents();
});
  updateNetwork();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}
async function showAccount() {
  const dialog = document.createElement("dialog");
  dialog.className = "change-dialog";
  dialog.innerHTML = `<div class="change-card"><span class="eyebrow">Data and session</span><h2>Calendar account</h2><p>${escapeHTML(state.user?.handle || "")}</p><p>The export contains Calendar events, reminders, and audit records, never Wallet keys or account hashes.</p><div class="detail-actions"><button class="quiet" data-action="export">Export JSON</button><button class="quiet" data-action="logout">Revoke this device session</button><button class="quiet danger-action" data-action="delete">Delete Calendar account</button><button class="primary" data-action="close">Close</button></div></div>`;
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
      toast("Calendar data export created");
    } catch (e) {
      toast(e.message);
    }
  };
  dialog.querySelector('[data-action="logout"]').onclick = () => {
    if (confirm("Revoke this Calendar device session and sign out?"))
      api("/v1/auth/session", { method: "DELETE", body: "{}" }).finally(() =>
        signOut(),
      );
  };
  dialog.querySelector('[data-action="delete"]').onclick = async () => {
    const phrase = prompt(
      "This action cannot be undone. Enter DELETE CALENDAR ACCOUNT to continue:",
    );
    if (phrase !== "DELETE CALENDAR ACCOUNT")
      return toast("Confirmation phrase did not match; nothing was deleted");
    try {
      await api("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: phrase }),
      });
      dialog.close();
      signOut(false);
      toast("Calendar account deleted; a minimal audit tombstone was retained");
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
window.ynxI18nReady.catch(() => {}).finally(init);
$("#wallet-signin").onclick = () => beginSignIn(false);
$("#wallet-recover").onclick = () => beginSignIn(true);
const auditButton = document.createElement("button");
auditButton.className = "avatar";
auditButton.textContent = "Audit";
auditButton.setAttribute("aria-label", "Open Calendar audit");
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
      '<span class="eyebrow">Account evidence</span><h2>Calendar audit</h2><p>Previews, approvals, reverts, RSVP, sharing, reminders, and AI approvals are recorded here.</p>';
    for (const entry of audit.slice(-25).reverse()) {
      const row = document.createElement("p");
      row.textContent = `${new Date(entry.created_at).toLocaleString(activeLocale())} · ${entry.action}`;
      card.append(row);
    }
    const close = document.createElement("button");
    close.className = "primary";
    close.textContent = "Close";
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
        `${tr("reminder", "Reminder")}: ${reminders[0].title}${reminders[0].state.includes("late") ? " (recovered after restart)" : ""}`,
      );
    }
  } catch {}
}
setInterval(loadReminders, 30000);
setTimeout(loadReminders, 1200);
