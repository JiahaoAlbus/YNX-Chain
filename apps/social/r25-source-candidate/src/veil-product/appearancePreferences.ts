export type AppearancePreference = 'system' | 'light' | 'dark';
export const APPEARANCE_KEY = 'ynx.social.veil-product.appearance.v1';
type Storage = {read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void>};
type Snapshot = Readonly<{preference: AppearancePreference; saving: boolean; saveFailed: boolean}>;
export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
/** Only a non-private display preference. Never stores identity, messages or authority. */
export function createAppearancePreferences(storage: Storage) {
  let snapshot: Snapshot = {preference: 'system', saving: false, saveFailed: false};
  let revision = 0;
  let initialization: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {snapshot = Object.freeze(next); listeners.forEach(listener => listener());};
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    initialize(): Promise<void> {
      if (!initialization) {
        const originalRevision = revision;
        initialization = storage.read(APPEARANCE_KEY).then(value => {
          if (revision === originalRevision && isAppearancePreference(value)) publish({...snapshot, preference: value});
        }).catch(() => {if (revision === originalRevision) publish({...snapshot, saveFailed: true});});
      }
      return initialization;
    },
    select(preference: AppearancePreference): Promise<void> {
      if (!isAppearancePreference(preference)) return Promise.reject(new TypeError('INVALID_APPEARANCE_PREFERENCE'));
      const selectedRevision = ++revision;
      publish({preference, saving: true, saveFailed: false});
      const next = writes.catch(() => {}).then(() => storage.write(APPEARANCE_KEY, preference));
      writes = next;
      return next.then(() => {
        if (revision === selectedRevision) publish({...snapshot, saving: false, saveFailed: false});
      }, () => {
        if (revision === selectedRevision) publish({...snapshot, saving: false, saveFailed: true});
      });
    },
  });
}
export function resolveAppearance(preference: AppearancePreference, system: string | null | undefined): 'light' | 'dark' {
  return preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
}
