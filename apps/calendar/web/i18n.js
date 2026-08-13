(() => {
  const supported = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"];
  const normalize = (value = "") => {
    const lower = value.toLowerCase();
    if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower.startsWith("zh-hant")) return "zh-TW";
    if (lower.startsWith("zh")) return "zh-CN";
    return supported.find((code) => lower === code.toLowerCase() || lower.startsWith(`${code.toLowerCase()}-`)) || "en";
  };
  const storedLocale = localStorage.getItem("ynx.calendar.locale");
  const explicitLocale = localStorage.getItem("ynx.calendar.locale.explicit") === "1";
  let locale = normalize(explicitLocale && storedLocale ? storedLocale : "en");
  let messages = {};
  let english = {};
  const applyDirection = () => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  };
  const translate = (root = document) => {
    root.querySelectorAll?.("[data-i18n]").forEach((node) => {
      const value = messages[node.dataset.i18n];
      if (value) node.textContent = value;
    });
    root.querySelectorAll?.("[data-i18n-placeholder]").forEach((node) => {
      const value = messages[node.dataset.i18nPlaceholder];
      if (value) node.setAttribute("placeholder", value);
    });
    root.querySelectorAll?.("[data-i18n-aria-label]").forEach((node) => {
      const value = messages[node.dataset.i18nAriaLabel];
      if (value) node.setAttribute("aria-label", value);
    });
  };
  window.ynxI18n = {
    t: (key) => messages[key] || english[key] || key,
    locale: () => locale,
    translate,
  };
  const ready = fetch("/locales.json", { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error(`locale catalog ${response.status}`);
      return response.json();
    })
    .then((catalog) => {
      english = catalog.locales.en;
      const activate = (next, persist = true) => {
        locale = normalize(next);
        messages = catalog.locales[locale] || catalog.locales.en;
        if (persist) {
          localStorage.setItem("ynx.calendar.locale", locale);
          localStorage.setItem("ynx.calendar.locale.explicit", "1");
        }
        applyDirection();
        translate();
        window.dispatchEvent(new CustomEvent("ynx:locale", { detail: { locale } }));
      };
      const picker = document.querySelector("#locale-picker");
      if (picker) {
        picker.value = locale;
        picker.addEventListener("change", () => activate(picker.value, true));
      }
      activate(locale, false);
      return window.ynxI18n;
    });
  applyDirection();
  window.ynxI18nReady = ready;
})();
