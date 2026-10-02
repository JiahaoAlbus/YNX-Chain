// Drafts and retry identities live only in this authenticated page. Logout clears
// both; no merchant contents are written to browser storage.
export function createFormState() {
  const drafts = new Map(), intents = new Map();
  const owned = new Set(['invoice-form', 'catalog-form', 'recurring-form', 'webhook-form', 'member-form']);
  return {
    capture(root) {
      for (const form of root.querySelectorAll('form')) {
        if (!owned.has(form.id)) continue;
        drafts.set(form.id, Array.from(form.elements).filter(field => field.name).map(field => [field.name, field.value]));
      }
    },
    restore(root) {
      for (const form of root.querySelectorAll('form')) {
        for (const [name, value] of drafts.get(form.id) || []) {
          const field = form.elements.namedItem(name);
          if (field) field.value = value;
        }
      }
    },
    intent(name, body) {
      const fingerprint = JSON.stringify(body);
      let intent = intents.get(name);
      if (intent?.fingerprint !== fingerprint) {
        intent = { fingerprint, key: `${name}-${crypto.randomUUID()}` };
        intents.set(name, intent);
      }
      return { ...body, idempotencyKey: intent.key };
    },
    acknowledged(name, root) {
      Array.from(root.querySelectorAll("form")).find(form => form.id === name)?.reset();
      drafts.delete(name);
      intents.delete(name);
    },
    clear() { drafts.clear(); intents.clear(); }
  };
}

export function localDateTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
