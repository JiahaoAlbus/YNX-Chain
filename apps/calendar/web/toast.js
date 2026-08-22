export function createCalendarToastController(element, {
  visibleMs = 2600,
  hideMs = 220,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!element || typeof element !== "object" || !element.classList) throw new TypeError("Calendar toast element is required");
  let visibleTimer = null;
  let clearTextTimer = null;
  let revision = 0;

  const cancelTimers = () => {
    if (visibleTimer !== null) clearTimer(visibleTimer);
    if (clearTextTimer !== null) clearTimer(clearTextTimer);
    visibleTimer = null;
    clearTextTimer = null;
  };

  const clear = () => {
    revision += 1;
    cancelTimers();
    element.classList.remove("show");
    element.textContent = "";
    element.setAttribute("aria-hidden", "true");
  };

  const show = (message) => {
    revision += 1;
    const current = revision;
    cancelTimers();
    element.textContent = String(message ?? "");
    element.setAttribute("aria-hidden", "false");
    element.classList.add("show");
    visibleTimer = setTimer(() => {
      if (current !== revision) return;
      visibleTimer = null;
      element.classList.remove("show");
      clearTextTimer = setTimer(() => {
        if (current !== revision) return;
        clearTextTimer = null;
        element.textContent = "";
        element.setAttribute("aria-hidden", "true");
      }, hideMs);
    }, visibleMs);
  };

  return Object.freeze({show, clear});
}
