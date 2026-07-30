(() => {
  const messages = {
    en: "Operation recorded with evidence.",
    "zh-Hans": "操作已连同证据记录。",
    "zh-Hant": "操作已連同證據記錄。",
    ja: "操作と証拠を記録しました。",
    ko: "작업과 증거가 기록되었습니다.",
    es: "La operación se registró con evidencia.",
    fr: "L’opération a été enregistrée avec ses preuves.",
    de: "Der Vorgang wurde mit Nachweisen erfasst.",
    pt: "A operação foi registrada com evidências.",
    ru: "Операция записана вместе с доказательствами.",
    ar: "سُجّلت العملية مع أدلتها.",
    id: "Operasi dicatat bersama buktinya.",
  };

  for (const [locale, message] of Object.entries(messages)) {
    YNXI18n.L[locale].operationRecorded = message;
  }

  window.YNXRuntimeStatus = (english, key = "operationRecorded") =>
    YNXI18n.locale === "en" ? english : YNXI18n.t(key);

  window.YNXVisibleError = (error) => {
    if (YNXI18n.locale === "en") return error?.message || YNXI18n.t("unavailable");
    const fields = [
      YNXI18n.t("unavailable"),
      error?.code || "request_failed",
      error?.requestId || null,
    ].filter(Boolean);
    return fields.join(" · ");
  };
})();
