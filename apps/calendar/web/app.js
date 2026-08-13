const state = {
  token: "",
  user: null,
  guest: false,
  view: localStorage.getItem("ynx.calendar.view") || "week",
  focusDate: new Date(),
  weekStart: startOfWeek(new Date()),
  occurrences: [],
  selected: null,
  selectedEvent: null,
  pendingChange: null,
  editing: null,
  aiJob: null,
  searchQuery: "",
  recurrenceEdit: null,
  calendars: [],
  notifications: [],
};
const guestEventsKey = "ynx.calendar.guestEvents";
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
function zonedLocalInput(value, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function localDateTimeToISO(value, zone) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let pass = 0; pass < 2; pass++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    guess -= rendered - Date.UTC(year, month - 1, day, hour, minute);
  }
  return new Date(guess).toISOString();
}
function zonedClock(value, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
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
  state.guest = false;
  state.calendars = [];
  state.notifications = [];
  renderCalendarCatalog();
  renderNotificationCount();
  $("#signin").hidden = false;
  if (show) toast("Calendar session revoked");
}
function guestEvents() {
  try {
    const events = JSON.parse(localStorage.getItem(guestEventsKey) || "[]");
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}
function expandGuestEvent(event, from, to) {
  const baseStart = new Date(event.start_utc), baseEnd = new Date(event.end_utc);
  if (Number.isNaN(baseStart.valueOf()) || Number.isNaN(baseEnd.valueOf())) return [];
  const recurrence = event.recurrence || {};
  const frequency = recurrence.frequency || "";
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const until = recurrence.until ? new Date(recurrence.until) : null;
  const count = frequency ? (Number(recurrence.count) > 0 ? Math.min(3660, Number(recurrence.count)) : until ? 3660 : 1) : 1;
  const duration = baseEnd - baseStart;
  const starts = [];
  const push = (date) => {
    if (starts.length >= Math.min(count, 3660) || (until && date > until)) return false;
    starts.push(new Date(date));
    return true;
  };
  if (!frequency) push(baseStart);
  else if (frequency === "weekly" && recurrence.by_day?.length) {
    const weekdays = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const weekBase = startOfWeek(baseStart);
    for (let week = 0; starts.length < count && week < 530; week++) {
      for (const code of recurrence.by_day) {
        const candidate = plusDays(weekBase, week * 7 * interval + ((weekdays[code] + 6) % 7));
        candidate.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
        if (candidate >= baseStart && !push(candidate)) break;
      }
      if (until && plusDays(weekBase, week * 7 * interval) > until) break;
    }
  } else if (frequency === "monthly" && recurrence.by_month_day?.length) {
    for (let month = 0; starts.length < count && month < 1200; month++) {
      const anchor = new Date(baseStart.getFullYear(), baseStart.getMonth() + month * interval, 1, baseStart.getHours(), baseStart.getMinutes());
      for (const day of recurrence.by_month_day) {
        const candidate = new Date(anchor.getFullYear(), anchor.getMonth(), Number(day), baseStart.getHours(), baseStart.getMinutes());
        if (candidate.getMonth() === anchor.getMonth() && candidate >= baseStart && !push(candidate)) break;
      }
      if (until && anchor > until) break;
    }
  } else {
    for (let index = 0; index < count; index++) {
      const candidate = new Date(baseStart);
      if (frequency === "daily") candidate.setDate(candidate.getDate() + index * interval);
      else if (frequency === "weekly") candidate.setDate(candidate.getDate() + index * 7 * interval);
      else if (frequency === "monthly") {
        const expectedMonth = (baseStart.getMonth() + index * interval) % 12;
        candidate.setDate(1);
        candidate.setMonth(baseStart.getMonth() + index * interval);
        candidate.setDate(baseStart.getDate());
        if (candidate.getMonth() !== (expectedMonth + 12) % 12) continue;
      } else if (frequency === "yearly") {
        const expectedMonth = baseStart.getMonth();
        candidate.setDate(1);
        candidate.setFullYear(baseStart.getFullYear() + index * interval);
        candidate.setMonth(expectedMonth);
        candidate.setDate(baseStart.getDate());
        if (candidate.getMonth() !== expectedMonth) continue;
      }
      if (!push(candidate)) break;
    }
  }
  return starts
    .map((start) => ({ ...event, event_id: event.event_id || event.id, start_utc: start.toISOString(), end_utc: new Date(start.getTime() + duration).toISOString() }))
    .filter((occurrence) => new Date(occurrence.end_utc) > from && new Date(occurrence.start_utc) < to);
}
function enterGuest() {
  state.token = "";
  state.guest = true;
  state.user = { handle: "@guest" };
  $("#signin").hidden = true;
  $("#account").textContent = "G";
  $("#account").setAttribute("aria-label", tr("guest_boundary", "Local guest trial; no Wallet session"));
  toast(tr("guest_boundary", "Local guest trial · device-only drafts · no sync, sharing, AI, or chain writes"));
  loadEvents();
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
  if (state.view === "agenda") {
    days.replaceChildren();
    $("#range").textContent = `${state.focusDate.toLocaleDateString(activeLocale(), { month: "short", day: "numeric" })} — ${plusDays(state.focusDate, 89).toLocaleDateString(activeLocale(), { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (state.view === "month") {
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
  renderFrame();
  if (state.guest) {
    const events = guestEvents();
    let fromDate = state.weekStart,
      toDate = plusDays(state.weekStart, 7);
    if (state.view === "agenda") {
      fromDate = new Date(state.focusDate);
      fromDate.setHours(0, 0, 0, 0);
      toDate = plusDays(fromDate, 90);
    } else if (state.view === "day") {
      fromDate = new Date(state.focusDate);
      fromDate.setHours(0, 0, 0, 0);
      toDate = plusDays(fromDate, 1);
    } else if (state.view === "month") {
      fromDate = startOfWeek(new Date(state.focusDate.getFullYear(), state.focusDate.getMonth(), 1));
      toDate = plusDays(fromDate, 42);
    }
    state.occurrences = events.flatMap((event) => expandGuestEvent(event, fromDate, toDate));
    renderEvents();
    return;
  }
  if (!state.token) return;
  $("#app").setAttribute("aria-busy", "true");
  let fromDate = state.weekStart,
    toDate = plusDays(state.weekStart, 7);
  if (state.view === "agenda") {
    fromDate = new Date(state.focusDate);
    fromDate.setHours(0, 0, 0, 0);
    toDate = plusDays(fromDate, 90);
  } else if (state.view === "day") {
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
function calendarRole(calendar) {
  if (calendar.owner_handle === state.user?.handle) return "owner";
  return calendar.shares?.find((share) => share.handle === state.user?.handle)?.role || "";
}
function renderCalendarCatalog() {
  const select = $("#calendar-id");
  select.querySelectorAll("option[data-shared]").forEach((option) => option.remove());
  for (const calendar of state.calendars) {
    if (["owner", "editor"].includes(calendarRole(calendar))) {
      const option = document.createElement("option");
      option.value = calendar.id;
      option.dataset.shared = "true";
      option.textContent = `${calendar.name} · ${calendarRole(calendar)}`;
      select.append(option);
    }
  }
  const list = $("#shared-calendar-list");
  list.replaceChildren();
  for (const calendar of state.calendars) {
    const button = document.createElement("button");
    button.className = "shared-calendar-chip";
    button.innerHTML = `<span data-color="${escapeHTML(calendar.color)}"></span><span>${escapeHTML(calendar.name)}<small>${escapeHTML(calendarRole(calendar))} · ${calendar.shares?.length || 0} member${calendar.shares?.length === 1 ? "" : "s"}</small></span>`;
    button.onclick = showCalendarManager;
    list.append(button);
  }
}
async function loadCalendars() {
  if (!state.token) {
    state.calendars = [];
    renderCalendarCatalog();
    return;
  }
  try {
    state.calendars = (await api("/v1/calendars")) || [];
    renderCalendarCatalog();
  } catch (error) {
    toast(error.message);
  }
}
function renderEvents() {
  const week = $("#week");
  week.replaceChildren();
  const query = state.searchQuery.trim().toLocaleLowerCase(activeLocale());
  const visible = query
    ? state.occurrences.filter((event) => [event.title, event.location, event.owner_handle, event.calendar_id].some((value) => String(value || "").toLocaleLowerCase(activeLocale()).includes(query)))
    : state.occurrences;
  week.className = state.view === "month" ? "week month-grid" : state.view === "agenda" ? "week agenda-list" : "week";
  if (state.view === "agenda") {
    renderAgendaEvents(week, visible);
    return;
  }
  if (state.view === "month") {
    renderMonthEvents(week, visible);
    return;
  }
  $("#empty").hidden = visible.length > 0;
  const overlap = new Set();
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i],
        b = visible[j];
      if (
        new Date(a.start_utc) < new Date(b.end_utc) &&
        new Date(b.start_utc) < new Date(a.end_utc)
      ) {
        overlap.add(`${a.event_id}:${a.start_utc}`);
        overlap.add(`${b.event_id}:${b.start_utc}`);
      }
    }
  for (const o of visible) {
    const start = new Date(o.start_utc),
      end = new Date(o.end_utc),
      day = state.view === "day" ? 0 : (start.getDay() + 6) % 7,
      minutes = start.getHours() * 60 + start.getMinutes(),
      duration = Math.max(30, (end - start) / 60000),
      el = document.createElement("button");
    el.className = `event${overlap.has(`${o.event_id}:${o.start_utc}`) ? " conflict" : ""}`;
    el.dataset.color = o.color || "blue";
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
function renderAgendaEvents(list, occurrences) {
  let lastDay = "";
  for (const occurrence of [...occurrences].sort((a, b) => new Date(a.start_utc) - new Date(b.start_utc))) {
    const start = new Date(occurrence.start_utc);
    const dayKey = start.toDateString();
    if (dayKey !== lastDay) {
      const heading = document.createElement("h2");
      heading.className = "agenda-day";
      heading.textContent = start.toLocaleDateString(activeLocale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      list.append(heading);
      lastDay = dayKey;
    }
    const button = document.createElement("button");
    button.className = "agenda-event";
    button.innerHTML = `<time>${occurrence.all_day ? "All day" : start.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}</time><span class="agenda-color" data-color="${escapeHTML(occurrence.color || "blue")}"></span><span><b>${escapeHTML(occurrence.title)}</b><small>${escapeHTML(occurrence.location || occurrence.calendar_id || "Personal")}</small></span><small>${escapeHTML(occurrence.owner_handle || "")}</small>`;
    button.onclick = () => openEvent(occurrence);
    list.append(button);
  }
  $("#empty").hidden = occurrences.length > 0;
}
function renderMonthEvents(month, occurrences = state.occurrences) {
  const first = startOfWeek(
    new Date(state.focusDate.getFullYear(), state.focusDate.getMonth(), 1),
  );
  for (let i = 0; i < 42; i++) {
    const date = plusDays(first, i),
      cell = document.createElement("section");
    cell.className = `month-day${date.getMonth() === state.focusDate.getMonth() ? "" : " outside"}${date.toDateString() === new Date().toDateString() ? " today" : ""}`;
    cell.innerHTML = `<time datetime="${date.toISOString().slice(0, 10)}">${date.getDate()}</time>`;
    for (const occurrence of occurrences.filter(
      (o) => new Date(o.start_utc).toDateString() === date.toDateString(),
    )) {
      const button = document.createElement("button");
      button.className = "month-event";
      button.dataset.color = occurrence.color || "blue";
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
function openForm(event = null, recurrenceEdit = null) {
  state.editing = event;
  state.recurrenceEdit = recurrenceEdit;
  const start = event
    ? new Date(event.start_utc)
    : new Date(Date.now() + 3600000);
  if (!event) start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
  const end = event
    ? new Date(event.end_utc)
    : new Date(start.getTime() + 3600000);
  $("#title").value = event?.title || "";
  $("#description").value = event?.description || "";
  $("#location").value = event?.location || "";
  $("#all-day").checked = Boolean(event?.all_day);
  $("#start").value = event?.time_zone ? zonedLocalInput(start, event.time_zone) : localInput(start);
  $("#end").value = event?.time_zone ? zonedLocalInput(end, event.time_zone) : localInput(end);
  $("#timezone").value =
    event?.time_zone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  $("#recurrence").value = event?.recurrence?.frequency || "";
  $("#interval").value = event?.recurrence?.interval || 1;
  $("#count").value = event?.recurrence?.count || 1;
  $("#recurrence-until").value = event?.recurrence?.until ? String(event.recurrence.until).slice(0, 10) : "";
  $("#by-day").value = (event?.recurrence?.by_day || []).join(",");
  $("#by-month-day").value = (event?.recurrence?.by_month_day || []).join(",");
  $("#calendar-id").value = event?.calendar_id || "personal";
  $("#event-color").value = event?.color || "blue";
  $("#event-privacy").value = event?.privacy || "private";
  $("#invitees").value = (event?.invites || []).map((i) => i.handle).join(", ");
  $("#meeting-link").value = event?.meeting_link || "";
  $("#buffer-before").value = event?.buffer_before_minutes || 0;
  $("#buffer-after").value = event?.buffer_after_minutes || 0;
  $("#attachment-links").value = (event?.attachment_links || []).join(", ");
  $("#event-title").textContent = event ? tr("update", "Update event") : tr("create", "Create event");
  $("#event-dialog").showModal();
  $("#title").focus();
}
function eventInput() {
  const freq = $("#recurrence").value;
  const untilValue = $("#recurrence-until").value;
  return {
    title: $("#title").value,
    description: $("#description").value,
    location: $("#location").value,
    all_day: $("#all-day").checked,
    calendar_id: $("#calendar-id").value,
    color: $("#event-color").value,
    privacy: $("#event-privacy").value,
    attachment_links: $("#attachment-links").value.split(",").map((value) => value.trim()).filter(Boolean),
    local_start: $("#start").value,
    local_end: $("#end").value,
    time_zone: $("#timezone").value,
    recurrence: freq
      ? { schema_version: 1, frequency: freq, interval: Number($("#interval").value), count: untilValue ? 0 : Number($("#count").value), until: untilValue ? new Date(`${untilValue}T23:59:59Z`).toISOString() : undefined, by_day: $("#by-day").value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean), by_month_day: $("#by-month-day").value.split(",").map((value) => Number(value.trim())).filter(Number.isInteger) }
      : { frequency: "", interval: 0, count: 0 },
    invitees: $("#invitees")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    reminders: [
      { minutes_before: Number($("#reminder").value), channel: "local" },
    ],
    meeting_link: $("#meeting-link").value,
    buffer_before_minutes: Number($("#buffer-before").value),
    buffer_after_minutes: Number($("#buffer-after").value),
    client_mutation_id: mutationID(),
    base_version: state.editing?.version || 0,
  };
}
function guestAlternativeSlots(candidate, events) {
  if (candidate.all_day || candidate.recurrence?.frequency) return [];
  const duration = new Date(candidate.end_utc) - new Date(candidate.start_utc);
  const cursor = new Date(candidate.end_utc);
  cursor.setMinutes(Math.ceil(cursor.getMinutes() / 30) * 30, 0, 0);
  const slots = [];
  for (let attempts = 0; attempts < 14 * 48 && slots.length < 5; attempts++) {
    const start = new Date(cursor.getTime() + attempts * 30 * 60000);
    const end = new Date(start.getTime() + duration);
    const startClock = zonedClock(start, candidate.time_zone);
    const endClock = zonedClock(end, candidate.time_zone);
    if (startClock.weekday === "Sat" || startClock.weekday === "Sun" || startClock.hour < 8 || startClock.hour >= 18 || endClock.hour > 18 || (endClock.hour === 18 && endClock.minute > 0)) continue;
    const bufferedStart = new Date(start.getTime() - candidate.buffer_before_minutes * 60000);
    const bufferedEnd = new Date(end.getTime() + candidate.buffer_after_minutes * 60000);
    const busy = events.some((event) => {
      const eventStart = new Date(new Date(event.start_utc).getTime() - (event.buffer_before_minutes || 0) * 60000);
      const eventEnd = new Date(new Date(event.end_utc).getTime() + (event.buffer_after_minutes || 0) * 60000);
      return bufferedStart < eventEnd && eventStart < bufferedEnd;
    });
    if (!busy) slots.push({ start_utc: start.toISOString(), end_utc: end.toISOString(), time_zone: candidate.time_zone, reason: "No detected device-local conflict" });
  }
  return slots;
}
async function submitEvent(e) {
  e.preventDefault();
  const input = eventInput();
  if (state.guest) {
    const start = new Date(localDateTimeToISO(input.local_start, input.time_zone)),
      end = new Date(localDateTimeToISO(input.local_end, input.time_zone));
    if (!input.title.trim() || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start || input.buffer_before_minutes < 0 || input.buffer_before_minutes > 240 || input.buffer_after_minutes < 0 || input.buffer_after_minutes > 240) {
      toast("Add a title, a valid end time, and buffers between 0 and 240 minutes");
      return;
    }
    try {
      for (const link of input.attachment_links) {
        const parsed = new URL(link);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.hostname.toLowerCase().includes("wallet") || parsed.pathname.toLowerCase().startsWith("/sign")) throw new Error();
      }
    } catch {
      toast("Cloud attachments must be credential-free HTTPS links and cannot request Wallet authority");
      return;
    }
    const id = state.editing?.event_id || state.editing?.id || mutationID();
    const after = {
      id,
      event_id: id,
      title: input.title.trim(),
      description: input.description,
      location: input.location,
      all_day: input.all_day,
      calendar_id: input.calendar_id,
      color: input.color,
      privacy: input.privacy,
      attachment_links: input.attachment_links,
      start_utc: start.toISOString(),
      end_utc: end.toISOString(),
      time_zone: input.time_zone,
      recurrence: input.recurrence,
      invites: input.invitees.map((handle) => ({ handle, state: "not_sent" })),
      reminders: input.reminders,
      meeting_link: input.meeting_link,
      buffer_before_minutes: input.buffer_before_minutes,
      buffer_after_minutes: input.buffer_after_minutes,
      owner_handle: "@guest",
      state: "local-draft",
      version: (state.editing?.version || 0) + 1,
      shares: [],
    };
    const conflicts = guestEvents().filter((event) => event.event_id !== id && new Date(event.start_utc) < end && start < new Date(event.end_utc));
    state.pendingChange = { id: `guest-${mutationID()}`, kind: state.editing ? "update local draft" : "create local draft", after, conflicts, suggested_slots: conflicts.length ? guestAlternativeSlots(after, guestEvents().filter((event) => event.event_id !== id)) : [] };
    showChange();
    return;
  }
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
    if (state.recurrenceEdit) {
      const recurrenceEdit = state.recurrenceEdit;
      const payload = recurrenceEdit.scope === "occurrence"
        ? { scope: "occurrence", recurrence_id: recurrenceEdit.recurrenceID, action: "modify", local_start: input.local_start, local_end: input.local_end, title: input.title, client_mutation_id: input.client_mutation_id, base_version: state.editing.version }
        : { scope: recurrenceEdit.scope, recurrence_id: recurrenceEdit.scope === "entire_series" ? "" : recurrenceEdit.recurrenceID, action: "update", series: input, client_mutation_id: input.client_mutation_id, base_version: state.editing.version };
      state.pendingChange = await api(`/v1/events/${state.editing.id}/recurrence-preview`, { method: "POST", body: JSON.stringify(payload) });
      showChange();
      return;
    }
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
    `<div class="preview-block"><span>Change</span><b>${escapeHTML(c.kind)}</b><span>Event</span><b>${escapeHTML(a.title)}</b><span>Time</span><b>${new Date(a.start_utc).toLocaleString(activeLocale())} — ${new Date(a.end_utc).toLocaleTimeString(activeLocale())}</b><span>Preparation / travel buffer</span><b>${a.buffer_before_minutes || 0} / ${a.buffer_after_minutes || 0} minutes</b><span>${tr("timezone", "Time zone")}</span><b>${escapeHTML(a.time_zone)}</b><span>Invitations</span><b>${(a.invites || []).length ? (a.invites || []).map((i) => escapeHTML(i.handle)).join(", ") : "None"}</b><span>${tr("repeat", "Recurrence")}</span><b>${a.recurrence.frequency ? `${escapeHTML(a.recurrence.frequency)} × ${a.recurrence.count}` : "Does not repeat"}</b></div>${c.conflicts?.length ? `<div class="conflicts"><b>${c.conflicts.length} conflict(s)</b>${c.conflicts.map((x) => `<p>${escapeHTML(x.participant_handle ? `${x.participant_handle} · Busy` : x.title)} · ${escapeHTML(x.kind || "overlap")} · ${new Date(x.start_utc).toLocaleString(activeLocale())}</p>`).join("")}</div>` : ""}${c.suggested_slots?.length ? `<div class="alternatives"><b>Conflict-free draft alternatives</b><p>Calendar has not moved the event. Choose a draft, review it in the editor, then approve again.</p>${c.suggested_slots.map((slot, index) => `<button type="button" class="quiet" data-suggestion="${index}">${new Date(slot.start_utc).toLocaleString(activeLocale())} — ${new Date(slot.end_utc).toLocaleTimeString(activeLocale())}</button>`).join("")}</div>` : ""}`;
  $$('[data-suggestion]').forEach((button) => button.onclick = () => {
    const slot = c.suggested_slots[Number(button.dataset.suggestion)];
    $("#start").value = zonedLocalInput(slot.start_utc, slot.time_zone);
    $("#end").value = zonedLocalInput(slot.end_utc, slot.time_zone);
    $("#timezone").value = slot.time_zone;
    $("#change-dialog").close();
    $("#event-dialog").showModal();
    toast("Alternative copied into the editor as a draft; review and approve to save it");
  });
  $("#conflict-override").hidden = !c.conflicts?.length;
  $("#accept-conflicts").checked = false;
  $("#event-dialog").close();
  $("#change-dialog").showModal();
}
async function approveChange() {
  if (!state.pendingChange) return;
  if (state.guest) {
    if (state.pendingChange.conflicts?.length && !$("#accept-conflicts").checked) {
      toast("Review and accept the local conflict before saving this draft");
      return;
    }
    const after = state.pendingChange.after;
    const events = guestEvents().filter((event) => event.event_id !== after.event_id);
    events.push(after);
    localStorage.setItem(guestEventsKey, JSON.stringify(events));
    state.pendingChange = null;
    state.editing = null;
    state.recurrenceEdit = null;
    $("#change-dialog").close();
    toast("Local draft saved on this device; nothing was synced or written to YNX Chain");
    await loadEvents();
    return;
  }
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
    state.recurrenceEdit = null;
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
  if (state.guest) {
    const event = guestEvents().find((item) => item.event_id === occurrence.event_id);
    if (!event) return;
    state.selected = occurrence;
    state.selectedEvent = event;
    $("#ai-begin").disabled = true;
    $("#ai-preview").textContent = "Connect YNX Wallet before sending selected event data to an AI provider.";
    $("#event-content").innerHTML = `<span class="eyebrow">Local guest draft · v${event.version}</span><h1>${escapeHTML(event.title)}</h1><p>${escapeHTML(event.description || "No description")}</p><div class="detail-row"><span>Time</span><b>${event.all_day ? "All day · " : ""}${new Date(event.start_utc).toLocaleString(activeLocale())} — ${new Date(event.end_utc).toLocaleString(activeLocale())}</b><span>Preparation / travel buffer</span><b>${event.buffer_before_minutes || 0} / ${event.buffer_after_minutes || 0} minutes</b><span>Location</span><b>${escapeHTML(event.location || "None")}</b><span>Calendar / privacy</span><b>${escapeHTML(event.calendar_id || "personal")} · ${escapeHTML(event.privacy || "private")}</b><span>${tr("timezone", "Time zone")}</span><b>${escapeHTML(event.time_zone)}</b><span>${tr("repeat", "Recurrence")}</span><b>${event.recurrence?.frequency ? `Every ${event.recurrence.interval || 1} ${escapeHTML(event.recurrence.frequency)} · ${event.recurrence.count || "until date"}` : "Does not repeat"}</b><span>Cloud references</span><b>${event.attachment_links?.map((link) => `<a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(new URL(link).hostname)}</a>`).join("<br>") || "None"}</b><span>Boundary</span><b>Stored on this device only · invitations are drafts only · not synced, shared, or written to YNX Chain</b></div><div class="detail-actions"><button class="primary" id="edit-event">${tr("update", "Update event")}</button><button class="quiet danger-action" id="delete-local-event">Delete local draft</button><button class="quiet" id="connect-event">Sign in to sync or share</button><button class="quiet" id="close-detail">Close</button></div>`;
    $("#event-detail").showModal();
    $("#close-detail").onclick = () => $("#event-detail").close();
    $("#edit-event").onclick = () => {
      $("#event-detail").close();
      openForm(event);
    };
    $("#delete-local-event").onclick = () => {
      if (!confirm("Delete this device-only draft? This cannot be recovered after the browser storage is cleared.")) return;
      localStorage.setItem(guestEventsKey, JSON.stringify(guestEvents().filter((item) => item.event_id !== event.event_id)));
      $("#event-detail").close();
      toast("Local draft deleted from this device");
      loadEvents();
    };
    $("#connect-event").onclick = () => {
      $("#event-detail").close();
      state.guest = false;
      state.user = null;
      $("#signin").hidden = false;
    };
    return;
  }
  try {
    const event = await api(`/v1/events/${occurrence.event_id}`);
    state.selected = occurrence;
    state.selectedEvent = event;
    $("#ai-begin").disabled = false;
    $("#ai-preview").textContent =
      `Selected only: ${event.title}. Next, review the provider, model, and cost.`;
    const mine = event.owner_handle === state.user.handle;
    $("#event-content").innerHTML =
      `<span class="eyebrow">${escapeHTML(event.state)} · v${event.version}</span><h1>${escapeHTML(event.title)}</h1><p>${escapeHTML(event.description || "No description")}</p><div class="detail-row"><span>Time</span><b>${event.all_day ? "All day · " : ""}${new Date(event.start_utc).toLocaleString(activeLocale())} — ${new Date(event.end_utc).toLocaleString(activeLocale())}</b><span>Location</span><b>${escapeHTML(event.location || "None")}</b><span>Calendar / privacy</span><b>${escapeHTML(event.calendar_id || "personal")} · ${escapeHTML(event.privacy || "private")}</b><span>${tr("timezone", "Time zone")}</span><b>${escapeHTML(event.time_zone)}</b><span>Organizer</span><b>${escapeHTML(event.owner_handle)}</b><span>${tr("repeat", "Recurrence")}</span><b>${event.recurrence?.frequency ? `Every ${event.recurrence.interval || 1} ${escapeHTML(event.recurrence.frequency)} · ${event.recurrence.count || "until date"}` : "Does not repeat"}</b><span>${tr("reminder", "Reminder")}</span><b>${event.reminders?.map((r) => `${r.minutes_before} minutes before`).join(", ") || "None"}</b><span>Invitations</span><b>${event.invites?.map((i) => `${escapeHTML(i.handle)} · ${escapeHTML(i.state)}`).join("<br>") || "None"}</b><span>${tr("share", "Sharing")}</span><b>${event.shares?.map((s) => `${escapeHTML(s.handle)} · ${escapeHTML(s.role)}`).join("<br>") || "None"}</b><span>Participant comments</span><b>${event.comments?.map((c) => `${escapeHTML(c.author)} · ${escapeHTML(c.body)}<small>${new Date(c.created_at).toLocaleString(activeLocale())}</small>`).join("<br>") || "None"}</b><span>Cloud references</span><b>${event.attachment_links?.map((link) => `<a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">Open attachment</a>`).join("<br>") || "None"}</b><span>${tr("meeting_link", "Meeting link")}</span><b>${event.meeting_link ? `<a href="${escapeHTML(event.meeting_link)}" target="_blank" rel="noopener noreferrer">Open bounded link</a>` : "None"}</b></div><div class="detail-actions">${mine ? `<button class="primary" id="edit-event">${tr("update", "Update event")}</button>${event.recurrence?.frequency ? '<button class="quiet" id="recurrence-actions">Manage recurrence</button>' : ""}<button class="quiet" id="cancel-event">${tr("cancel_event", "Cancel event")}</button><button class="quiet" id="share-event">${tr("share", "Share calendar")}</button>` : '<button class="primary" data-rsvp="accepted">Accept</button><button class="quiet" data-rsvp="tentative">Tentative</button><button class="quiet" data-rsvp="declined">Decline</button>'}<button class="quiet" id="comment-event">Add participant comment</button>${event._lastChange ? '<button class="quiet" id="revert-event">Undo last change</button>' : ""}<button class="quiet" id="close-detail">Close</button></div>`;
    $("#event-detail").showModal();
    $("#close-detail").onclick = () => $("#event-detail").close();
    if (mine) {
      $("#edit-event").onclick = () => {
        $("#event-detail").close();
        openForm(event);
      };
      $("#cancel-event").onclick = () => previewCancel(event);
      $("#share-event").onclick = () => shareEvent(event);
      if ($("#recurrence-actions")) $("#recurrence-actions").onclick = () => showRecurrenceManager(event, occurrence);
    }
    $$("[data-rsvp]").forEach(
      (b) => (b.onclick = () => rsvp(event, b.dataset.rsvp)),
    );
    $("#comment-event").onclick = () => commentEvent(event);
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
function recurrenceIDFor(occurrence) {
  if (occurrence.local_start) return occurrence.local_start.slice(0, 16);
  return localInput(new Date(occurrence.start_utc));
}
function showRecurrenceManager(event, occurrence) {
  const recurrenceID = recurrenceIDFor(occurrence);
  const occurrenceEvent = { ...event, start_utc: occurrence.start_utc, end_utc: occurrence.end_utc };
  $("#event-detail").close();
  const dialog = document.createElement("dialog");
  dialog.className = "change-dialog";
  dialog.innerHTML = `<div class="change-card"><span class="eyebrow">Recurring event</span><h2>Choose what to change</h2><p><b>${escapeHTML(event.title)}</b><br>${new Date(occurrence.start_utc).toLocaleString(activeLocale())}<br><small>Every operation creates a preview first. Nothing changes until you approve it.</small></p><div class="recurrence-action-list"><button class="quiet" data-action="edit-one">Edit this occurrence</button><button class="quiet danger-action" data-action="cancel-one">Cancel this occurrence</button><button class="quiet" data-action="edit-future">Edit this and following</button><button class="quiet" data-action="edit-series">Edit entire series</button><button class="primary" data-action="close">Close</button></div></div>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  dialog.querySelector('[data-action="edit-one"]').onclick = () => { dialog.close(); openForm(occurrenceEvent, { scope: "occurrence", recurrenceID }); };
  dialog.querySelector('[data-action="edit-future"]').onclick = () => { dialog.close(); openForm(occurrenceEvent, { scope: "this_and_following", recurrenceID }); };
  dialog.querySelector('[data-action="edit-series"]').onclick = () => { dialog.close(); openForm(event, { scope: "entire_series", recurrenceID: "" }); };
  dialog.querySelector('[data-action="cancel-one"]').onclick = async () => {
    if (!confirm(`Create a preview to cancel only ${new Date(occurrence.start_utc).toLocaleString(activeLocale())}?`)) return;
    try {
      state.pendingChange = await api(`/v1/events/${event.id}/recurrence-preview`, { method: "POST", body: JSON.stringify({ scope: "occurrence", recurrence_id: recurrenceID, action: "cancel", client_mutation_id: mutationID(), base_version: event.version }) });
      dialog.close();
      showChange();
    } catch (error) { toast(error.message); }
  };
  dialog.showModal();
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
async function commentEvent(event) {
  const body = prompt("Add a participant comment (1–1000 characters)");
  if (!body) return;
  try {
    await api(`/v1/events/${event.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    toast("Comment shared with event participants");
    $("#event-detail").close();
    await loadEvents();
  } catch (error) {
    toast(error.message);
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
      await loadCalendars();
      await loadActivityNotifications();
      await loadEvents();
      syncOffline();
    } else $("#signin").hidden = false;
    $("#app").setAttribute("aria-busy", "false");
  });
  $("#wallet-signin").onclick = beginSignIn;
  $("#guest-try").onclick = enterGuest;
  $("#account").onclick = () => state.guest ? showGuestAccount() : showAccount();
  $("#new-event").onclick = () => openForm();
  $("#event-close").onclick = () => $("#event-dialog").close();
  $("#manage-calendars").onclick = showCalendarManager;
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
    const step = state.view === "day" ? -1 : state.view === "agenda" ? -30 : -7;
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
    const step = state.view === "day" ? 1 : state.view === "agenda" ? 30 : 7;
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
  $("#calendar-search").oninput = (event) => {
    state.searchQuery = event.target.value;
    renderEvents();
  };
  addEventListener("online", () => {
    updateNetwork();
    toast("Network restored; offline changes are ready for preview");
  });
addEventListener("offline", updateNetwork);
addEventListener("ynx:locale", () => {
  renderFrame();
  if (state.token || state.guest) loadEvents();
});
  updateNetwork();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}
function showCalendarManager() {
  if (!state.token) {
    toast("Sign in with YNX Wallet to create and share server-backed calendars");
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "change-dialog";
  const rows = state.calendars.map((calendar) => {
    const role = calendarRole(calendar);
    const members = calendar.shares?.map((share) => `${escapeHTML(share.handle)} · ${escapeHTML(share.role)}`).join("<br>") || "No members yet";
    return `<section class="permission"><span class="eyebrow">${escapeHTML(role)}</span><h3>${escapeHTML(calendar.name)}</h3><p>${members}</p>${role === "owner" ? `<div class="detail-actions"><button class="quiet" data-share-calendar="${escapeHTML(calendar.id)}">Add or change member</button><button class="quiet" data-revoke-calendar="${escapeHTML(calendar.id)}">Revoke member</button></div>` : ""}</section>`;
  }).join("");
  dialog.innerHTML = `<div class="change-card"><span class="eyebrow">Shared calendars</span><h2>Calendars and permissions</h2><p>Owners manage membership. Editors can schedule; viewers can read. Every permission change is audited.</p>${rows || "<p>No shared calendars yet.</p>"}<div class="detail-actions"><button class="quiet" data-action="create">Create shared calendar</button><button class="primary" data-action="close">Close</button></div></div>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  dialog.querySelector('[data-action="create"]').onclick = async () => {
    const name = prompt("Shared calendar name (1–80 characters)");
    if (!name) return;
    const color = prompt("Color: blue, slate, green, amber, red, or violet", "blue");
    if (!color) return;
    try {
      await api("/v1/calendars", { method: "POST", body: JSON.stringify({ name, color }) });
      await loadCalendars();
      dialog.close();
      showCalendarManager();
    } catch (error) { toast(error.message); }
  };
  dialog.querySelectorAll("[data-share-calendar]").forEach((button) => button.onclick = async () => {
    const handle = prompt("Member @handle");
    if (!handle) return;
    const role = prompt("Role: viewer, editor, or availability", "viewer");
    if (!role || !confirm(`Grant ${handle} the ${role} role?`)) return;
    try {
      await api(`/v1/calendars/${button.dataset.shareCalendar}/shares`, { method: "POST", body: JSON.stringify({ handle, role }) });
      await loadCalendars();
      dialog.close();
      showCalendarManager();
    } catch (error) { toast(error.message); }
  });
  dialog.querySelectorAll("[data-revoke-calendar]").forEach((button) => button.onclick = async () => {
    const handle = prompt("Revoke which @handle?");
    if (!handle || !confirm(`Revoke ${handle} from this calendar?`)) return;
    try {
      await api(`/v1/calendars/${button.dataset.revokeCalendar}/shares/${encodeURIComponent(handle.replace(/^@/, ""))}`, { method: "DELETE" });
      await loadCalendars();
      dialog.close();
      showCalendarManager();
    } catch (error) { toast(error.message); }
  });
  dialog.showModal();
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
function downloadBlob(name, type, body) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([body], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function guestICS(events) {
  const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//YNX//Calendar Guest Export//EN", "CALSCALE:GREGORIAN", ...events.flatMap((event) => ["BEGIN:VEVENT", `UID:${icsEscape(event.event_id)}@calendar.ynxweb4.com`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(event.start_utc)}`, `DTEND:${stamp(event.end_utc)}`, `SUMMARY:${icsEscape(event.title)}`, `DESCRIPTION:${icsEscape(event.description)}`, `LOCATION:${icsEscape(event.location)}`, "STATUS:TENTATIVE", "X-YNX-BOUNDARY:DEVICE-ONLY-GUEST-DRAFT", "END:VEVENT"]), "END:VCALENDAR", ""].join("\r\n");
}
function showGuestAccount() {
  const events = guestEvents();
  const dialog = document.createElement("dialog");
  dialog.className = "change-dialog";
  dialog.innerHTML = `<div class="change-card"><span class="eyebrow">Device-only trial</span><h2>Local Calendar data</h2><p>${events.length} draft${events.length === 1 ? "" : "s"} are stored only in this browser profile. Export before clearing browser data if you want to keep them.</p><div class="detail-actions"><button class="quiet" data-action="json">Export JSON</button><button class="quiet" data-action="ics">Export iCalendar (.ics)</button><button class="quiet danger-action" data-action="clear">Delete all local drafts</button><button class="quiet" data-action="exit">Exit guest trial</button><button class="primary" data-action="close">Close</button></div></div>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  dialog.querySelector('[data-action="json"]').onclick = () => downloadBlob("ynx-calendar-guest-export.json", "application/json", JSON.stringify({ schema_version: 1, boundary: "device-only-guest-drafts", exported_at: new Date().toISOString(), events }, null, 2));
  dialog.querySelector('[data-action="ics"]').onclick = () => downloadBlob("ynx-calendar-guest-export.ics", "text/calendar", guestICS(events));
  dialog.querySelector('[data-action="clear"]').onclick = () => {
    if (!confirm(`Delete all ${events.length} device-only Calendar drafts? This cannot be undone.`)) return;
    localStorage.removeItem(guestEventsKey);
    dialog.close();
    toast("All local Calendar drafts deleted from this browser profile");
    loadEvents();
  };
  dialog.querySelector('[data-action="exit"]').onclick = () => {
    dialog.close();
    signOut(false);
  };
  dialog.showModal();
}
window.ynxI18nReady.catch(() => {}).finally(init);
$("#wallet-signin").onclick = () => beginSignIn(false);
$("#wallet-recover").onclick = () => beginSignIn(true);
$("#guest-try").onclick = enterGuest;
const auditButton = document.createElement("button");
auditButton.className = "avatar";
auditButton.textContent = "Audit";
auditButton.setAttribute("aria-label", "Open Calendar audit");
auditButton.onclick = showAudit;
$("#ai-open").before(auditButton);
const notificationButton = document.createElement("button");
notificationButton.id = "notifications-open";
notificationButton.className = "quiet notification-button";
notificationButton.textContent = "Notifications";
notificationButton.setAttribute("aria-label", "Open Calendar notifications");
notificationButton.onclick = showActivityNotifications;
auditButton.before(notificationButton);
function renderNotificationCount() {
  if (!notificationButton) return;
  const unread = state.notifications.filter((item) => item.state === "unread").length;
  notificationButton.textContent = unread ? `Notifications ${unread}` : "Notifications";
  notificationButton.setAttribute("aria-label", unread ? `Open Calendar notifications; ${unread} unread` : "Open Calendar notifications");
}
async function loadActivityNotifications() {
  if (!state.token) {
    state.notifications = [];
    renderNotificationCount();
    return;
  }
  try {
    state.notifications = await api("/v1/notifications");
    renderNotificationCount();
  } catch {}
}
async function showActivityNotifications() {
  if (!state.token) {
    toast("Sign in with YNX Wallet for synced invitations, responses, comments, and permission notifications");
    return;
  }
  await loadActivityNotifications();
  const dialog = document.createElement("dialog");
  dialog.className = "change-dialog";
  const card = document.createElement("div");
  card.className = "change-card";
  card.innerHTML = '<span class="eyebrow">Calendar activity</span><h2>Notifications</h2><p>Invitations, RSVP responses, participant comments, and permission changes appear here. Mail delivery is a separate integration.</p>';
  const list = document.createElement("div");
  list.className = "notification-list";
  for (const item of state.notifications.slice(0, 50)) {
    const row = document.createElement("article");
    row.className = `notification-row${item.state === "unread" ? " unread" : ""}`;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const body = document.createElement("span");
    body.textContent = item.body;
    const meta = document.createElement("small");
    meta.textContent = `${item.actor_handle || "YNX Calendar"} · ${new Date(item.created_at).toLocaleString(activeLocale())}`;
    row.append(title, body, meta);
    if (item.event_id) {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.onclick = async () => {
        try {
          dialog.close();
          await openEvent({ event_id: item.event_id });
        } catch (error) { toast(error.message); }
      };
    }
    list.append(row);
  }
  if (!state.notifications.length) list.innerHTML = "<p>No account activity yet.</p>";
  card.append(list);
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const markRead = document.createElement("button");
  markRead.className = "quiet";
  markRead.textContent = "Mark all as read";
  markRead.disabled = !state.notifications.some((item) => item.state === "unread");
  markRead.onclick = async () => {
    try {
      await api("/v1/notifications/read", { method: "POST", body: "{}" });
      await loadActivityNotifications();
      dialog.close();
      showActivityNotifications();
    } catch (error) { toast(error.message); }
  };
  const close = document.createElement("button");
  close.className = "primary";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  actions.append(markRead, close);
  card.append(actions);
  dialog.append(card);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}
async function showAudit() {
  if (state.guest) {
    toast("Sign in with YNX Wallet for server-backed audit evidence; guest drafts stay only on this device");
    return;
  }
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
setInterval(loadActivityNotifications, 30000);
