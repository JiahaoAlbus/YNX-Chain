// Private drafts live only in this authenticated page and clear on logout.
// Opaque retry identities are independently preserved by mutation-recovery.js.
export function createFormState() {
  const drafts = new Map();
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
    acknowledged(name, root) {
      Array.from(root.querySelectorAll("form")).find(form => form.id === name)?.reset();
      drafts.delete(name);
    },
    clear() { drafts.clear(); }
  };
}

export function localDateTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
